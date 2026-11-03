import { readFileSync } from 'node:fs'
import type { ConfirmOfferInput, ItemIdentificationResult, ScreenshotAnalysis } from '@shared/api'
import { learnFromItemEntry } from '@core/ocr/calibrate'
import { toGray } from '@core/ocr/image'
import { identifyItem, type NameCandidate } from '@core/ocr/match'
import { PARSER_VERSION, runOcr } from '@core/ocr/pipeline'
import type { OcrResult, Rect } from '@core/ocr/types'
import { all, get, nowIso, run, type Db } from '../db/database'
import type { AppContext } from '../context'
import { decodePng } from '../lib/png'
import { getScreenshot, screenshotNotes, screenshotPath, setScreenshotAnalysis } from './evidence'
import { addItemGlyphs, confirmScan, defaultOffersProfile, getProfile } from './scans'
import { getSettings } from './settings'
import { parseTibiaScreenshot } from './tibia-folder'

// Análisis automático de capturas del Market: ubica la ventana, identifica el item seleccionado (lista
// "Items:" contra el catálogo), deduce el mundo por el personaje del nombre de archivo de Tibia y lee las
// ofertas. Si todo cuadra, confirma el snapshot sin pasar por Revisión OCR; si no, deja la captura
// prellenada con los motivos para revisarla a mano.

export interface MarketAnalyzerDeps {
  /** Mundo actual de un personaje (TibiaData); null si no existe o no se pudo consultar. */
  lookupWorld(character: string): Promise<string | null>
  onAnalyzed(shotId: string, a: ScreenshotAnalysis): void
  /** Tras guardar un snapshot solo (para evaluar alertas). */
  onConfirmed(): void
}

export interface AnalyzeSummary {
  analyzed: number
  confirmed: number
  review: number
  notMarket: number
}

export interface MarketAnalyzer {
  /** Encola capturas (o todas las pendientes con `null`) y resuelve al terminar de analizarlas. */
  analyze(ids: string[] | null): Promise<AnalyzeSummary>
}

function catalog(db: Db): NameCandidate[] {
  return all<NameCandidate>(db, 'SELECT id, name FROM items WHERE is_market_tradeable = 1')
}

export function identify(db: Db, raw: string): ItemIdentificationResult {
  const r = identifyItem(raw, catalog(db))
  const strip = (m: { id: number; name: string; score: number }) => ({ id: m.id, name: m.name, score: Math.round(m.score * 1000) / 1000 })
  return { best: r.best ? strip(r.best) : null, candidates: r.candidates.map(strip), confident: r.confident }
}

/** Personaje del nombre de archivo de Tibia guardado en las notas de la sesión de captura. */
function characterOf(db: Db, shotId: string): string | null {
  const notes = screenshotNotes(db, shotId)
  if (!notes?.startsWith('Tibia:')) return null
  return parseTibiaScreenshot(notes.split(' · ').at(-1) ?? '')?.character ?? null
}

/** Lo leído coincide con el nombre salvo en letras aún desconocidas: seguro para aprenderlas. */
const onlyUnknownLetters = (read: string, name: string) => read.length === name.length && read.includes('?') && [...read].every((c, i) => c === '?' || c.toLowerCase() === name[i]!.toLowerCase())

/** Aprende las letras de una entrada de la lista con el nombre real del item. Devuelve los glifos nuevos. */
export function learnItemName(db: Db, profileId: number, shotId: string, rect: Rect, name: string): number {
  const profile = getProfile(db, profileId)
  const path = screenshotPath(db, shotId)
  if (!profile?.itemList || !path?.toLowerCase().endsWith('.png')) return 0
  const gray = toGray(decodePng(readFileSync(path)))
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > gray.width || rect.y + rect.h > gray.height) return 0
  const learned = learnFromItemEntry(gray, rect, profile.preprocess, name)
  return 'error' in learned ? 0 : addItemGlyphs(db, profileId, learned.glyphs)
}

