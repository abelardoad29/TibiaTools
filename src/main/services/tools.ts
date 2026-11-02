import type { BoostedInfo, CharacterEventRow, ImbuementCatalog, TrackedCharacter } from '@shared/api'
import type { DataSource } from '@shared/provenance'
import imbuementsSeed from '@seed/imbuements.json'
import { detectCharacterEvents, deathKey } from '@core/domain/tools/characters'
import type { ImbuementDef, TierDef } from '@core/domain/tools/imbuements'
import { all, get, nowIso, parseJson, run, tx, type Db } from '../db/database'
import { tibiaData } from '../external/tibiadata'
import type { AppContext } from '../context'
import { itemsByName, requireWorld } from './catalog'
import { bestSellPrice } from './market'

export async function boosted(ctx: AppContext, refresh: boolean): Promise<BoostedInfo> {
  try {
    const r = await tibiaData(ctx.http).boosted(refresh)
    return { ...r, source: 'TibiaData', error: null }
  } catch (e) {
    ctx.log.warn('Boosted no disponible', e)
    return { creature: null, boss: null, fetchedAt: null, source: 'TibiaData', error: e instanceof Error ? e.message : String(e) }
  }
}

export function imbuements(): ImbuementCatalog {
  const s = imbuementsSeed as unknown as ImbuementCatalog & { tiers: TierDef[]; imbuements: ImbuementDef[] }
  return { tiers: s.tiers, imbuements: s.imbuements, tokenTradeable: s.tokenTradeable, tokensPerTier: s.tokensPerTier, durationHours: s.durationHours, source: s.source, notes: s.notes }
}

/** Mejor sell offer conocida de cada material en un mundo (comprar al instante). */
export function imbuementPrices(db: Db, world: string, names: string[]): Record<string, { price: number; observedAt: string; source: DataSource } | null> {
  const w = requireWorld(db, world)
  const items = itemsByName(db, names)
  const out: Record<string, { price: number; observedAt: string; source: DataSource } | null> = {}
  for (const name of names) {
    const item = items.find((i) => i.name.toLowerCase() === name.toLowerCase())
    out[name] = item ? bestSellPrice(db, w.id, item.id, true) : null
  }
  return out
}

// ---------- Personajes seguidos ----------

interface CharRow {
  id: number
  name: string
  world: string | null
  level: number | null
  vocation: string | null
  known_deaths_json: string
  last_checked_at: string | null
  last_error: string | null
}

const toChar = (r: CharRow): TrackedCharacter => ({ id: r.id, name: r.name, world: r.world, level: r.level, vocation: r.vocation, lastCheckedAt: r.last_checked_at, lastError: r.last_error })

export function listCharacters(db: Db): TrackedCharacter[] {
  return all<CharRow>(db, 'SELECT * FROM tracked_characters ORDER BY name').map(toChar)
}

export async function addCharacter(ctx: AppContext, name: string): Promise<TrackedCharacter> {
  const snap = await tibiaData(ctx.http).character(name)
  if (!snap) throw new Error(`No existe un personaje llamado «${name.trim()}» (según TibiaData). Revisa la ortografía.`)
  run(
    ctx.db,
    `INSERT INTO tracked_characters (name, world, level, vocation, known_deaths_json, last_checked_at, created_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(name) DO UPDATE SET world = excluded.world, level = excluded.level, vocation = excluded.vocation`,
    [snap.name, snap.world, snap.level, snap.vocation, JSON.stringify(snap.deaths.map(deathKey)), nowIso(), nowIso()],
  )
  return toChar(get<CharRow>(ctx.db, 'SELECT * FROM tracked_characters WHERE name = ?', [snap.name])!)
}

export function removeCharacter(db: Db, id: number): void {
  run(db, 'DELETE FROM tracked_characters WHERE id = ?', [id])
}

export function characterEvents(db: Db, limit: number): CharacterEventRow[] {
  return all<{ id: number; character: string; event_type: string; message: string; occurred_at: string | null; detected_at: string }>(
    db,
    'SELECT e.id, c.name AS character, e.event_type, e.message, e.occurred_at, e.detected_at FROM character_events e JOIN tracked_characters c ON c.id = e.character_id ORDER BY e.detected_at DESC LIMIT ?',
    [limit],
  ).map((r) => ({ id: r.id, character: r.character, type: r.event_type, message: r.message, occurredAt: r.occurred_at, detectedAt: r.detected_at }))
}

/** Consulta todos los personajes seguidos y registra eventos nuevos. Devuelve los mensajes nuevos. */
export async function refreshCharacters(ctx: AppContext): Promise<{ checked: number; messages: string[] }> {
  const api = tibiaData(ctx.http)
  const messages: string[] = []
  const chars = all<CharRow>(ctx.db, 'SELECT * FROM tracked_characters')
  for (const c of chars) {
    try {
      const snap = await api.character(c.name)
      if (!snap) throw new Error('no encontrado')
      const known = parseJson<string[]>(c.known_deaths_json, [])
      const events = detectCharacterEvents({ level: c.level, knownDeathKeys: known }, snap)
      tx(ctx.db, () => {
        for (const e of events) {
          const r = run(ctx.db, 'INSERT OR IGNORE INTO character_events (character_id, event_type, dedupe_key, message, occurred_at, detected_at) VALUES (?,?,?,?,?,?)', [c.id, e.type, e.dedupeKey, e.message, e.occurredAt, nowIso()])
          if (Number(r.changes) > 0) messages.push(e.message)
        }
        const deaths = [...new Set([...known, ...snap.deaths.map(deathKey)])].slice(-100)
        run(ctx.db, 'UPDATE tracked_characters SET world = ?, level = ?, vocation = ?, known_deaths_json = ?, last_checked_at = ?, last_error = NULL WHERE id = ?', [snap.world, snap.level, snap.vocation, JSON.stringify(deaths), nowIso(), c.id])
      })
    } catch (e) {
      run(ctx.db, 'UPDATE tracked_characters SET last_checked_at = ?, last_error = ? WHERE id = ?', [nowIso(), e instanceof Error ? e.message : String(e), c.id])
    }
  }
  return { checked: chars.length, messages }
}
