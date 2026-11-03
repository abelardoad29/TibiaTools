import { randomUUID } from 'node:crypto'
import type { ConfirmScanInput } from '@shared/api'
import { diffSnapshots } from '@core/domain/market/snapshot-diff'
import type { OfferLevel } from '@core/domain/market/order-book'
import type { Glyph, OcrProfile } from '@core/ocr/types'
import { mergeAtlas } from '@core/ocr/glyphs'
import marketOffers1080 from '@seed/ocr-profiles/market-offers-1920x1080.json'
import { all, get, nowIso, parseJson, run, tx, type Db } from '../db/database'
import { getScreenshot } from './evidence'
import { TIBIA_COINS_ID } from './catalog'

// ---------- Perfiles OCR (versionados: cada guardado incrementa la versión) ----------

const DEFAULT_PROFILES = [marketOffers1080 as OcrProfile]

interface ProfileRow {
  id: number
  name: string
  screen_type: 'offers' | 'details'
  screen_width: number
  screen_height: number
  regions_json: string
  preprocessing_json: string
  glyphs_json: string
  version: number
  updated_at: string
}

type Regions = Pick<OcrProfile, 'tables' | 'detailsFields' | 'anchor' | 'itemList'>

const toProfile = (r: ProfileRow): OcrProfile => {
  const regions = parseJson<Regions>(r.regions_json, { tables: [], detailsFields: [] })
  return {
    id: r.id,
    name: r.name,
    screenType: r.screen_type,
    refWidth: r.screen_width,
    refHeight: r.screen_height,
    tables: regions.tables,
    detailsFields: regions.detailsFields,
    anchor: regions.anchor ?? null,
    itemList: regions.itemList ?? null,
    preprocess: parseJson(r.preprocessing_json, { threshold: 'otsu', darkText: false, spaceGap: 3 }),
    atlas: parseJson(r.glyphs_json, { glyphs: [] }),
    version: r.version,
    updatedAt: r.updated_at,
  }
}

export function listProfiles(db: Db): OcrProfile[] {
  return all<ProfileRow>(db, 'SELECT * FROM collector_profiles ORDER BY name').map(toProfile)
}

export function getProfile(db: Db, id: number): OcrProfile | null {
  const r = get<ProfileRow>(db, 'SELECT * FROM collector_profiles WHERE id = ?', [id])
  return r ? toProfile(r) : null
}

export function saveProfile(db: Db, p: OcrProfile): OcrProfile {
  const regions = JSON.stringify({ tables: p.tables, detailsFields: p.detailsFields, anchor: p.anchor ?? null, itemList: p.itemList ?? null } satisfies Regions)
  const now = nowIso()
  if (p.id === null) {
    const r = run(
      db,
      `INSERT INTO collector_profiles (name, screen_type, screen_width, screen_height, regions_json, preprocessing_json, glyphs_json, version, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?)`,
      [p.name, p.screenType, p.refWidth, p.refHeight, regions, JSON.stringify(p.preprocess), JSON.stringify(p.atlas), now, now],
    )
    return getProfile(db, Number(r.lastInsertRowid))!
  }
  run(
    db,
    `UPDATE collector_profiles SET name = ?, screen_type = ?, screen_width = ?, screen_height = ?, regions_json = ?, preprocessing_json = ?, glyphs_json = ?, version = version + 1, updated_at = ? WHERE id = ?`,
    [p.name, p.screenType, p.refWidth, p.refHeight, regions, JSON.stringify(p.preprocess), JSON.stringify(p.atlas), now, p.id],
  )
  return getProfile(db, p.id)!
}

/**
 * Perfiles que trae la app (calibrados con capturas reales, ver scripts/calibrate-market.ts). Se crean si no
 * existe uno con ese nombre; si el usuario lo editó, se respeta su versión.
 */
export function ensureDefaultProfiles(db: Db): void {
  for (const p of DEFAULT_PROFILES) {
    if (!get(db, 'SELECT 1 FROM collector_profiles WHERE name = ?', [p.name])) saveProfile(db, { ...p, id: null })
  }
}

/** El perfil por defecto (con ancla) o, si no existe, el primero de ofertas con glifos. */
export function defaultOffersProfile(db: Db): OcrProfile | null {
  const offers = listProfiles(db).filter((p) => p.screenType === 'offers')
  return offers.find((p) => p.name === DEFAULT_PROFILES[0]!.name) ?? offers.find((p) => p.anchor && p.atlas.glyphs.length) ?? null
}