function minConfidence(r: OcrResult): number {
  const xs = r.rows.flatMap((row) => [row.amount.confidence, row.unitPrice.confidence, ...(row.totalPrice ? [row.totalPrice.confidence] : [])])
  return xs.length ? Math.min(...xs) : 0
}

export async function analyzeScreenshot(ctx: AppContext, shotId: string, deps: MarketAnalyzerDeps): Promise<ScreenshotAnalysis | null> {
  const { db } = ctx
  const shot = getScreenshot(db, shotId)
  if (!shot || shot.status === 'confirmed') return null
  const settings = getSettings(db)
  const character = characterOf(db, shotId)
  const fromTibia = character !== null
  const a: ScreenshotAnalysis = { at: nowIso(), decision: 'review', reasons: [], profileId: null, itemRead: null, item: null, character, world: null, rows: 0, offset: null }
  const finish = (status: 'processed' | 'rejected' | null) => {
    setScreenshotAnalysis(db, shotId, a, status)
    deps.onAnalyzed(shotId, a)
    return a
  }

  const path = screenshotPath(db, shotId)
  if (!path?.toLowerCase().endsWith('.png')) {
    a.decision = 'error'
    a.reasons.push('El análisis automático solo lee PNG (los screenshots de Tibia lo son)')
    return finish(null)
  }
  const profile = defaultOffersProfile(db)
  if (!profile) {
    a.decision = 'error'
    a.reasons.push('No hay un perfil OCR de ofertas con ancla y glifos')
    return finish(null)
  }
  a.profileId = profile.id
  const result = runOcr(decodePng(readFileSync(path)), profile)
  if (!result.marketFound) {
    a.decision = 'not_market'
    a.reasons.push('No se encontró la ventana del Market en la captura')
    // Un screenshot de juego normal de la carpeta de Tibia se descarta (se puede recuperar); una captura
    // propia se deja pendiente por si es un recorte que se revisa con otro perfil.
    return finish(fromTibia ? 'rejected' : null)
  }
  a.offset = { dx: result.offset.dx, dy: result.offset.dy }
  a.rows = result.rows.length
  a.reasons.push(...result.warnings)

  // Item seleccionado en la lista.
  const sel = result.item?.selected ?? null
  a.itemRead = sel?.raw ?? null
  if (!result.item) a.reasons.push('El perfil no lee la lista de items')
  else if (!sel) a.reasons.push(result.item.entries.length ? 'No se pudo decidir qué item está seleccionado en la lista' : 'La lista de items está vacía')
  const id = sel ? identifyItem(sel.raw, catalog(db)) : null
  if (id?.best) a.item = { id: id.best.id, name: id.best.name, score: Math.round(id.best.score * 1000) / 1000, confident: id.confident }
  if (sel && !id?.confident) a.reasons.push(id?.best ? `Item dudoso: se leyó «${sel.raw}», ¿${id.best.name}?` : `Item no reconocido: se leyó «${sel.raw}»`)

  // Mundo por el personaje.
  let worldId: number | null = null
  if (!character) a.reasons.push('La captura no viene de la carpeta de Tibia: no se sabe el personaje ni el mundo')
  else {
    const world = settings.network.tibiaDataEnabled ? await deps.lookupWorld(character).catch(() => null) : null
    a.world = world
    worldId = world ? (get<{ id: number }>(db, 'SELECT id FROM worlds WHERE name = ?', [world])?.id ?? null) : null
    if (!world) a.reasons.push(settings.network.tibiaDataEnabled ? `No se pudo saber el mundo de ${character} (TibiaData)` : `TibiaData está desactivado: elige el mundo de ${character}`)
    else if (!worldId) a.reasons.push(`Mundo ${world} no está en el catálogo`)
  }

  // Ofertas.
  const bad = result.rows.filter((r) => r.issues.length)
  if (!result.rows.length) a.reasons.push('No se leyeron ofertas')
  if (bad.length) a.reasons.push(`${bad.length} fila(s) con errores: ${bad[0]!.issues.join('; ')}`)
  const conf = minConfidence(result)
  if (result.rows.length && !bad.length && conf < settings.ocr.acceptThreshold) a.reasons.push(`Confianza mínima ${conf.toFixed(3)} bajo el umbral de aceptación ${settings.ocr.acceptThreshold}`)

  const itemId = a.item?.confident ? a.item.id : null
  if (!a.reasons.length && !settings.collector.autoAnalyze.autoConfirm) a.reasons.push('Confirmación automática desactivada en Ajustes')
  if (!a.reasons.length && itemId && worldId) {
    const offers: ConfirmOfferInput[] = result.rows.map((r) => ({
      side: r.side,
      rowIndex: r.rowIndex,
      unitPrice: r.unitPrice.value!,
      amount: r.amount.value!,
      totalPrice: r.totalPrice?.value ?? null,
      expirationText: r.endsAt?.raw ?? null,
      rawPriceText: r.unitPrice.raw,
      rawAmountText: r.amount.raw,
      priceConfidence: r.unitPrice.confidence,
      amountConfidence: r.amount.confidence,
      corrections: [],
    }))
    try {
      confirmScan(db, { screenshotId: shotId, profileId: profile.id, worldId, itemId, screenType: 'offers', ocrVersion: result.ocrVersion, parserVersion: PARSER_VERSION, offers, stats: [] }, [
        ...new Set(profile.tables.map((t) => t.side)),
      ])
      a.decision = 'confirmed'
      if (sel && profile.id && a.item && onlyUnknownLetters(sel.raw, a.item.name)) {
        try {
          learnItemName(db, profile.id, shotId, sel.rect, a.item.name)
        } catch (e) {
          ctx.log.warn('No se pudieron aprender letras del item', e)
        }
      }
      deps.onConfirmed()
      return finish(null)
    } catch (e) {
      a.reasons.push(`No se pudo guardar el snapshot: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // Para revisar: la captura queda prellenada con lo que se pudo detectar.
  a.decision = 'review'
  run(db, `UPDATE screenshots SET screen_type = 'offers', world_id = COALESCE(?, world_id), item_id = COALESCE(?, item_id) WHERE id = ? AND processing_status <> 'confirmed'`, [worldId, itemId, shotId])
  return finish('processed')
}

export function createMarketAnalyzer(ctx: AppContext, deps: MarketAnalyzerDeps): MarketAnalyzer {
  // El mundo de un personaje casi nunca cambia: se recuerda unas horas para no consultar TibiaData por cada captura.
  const worlds = new Map<string, { world: string | null; at: number }>()
  const lookupWorld = async (character: string) => {
    const key = character.toLowerCase()
    const hit = worlds.get(key)
    if (hit && Date.now() - hit.at < (hit.world ? 6 * 3_600_000 : 60_000)) return hit.world
    const world = await deps.lookupWorld(character)
    worlds.set(key, { world, at: Date.now() })
    return world
  }
  let chain: Promise<unknown> = Promise.resolve()
  return {
    analyze(ids) {
      const job = chain.then(async () => {
        const targets = ids ?? all<{ id: string }>(ctx.db, `SELECT id FROM screenshots WHERE processing_status IN ('new','processed') ORDER BY captured_at_utc`).map((r) => r.id)
        const summary: AnalyzeSummary = { analyzed: 0, confirmed: 0, review: 0, notMarket: 0 }
        for (const id of targets) {
          try {
            const a = await analyzeScreenshot(ctx, id, { ...deps, lookupWorld })
            if (!a) continue
            summary.analyzed++
            if (a.decision === 'confirmed') summary.confirmed++
            else if (a.decision === 'not_market') summary.notMarket++
            else summary.review++
          } catch (e) {
            ctx.log.warn(`Análisis automático de ${id}`, e)
          }
          // Cede el hilo entre capturas: decodificar y leer una captura bloquea unos ~50 ms.
          await new Promise((r) => setImmediate(r))
        }
        return summary
      })
      chain = job.catch(() => undefined)
      return job
    },
  }
}
