import { randomUUID } from 'node:crypto'
import type { BookView, EventRow, ImportResult, ItemSummary, ScanSummary, StatsRow } from '@shared/api'
import type { DataSource } from '@shared/provenance'
import type { BookSide, OfferLevel } from '@core/domain/market/order-book'
import { priceStats } from '@core/domain/pricing/stats'
import { all, get, nowIso, run, tx, type Db } from '../db/database'
import { tibiaMarket, unixToIso } from '../external/tibiamarket'
import type { AppContext } from '../context'
import { iconUrl, itemByTibiaId, requireWorld } from './catalog'

// ---------- Importación de terceros (tibiamarket) ----------

/**
 * Importa /market_values de un mundo (mejor precio + estadísticas día/mes) y, si se piden ids,
 * el order book completo (/market_board) de esos items. Todo queda como source = 'third_party'
 * con la hora del dato. Las cantidades nunca se inventan: sin board no hay profundidad.
 */
export async function importThirdParty(ctx: AppContext, worldName: string, itemIds: number[] | null): Promise<ImportResult> {
  const world = requireWorld(ctx.db, worldName)
  const api = tibiaMarket(ctx.http)
  const result: ImportResult = { scans: 0, offers: 0, stats: 0, skipped: 0, errors: [] }
  const values = await api.marketValues(world.name, itemIds)
  const createdAt = nowIso()

  tx(ctx.db, () => {
    for (const v of values) {
      const item = itemByTibiaId(ctx.db, v.id)
      if (!item) {
        result.skipped++
        continue
      }
      const observedAt = unixToIso(v.time)
      const q = run(
        ctx.db,
        `INSERT OR IGNORE INTO market_quotes (world_id, item_id, best_buy_gp, best_sell_gp, buy_offers, sell_offers, source, observed_at_utc, created_at)
         VALUES (?,?,?,?,NULL,NULL,'third_party',?,?)`,
        [world.id, item.id, v.buy_offer && v.buy_offer > 0 ? v.buy_offer : null, v.sell_offer && v.sell_offer > 0 ? v.sell_offer : null, observedAt, createdAt],
      )
      if (Number(q.changes) === 0) result.skipped++
      const stat = (window: '30d' | '1d', side: 'buy' | 'sell', tx: number | null | undefined, avg: number | null | undefined, min: number | null | undefined, max: number | null | undefined) => {
        // tibiamarket usa -1 / 0 como "sin dato"
        const clean = (x: number | null | undefined) => (x === null || x === undefined || x < 0 ? null : x)
        if ([tx, avg, min, max].every((x) => clean(x) === null)) return
        const r = run(
          ctx.db,
          `INSERT OR IGNORE INTO market_stats (world_id, item_id, stat_window, side, transactions, avg_price_gp, min_price_gp, max_price_gp, source, observed_at_utc, created_at)
           VALUES (?,?,?,?,?,?,?,?,'third_party',?,?)`,
          [world.id, item.id, window, side, clean(tx), clean(avg), clean(min) || null, clean(max) || null, observedAt, createdAt],
        )
        result.stats += Number(r.changes)
      }
      stat('30d', 'sell', v.month_sold, v.month_average_sell, v.month_lowest_sell, v.month_highest_sell)
      stat('30d', 'buy', v.month_bought, v.month_average_buy, v.month_lowest_buy, v.month_highest_buy)
      stat('1d', 'sell', v.day_sold, v.day_average_sell, v.day_lowest_sell, v.day_highest_sell)
      stat('1d', 'buy', v.day_bought, v.day_average_buy, v.day_lowest_buy, v.day_highest_buy)
    }
  })

  for (const tibiaId of itemIds ?? []) {
    const item = itemByTibiaId(ctx.db, tibiaId)
    if (!item) continue
    try {
      const board = await api.board(world.name, tibiaId)
      const ref = `tibiamarket:${world.name}:${tibiaId}:${board.update_time}`
      if (get(ctx.db, `SELECT 1 FROM market_scans WHERE source = 'third_party' AND source_ref = ?`, [ref])) {
        result.skipped++
        continue
      }
      tx(ctx.db, () => {
        const scanId = randomUUID()
        run(
          ctx.db,
          `INSERT INTO market_scans (id, world_id, item_id, scan_type, source, source_ref, observed_at_utc, parser_version, review_status, created_at)
           VALUES (?,?,?, 'combined', 'third_party', ?, ?, 'tibiamarket-board-v1', 'accepted', ?)`,
          [scanId, world.id, item.id, ref, unixToIso(board.update_time), nowIso()],
        )
        result.scans++
        const ins = ctx.db.prepare(
          `INSERT INTO market_offers (scan_id, offer_type, unit_price_gp, amount, expiration_at_utc, row_index, created_at) VALUES (?,?,?,?,?,?,?)`,
        )
        const add = (side: 'buy' | 'sell', list: { amount: number; price: number; time: number }[]) =>
          list.forEach((o, i) => {
            if (o.amount <= 0 || o.price <= 0) return
            // En /market_board, `time` coincide con el vencimiento (≈ 30 días tras publicar).
            ins.run(scanId, side, o.price, o.amount, unixToIso(o.time), i, nowIso())
            result.offers++
          })
        add('sell', board.sellers)
        add('buy', board.buyers)
      })
    } catch (e) {
      result.errors.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  ctx.log.info(`Importación tibiamarket ${world.name}`, result)
  return result
}

// ---------- Consultas ----------

interface ScanRow {
  id: string
  scan_type: string
  source: DataSource
  observed_at_utc: string
  confidence: number | null
}

const sourceFilter = (includeThirdParty: boolean) => (includeThirdParty ? '' : `AND s.source <> 'third_party'`)

/** Último scan aceptado que observó ese lado del libro (los "combined" observan ambos). */
export function latestScanForSide(db: Db, worldId: number, itemId: number, side: 'buy' | 'sell', includeThirdParty: boolean, maxAgeHours: number | null): ScanRow | undefined {
  const minTime = maxAgeHours === null ? '0000' : new Date(Date.now() - maxAgeHours * 3_600_000).toISOString()
  return get<ScanRow>(
    db,
    `SELECT s.id, s.scan_type, s.source, s.observed_at_utc, s.confidence FROM market_scans s
     WHERE s.world_id = ? AND s.item_id = ? AND s.review_status = 'accepted' AND s.scan_type IN (?, 'combined', ?)
       AND s.observed_at_utc >= ? ${sourceFilter(includeThirdParty)}
     ORDER BY s.observed_at_utc DESC, CASE s.source WHEN 'own_capture' THEN 0 ELSE 1 END LIMIT 1`,
    [worldId, itemId, side, `tc_${side}`, minTime],
  )
}

function offersOf(db: Db, scanId: string, side: 'buy' | 'sell') {
  return all<{ unit_price_gp: number; amount: number; total_price_gp: number | null; expiration_at_utc: string | null; price_confidence: number | null; amount_confidence: number | null }>(
    db,
    `SELECT unit_price_gp, amount, total_price_gp, expiration_at_utc, price_confidence, amount_confidence FROM market_offers WHERE scan_id = ? AND offer_type = ?
     ORDER BY unit_price_gp ${side === 'sell' ? 'ASC' : 'DESC'}`,
    [scanId, side],
  )
}

export function bookSide(db: Db, worldId: number, itemId: number, side: 'buy' | 'sell', includeThirdParty: boolean, maxAgeHours: number | null = null): BookSide | null {
  const scan = latestScanForSide(db, worldId, itemId, side, includeThirdParty, maxAgeHours)
  if (!scan) return null
  const levels: OfferLevel[] = offersOf(db, scan.id, side).map((o) => ({ unitPrice: o.unit_price_gp, amount: o.amount, expiresAt: o.expiration_at_utc }))
  return { side, levels, evidence: { scanId: scan.id, observedAt: scan.observed_at_utc, source: scan.source as 'own_capture', confidence: scan.confidence } }
}

export function bookView(db: Db, worldName: string, itemId: number, includeThirdParty: boolean) {
  const world = requireWorld(db, worldName)
  const view = (side: 'buy' | 'sell'): BookView | null => {
    const scan = latestScanForSide(db, world.id, itemId, side, includeThirdParty, null)
    if (!scan) return null
    return {
      scanId: scan.id,
      side,
      source: scan.source,
      observedAt: scan.observed_at_utc,
      confidence: scan.confidence,
      offers: offersOf(db, scan.id, side).map((o) => ({
        unitPrice: o.unit_price_gp,
        amount: o.amount,
        totalPrice: o.total_price_gp,
        expiresAt: o.expiration_at_utc,
        priceConfidence: o.price_confidence,
        amountConfidence: o.amount_confidence,
      })),
    }
  }
  return { sell: view('sell'), buy: view('buy'), stats: latestStats(db, world.id, itemId, includeThirdParty) }
}

export function latestStats(db: Db, worldId: number, itemId: number, includeThirdParty: boolean): StatsRow[] {
  return all<{ side: 'buy' | 'sell'; stat_window: '30d' | '1d'; transactions: number | null; avg_price_gp: number | null; min_price_gp: number | null; max_price_gp: number | null; source: DataSource; observed_at_utc: string }>(
    db,
    `SELECT * FROM market_stats s WHERE world_id = ? AND item_id = ? ${sourceFilter(includeThirdParty)}
       AND observed_at_utc = (SELECT MAX(observed_at_utc) FROM market_stats x WHERE x.world_id = s.world_id AND x.item_id = s.item_id AND x.side = s.side AND x.stat_window = s.stat_window AND x.source = s.source)
     ORDER BY CASE source WHEN 'own_capture' THEN 0 ELSE 1 END, stat_window, side`,
    [worldId, itemId],
  ).map((r) => ({ side: r.side, window: r.stat_window, transactions: r.transactions, avgPrice: r.avg_price_gp, minPrice: r.min_price_gp, maxPrice: r.max_price_gp, source: r.source, observedAt: r.observed_at_utc }))
}

/** Precios de sell offers observados (cada nivel de cada snapshot) para el histórico. */
export function sellObservations(db: Db, worldId: number, itemId: number, days: number, includeThirdParty: boolean) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const rows = all<{ scan_id: string; unit_price_gp: number; amount: number; observed_at_utc: string; source: DataSource }>(
    db,
    `SELECT o.scan_id, o.unit_price_gp, o.amount, s.observed_at_utc, s.source FROM market_offers o JOIN market_scans s ON s.id = o.scan_id
     WHERE s.world_id = ? AND s.item_id = ? AND s.review_status = 'accepted' AND o.offer_type = 'sell' AND s.observed_at_utc >= ? ${sourceFilter(includeThirdParty)}`,
    [worldId, itemId, since],
  )
  const snapshots = new Set(rows.map((r) => r.scan_id)).size
  const times = rows.map((r) => r.observed_at_utc).sort()
  const daysCovered = times.length ? Math.max(1, Math.ceil((new Date(times.at(-1)!).getTime() - new Date(times[0]!).getTime()) / 86_400_000)) : 0
  return { rows, snapshots, daysCovered, lastObservedAt: times.at(-1) ?? null }
}

export function history(db: Db, worldName: string, itemId: number, days: number, includeThirdParty: boolean) {
  const world = requireWorld(db, worldName)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const points = all<{ observed_at_utc: string; source: DataSource; best_sell: number | null; best_buy: number | null }>(
    db,
    `SELECT s.observed_at_utc, s.source,
       (SELECT MIN(unit_price_gp) FROM market_offers o WHERE o.scan_id = s.id AND o.offer_type = 'sell') AS best_sell,
       (SELECT MAX(unit_price_gp) FROM market_offers o WHERE o.scan_id = s.id AND o.offer_type = 'buy') AS best_buy
     FROM market_scans s WHERE s.world_id = ? AND s.item_id = ? AND s.review_status = 'accepted' AND s.scan_type <> 'details' AND s.observed_at_utc >= ? ${sourceFilter(includeThirdParty)}
     UNION ALL
     SELECT q.observed_at_utc, q.source, q.best_sell_gp, q.best_buy_gp FROM market_quotes q
     WHERE q.world_id = ? AND q.item_id = ? AND q.observed_at_utc >= ? ${includeThirdParty ? '' : `AND q.source <> 'third_party'`}
     ORDER BY 1`,
    [world.id, itemId, since, world.id, itemId, since],
  )
  const obs = (side: 'buy' | 'sell') =>
    all<{ unit_price_gp: number; amount: number; observed_at_utc: string }>(
      db,
      `SELECT o.unit_price_gp, o.amount, s.observed_at_utc FROM market_offers o JOIN market_scans s ON s.id = o.scan_id
       WHERE s.world_id = ? AND s.item_id = ? AND s.review_status = 'accepted' AND o.offer_type = ? AND s.observed_at_utc >= ? ${sourceFilter(includeThirdParty)}`,
      [world.id, itemId, side, since],
    ).map((r) => ({ price: r.unit_price_gp, amount: r.amount, observedAt: r.observed_at_utc }))
  const events: EventRow[] = all<{ id: number; event_type: string; offer_type: string; price_gp: number | null; quantity: number | null; confidence: number; note: string | null; detected_at_utc: string }>(
    db,
    `SELECT * FROM market_events WHERE world_id = ? AND item_id = ? AND detected_at_utc >= ? ORDER BY detected_at_utc DESC LIMIT 200`,
    [world.id, itemId, since],
  ).map((e) => ({ id: e.id, type: e.event_type, side: e.offer_type, price: e.price_gp, quantity: e.quantity, confidence: e.confidence, note: e.note ?? '', detectedAt: e.detected_at_utc }))
  const official = all<{ side: 'buy' | 'sell'; stat_window: '30d' | '1d'; transactions: number | null; avg_price_gp: number | null; min_price_gp: number | null; max_price_gp: number | null; source: DataSource; observed_at_utc: string }>(
    db,
    `SELECT * FROM market_stats s WHERE world_id = ? AND item_id = ? AND observed_at_utc >= ? ${sourceFilter(includeThirdParty)} ORDER BY observed_at_utc`,
    [world.id, itemId, since],
  ).map((r) => ({ side: r.side, window: r.stat_window, transactions: r.transactions, avgPrice: r.avg_price_gp, minPrice: r.min_price_gp, maxPrice: r.max_price_gp, source: r.source, observedAt: r.observed_at_utc }))
  return {
    points: points.map((p) => ({ observedAt: p.observed_at_utc, bestSell: p.best_sell, bestBuy: p.best_buy, source: p.source })),
    sellStats: priceStats(obs('sell')),
    buyStats: priceStats(obs('buy')),
    official,
    events,
  }
}

export function listScans(db: Db, f: { world: string | null; itemId: number | null; source: DataSource | null; limit: number }): ScanSummary[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (f.world) {
    where.push('w.name = ?')
    params.push(f.world)
  }
  if (f.itemId) {
    where.push('s.item_id = ?')
    params.push(f.itemId)
  }
  if (f.source) {
    where.push('s.source = ?')
    params.push(f.source)
  }
  return all<{ id: string; world: string; item_id: number; item_name: string; scan_type: string; source: DataSource; observed_at_utc: string; review_status: string; confidence: number | null; offers: number }>(
    db,
    `SELECT s.id, w.name AS world, s.item_id, i.name AS item_name, s.scan_type, s.source, s.observed_at_utc, s.review_status, s.confidence,
       (SELECT COUNT(*) FROM market_offers o WHERE o.scan_id = s.id) AS offers
     FROM market_scans s JOIN worlds w ON w.id = s.world_id JOIN items i ON i.id = s.item_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.observed_at_utc DESC LIMIT ?`,
    [...params, f.limit],
  ).map((r) => ({ id: r.id, world: r.world, itemId: r.item_id, itemName: r.item_name, scanType: r.scan_type, source: r.source, observedAt: r.observed_at_utc, reviewStatus: r.review_status, confidence: r.confidence, offers: r.offers }))
}

export function coverage(db: Db) {
  return all<{ world: string; scans: number; items: number; own_scans: number; third_party_scans: number; last: string | null }>(
    db,
    `SELECT w.name AS world, COUNT(*) AS scans, COUNT(DISTINCT s.item_id) AS items,
       SUM(s.source = 'own_capture') AS own_scans, SUM(s.source = 'third_party') AS third_party_scans, MAX(s.observed_at_utc) AS last
     FROM market_scans s JOIN worlds w ON w.id = s.world_id WHERE s.review_status = 'accepted' GROUP BY w.name ORDER BY last DESC`,
  ).map((r) => ({ world: r.world, scans: r.scans, items: r.items, ownScans: r.own_scans, thirdPartyScans: r.third_party_scans, lastObservedAt: r.last }))
}

export function itemsWithData(db: Db, worldName: string): ItemSummary[] {
  const world = requireWorld(db, worldName)
  return all<{ id: number; tibia_item_id: number | null; name: string; category: string | null; tier: number | null }>(
    db,
    `SELECT DISTINCT i.id, i.tibia_item_id, i.name, i.category, i.tier FROM items i
     WHERE i.id IN (SELECT item_id FROM market_scans WHERE world_id = ? AND review_status = 'accepted' UNION SELECT item_id FROM market_quotes WHERE world_id = ?)
     ORDER BY i.name`,
    [world.id, world.id],
  ).map((r) => ({ id: r.id, tibiaItemId: r.tibia_item_id, name: r.name, category: r.category, tier: r.tier, iconUrl: iconUrl(r.id) }))
}

/** Mejor precio de venta conocido (para imbuements y alertas): primero order book, luego quote. */
export function bestSellPrice(db: Db, worldId: number, itemId: number, includeThirdParty: boolean): { price: number; observedAt: string; source: DataSource } | null {
  const book = bookSide(db, worldId, itemId, 'sell', includeThirdParty)
  const fromBook = book?.levels[0] ? { price: book.levels[0].unitPrice, observedAt: book.evidence.observedAt, source: book.evidence.source as DataSource } : null
  const q = get<{ best_sell_gp: number | null; observed_at_utc: string; source: DataSource }>(
    db,
    `SELECT best_sell_gp, observed_at_utc, source FROM market_quotes WHERE world_id = ? AND item_id = ? AND best_sell_gp IS NOT NULL ${includeThirdParty ? '' : `AND source <> 'third_party'`} ORDER BY observed_at_utc DESC LIMIT 1`,
    [worldId, itemId],
  )
  const fromQuote = q?.best_sell_gp ? { price: q.best_sell_gp, observedAt: q.observed_at_utc, source: q.source } : null
  if (fromBook && fromQuote) return fromBook.observedAt >= fromQuote.observedAt ? fromBook : fromQuote
  return fromBook ?? fromQuote
}

/** Mejores precios por item en un mundo (quotes + books) para filtrar candidatos entre dos mundos. */
export function topOfBook(db: Db, worldId: number, includeThirdParty: boolean) {
  const out = new Map<number, { bestSell: number | null; bestBuy: number | null; observedAt: string; source: DataSource }>()
  const quotes = all<{ item_id: number; best_buy_gp: number | null; best_sell_gp: number | null; observed_at_utc: string; source: DataSource }>(
    db,
    `SELECT q.item_id, q.best_buy_gp, q.best_sell_gp, q.observed_at_utc, q.source FROM market_quotes q
     WHERE q.world_id = ? ${includeThirdParty ? '' : `AND q.source <> 'third_party'`}
       AND q.observed_at_utc = (SELECT MAX(observed_at_utc) FROM market_quotes x WHERE x.world_id = q.world_id AND x.item_id = q.item_id)`,
    [worldId],
  )
  for (const q of quotes) out.set(q.item_id, { bestSell: q.best_sell_gp, bestBuy: q.best_buy_gp, observedAt: q.observed_at_utc, source: q.source })
  const scans = all<{ item_id: number; observed_at_utc: string; source: DataSource; best_sell: number | null; best_buy: number | null }>(
    db,
    `SELECT s.item_id, s.observed_at_utc, s.source,
       (SELECT MIN(unit_price_gp) FROM market_offers o WHERE o.scan_id = s.id AND o.offer_type = 'sell') AS best_sell,
       (SELECT MAX(unit_price_gp) FROM market_offers o WHERE o.scan_id = s.id AND o.offer_type = 'buy') AS best_buy
     FROM market_scans s WHERE s.world_id = ? AND s.review_status = 'accepted' AND s.scan_type <> 'details' ${sourceFilter(includeThirdParty)}
       AND s.observed_at_utc = (SELECT MAX(observed_at_utc) FROM market_scans x WHERE x.world_id = s.world_id AND x.item_id = s.item_id AND x.review_status = 'accepted' AND x.scan_type <> 'details')`,
    [worldId],
  )
  for (const s of scans) {
    const prev = out.get(s.item_id)
    if (!prev || prev.observedAt <= s.observed_at_utc) out.set(s.item_id, { bestSell: s.best_sell, bestBuy: s.best_buy, observedAt: s.observed_at_utc, source: s.source })
  }
  return out
}