/** Agrega glifos de letras al perfil (aprendidos de un nombre de item confirmado). Devuelve cuántos son nuevos. */
export function addItemGlyphs(db: Db, profileId: number, glyphs: Glyph[]): number {
  const p = getProfile(db, profileId)
  if (!p?.itemList) return 0
  const atlas = mergeAtlas(p.itemList.atlas, glyphs)
  const added = atlas.glyphs.length - p.itemList.atlas.glyphs.length
  if (added > 0) saveProfile(db, { ...p, itemList: { ...p.itemList, atlas } })
  return added
}

export function deleteProfile(db: Db, id: number): void {
  // Los scans conservan profile_id como evidencia: solo se permite borrar perfiles sin scans.
  if (get(db, 'SELECT 1 FROM market_scans WHERE profile_id = ? LIMIT 1', [id])) throw new Error('El perfil tiene scans asociados; no se puede borrar')
  run(db, 'DELETE FROM collector_profiles WHERE id = ?', [id])
}

// ---------- Confirmación de scans ----------

function previousLevels(db: Db, worldId: number, itemId: number, side: 'buy' | 'sell', beforeIso: string, excludeScan: string) {
  const prev = get<{ id: string; observed_at_utc: string }>(
    db,
    `SELECT id, observed_at_utc FROM market_scans WHERE world_id = ? AND item_id = ? AND source = 'own_capture' AND review_status = 'accepted'
       AND scan_type IN (?, 'combined') AND observed_at_utc < ? AND id <> ? ORDER BY observed_at_utc DESC LIMIT 1`,
    [worldId, itemId, side, beforeIso, excludeScan],
  )
  if (!prev) return null
  const levels = all<{ unit_price_gp: number; amount: number; expiration_at_utc: string | null }>(db, 'SELECT unit_price_gp, amount, expiration_at_utc FROM market_offers WHERE scan_id = ? AND offer_type = ?', [prev.id, side])
  return { scanId: prev.id, levels: levels.map((l): OfferLevel => ({ unitPrice: l.unit_price_gp, amount: l.amount, expiresAt: l.expiration_at_utc })) }
}

/**
 * Persiste un scan revisado. La captura queda confirmada (inmutable); las correcciones del usuario
 * quedan auditadas en ocr_field_reviews y prevalecen sobre el OCR. Devuelve los eventos inferidos.
 */
export function confirmScan(db: Db, input: ConfirmScanInput, sidesObserved: ('buy' | 'sell')[]): { scanIds: string[]; events: number } {
  const shot = getScreenshot(db, input.screenshotId)
  if (!shot) throw new Error('Captura no encontrada')
  if (shot.status === 'confirmed') throw new Error('Esta captura ya fue confirmada')
  for (const o of input.offers) {
    if (!Number.isSafeInteger(o.unitPrice) || o.unitPrice <= 0) throw new Error(`Fila ${o.rowIndex + 1} (${o.side}): precio inválido`)
    if (!Number.isSafeInteger(o.amount) || o.amount <= 0) throw new Error(`Fila ${o.rowIndex + 1} (${o.side}): cantidad inválida`)
  }
  const observedAt = shot.capturedAtUtc
  const now = nowIso()

  return tx(db, () => {
    const scanIds: string[] = []
    let events = 0
    const confOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null)

    if (input.screenType === 'offers') {
      const scanType = sidesObserved.length === 2 ? 'combined' : sidesObserved[0]!
      const isTc = get<{ tibia_item_id: number }>(db, 'SELECT tibia_item_id FROM items WHERE id = ?', [input.itemId])?.tibia_item_id === TIBIA_COINS_ID
      const scanId = randomUUID()
      const confidence = confOf(input.offers.flatMap((o) => [o.priceConfidence, o.amountConfidence]))
      run(
        db,
        `INSERT INTO market_scans (id, screenshot_id, world_id, item_id, scan_type, source, observed_at_utc, parser_version, ocr_version, profile_id, confidence, review_status, created_at)
         VALUES (?,?,?,?,?, 'own_capture', ?,?,?,?,?, 'accepted', ?)`,
        [scanId, input.screenshotId, input.worldId, input.itemId, isTc && scanType !== 'combined' ? `tc_${scanType}` : scanType, observedAt, input.parserVersion, input.ocrVersion, input.profileId, confidence, now],
      )
      scanIds.push(scanId)
      for (const o of input.offers) {
        const r = run(
          db,
          `INSERT INTO market_offers (scan_id, offer_type, unit_price_gp, amount, total_price_gp, expiration_text, raw_price_text, raw_amount_text, price_confidence, amount_confidence, row_index, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [scanId, o.side, o.unitPrice, o.amount, o.totalPrice, o.expirationText, o.rawPriceText, o.rawAmountText, o.priceConfidence, o.amountConfidence, o.rowIndex, now],
        )
        for (const c of o.corrections) {
          run(db, 'INSERT INTO ocr_field_reviews (scan_id, offer_id, field_name, raw_value, ocr_value, corrected_value, reviewed_at) VALUES (?,?,?,?,?,?,?)', [scanId, Number(r.lastInsertRowid), c.field, c.raw, c.ocrValue, c.corrected, now])
        }
      }
      for (const side of sidesObserved) {
        const prev = previousLevels(db, input.worldId, input.itemId, side, observedAt, scanId)
        if (!prev) continue
        const next = input.offers.filter((o) => o.side === side).map((o) => ({ unitPrice: o.unitPrice, amount: o.amount }))
        for (const e of diffSnapshots(side, prev.levels, next, observedAt)) {
          run(
            db,
            `INSERT INTO market_events (world_id, item_id, event_type, offer_type, price_gp, quantity, confidence, note, evidence_json, detected_at_utc) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [input.worldId, input.itemId, e.type, side, e.price, e.quantity, e.confidence, e.note, JSON.stringify({ prevScanId: prev.scanId, scanId }), observedAt],
          )
          events++
        }
      }
      if (isTc) {
        const best = (side: 'buy' | 'sell') => {
          const xs = input.offers.filter((o) => o.side === side)
          if (!xs.length) return null
          return xs.reduce((a, b) => (side === 'sell' ? (b.unitPrice < a.unitPrice ? b : a) : b.unitPrice > a.unitPrice ? b : a))
        }
        const b = best('buy')
        const s = best('sell')
        run(db, `INSERT INTO tc_rates (world_id, captured_at_utc, buy_price_gp, buy_amount, sell_price_gp, sell_amount, scan_id, source, confidence) VALUES (?,?,?,?,?,?,?, 'own_capture', ?)`, [
          input.worldId,
          observedAt,
          b?.unitPrice ?? null,
          b?.amount ?? null,
          s?.unitPrice ?? null,
          s?.amount ?? null,
          scanId,
          confidence,
        ])
      }
    } else {
      const scanId = randomUUID()
      run(
        db,
        `INSERT INTO market_scans (id, screenshot_id, world_id, item_id, scan_type, source, observed_at_utc, parser_version, ocr_version, profile_id, confidence, review_status, created_at)
         VALUES (?,?,?,?, 'details', 'own_capture', ?,?,?,?,?, 'accepted', ?)`,
        [scanId, input.screenshotId, input.worldId, input.itemId, observedAt, input.parserVersion, input.ocrVersion, input.profileId, confOf(input.stats.map((s) => s.confidence)), now],
      )
      scanIds.push(scanId)
      for (const s of input.stats) {
        const r = run(
          db,
          `INSERT INTO market_stats (scan_id, world_id, item_id, stat_window, side, transactions, avg_price_gp, min_price_gp, max_price_gp, source, observed_at_utc, created_at)
           VALUES (?,?,?, '30d', ?,?,?,?,?, 'own_capture', ?,?)`,
          [scanId, input.worldId, input.itemId, s.side, s.transactions, s.avgPrice, s.minPrice, s.maxPrice, observedAt, now],
        )
        for (const c of s.corrections) {
          run(db, 'INSERT INTO ocr_field_reviews (scan_id, stats_id, field_name, raw_value, ocr_value, corrected_value, reviewed_at) VALUES (?,?,?,?,?,?,?)', [scanId, Number(r.lastInsertRowid), c.field, c.raw, c.ocrValue, c.corrected, now])
        }
      }
    }
    run(db, `UPDATE screenshots SET processing_status = 'confirmed', screen_type = ?, world_id = ?, item_id = ? WHERE id = ?`, [input.screenType, input.worldId, input.itemId, input.screenshotId])
    return { scanIds, events }
  })
}
