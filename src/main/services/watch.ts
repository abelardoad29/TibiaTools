import type { WatchEntry, WatchEvent, WatchList, WatchOnline, WatchStatus } from '@shared/api'
import { diffOnline, toOnlineMap, trackBurst, watchKey, type BurstState, type OnlinePlayer } from '@core/domain/watch/online'
import { all, get, nowIso, run, tx, type Db } from '../db/database'
import { tibiaData } from '../external/tibiadata'
import type { AppContext } from '../context'
import { getSettings } from './settings'

// Vigilancia de listas (hunted, amigos…). Tibia no ofrece un canal en tiempo real: se lee la lista pública
// de conectados de cada mundo con un personaje vigilado (TibiaData la guarda en caché 60 s) y los cambios
// se empujan al instante a la ventana y a notificaciones de Windows.

const MIN_INTERVAL_SEC = 60
const CHARACTER_REFRESH_MS = 6 * 3_600_000
const GUILD_REFRESH_MS = 30 * 60_000

// ---------- Listas y entradas ----------

interface ListRow {
  id: number
  name: string
  notify_login: number
  burst_threshold: number | null
  burst_window_sec: number
}

export function listWatchLists(db: Db): WatchList[] {
  return all<ListRow & { entries: number; online: number }>(
    db,
    `SELECT l.*, (SELECT COUNT(*) FROM watch_entries e WHERE e.list_id = l.id) AS entries,
       (SELECT COUNT(DISTINCT s.name_key) FROM watch_status s WHERE s.online = 1 AND s.name_key IN (
          SELECT lower(e.name) FROM watch_entries e WHERE e.list_id = l.id AND e.kind = 'character'
          UNION SELECT lower(m.name) FROM watch_guild_members m JOIN watch_entries e ON e.id = m.entry_id WHERE e.list_id = l.id)) AS online
     FROM watch_lists l ORDER BY l.id`,
  ).map((r) => ({ id: r.id, name: r.name, notifyLogin: r.notify_login === 1, burstThreshold: r.burst_threshold, burstWindowSec: r.burst_window_sec, entries: r.entries, online: r.online }))
}

export function saveWatchList(db: Db, l: { id: number | null; name: string; notifyLogin: boolean; burstThreshold: number | null; burstWindowSec: number }): WatchList {
  let id = l.id
  if (id === null) {
    id = Number(run(db, 'INSERT INTO watch_lists (name, notify_login, burst_threshold, burst_window_sec, created_at) VALUES (?,?,?,?,?)', [l.name.trim(), l.notifyLogin, l.burstThreshold, l.burstWindowSec, nowIso()]).lastInsertRowid)
  } else {
    run(db, 'UPDATE watch_lists SET name = ?, notify_login = ?, burst_threshold = ?, burst_window_sec = ? WHERE id = ?', [l.name.trim(), l.notifyLogin, l.burstThreshold, l.burstWindowSec, id])
  }
  return listWatchLists(db).find((x) => x.id === id)!
}

interface EntryRow {
  id: number
  list_id: number
  kind: 'character' | 'guild'
  name: string
  world: string | null
  note: string | null
  resolved_at: string | null
}

export function listWatchEntries(db: Db, listId: number | null): WatchEntry[] {
  const rows = all<EntryRow & { members: number | null; online: number; level: number | null; vocation: string | null; last_login_at: string | null; last_seen_at: string | null }>(
    db,
    `SELECT e.*,
       CASE WHEN e.kind = 'guild' THEN (SELECT COUNT(*) FROM watch_guild_members m WHERE m.entry_id = e.id) END AS members,
       CASE WHEN e.kind = 'guild'
         THEN (SELECT COUNT(*) FROM watch_guild_members m JOIN watch_status s ON s.name_key = lower(m.name) WHERE m.entry_id = e.id AND s.online = 1)
         ELSE COALESCE((SELECT s.online FROM watch_status s WHERE s.name_key = lower(e.name)), 0) END AS online,
       s.level, s.vocation, s.last_login_at, s.last_seen_at
     FROM watch_entries e LEFT JOIN watch_status s ON e.kind = 'character' AND s.name_key = lower(e.name)
     ${listId === null ? '' : 'WHERE e.list_id = ?'} ORDER BY online DESC, e.name`,
    listId === null ? [] : [listId],
  )
  return rows.map((r) => ({
    id: r.id,
    listId: r.list_id,
    kind: r.kind,
    name: r.name,
    world: r.world,
    note: r.note,
    members: r.members,
    online: r.online,
    level: r.level,
    vocation: r.vocation,
    lastLoginAt: r.last_login_at,
    lastSeenAt: r.last_seen_at,
  }))
}

function storeGuildMembers(db: Db, entryId: number, members: { name: string; rank?: string; level: number; vocation: string }[]): void {
  run(db, 'DELETE FROM watch_guild_members WHERE entry_id = ?', [entryId])
  for (const m of members) run(db, 'INSERT OR IGNORE INTO watch_guild_members (entry_id, name, rank, level, vocation) VALUES (?,?,?,?,?)', [entryId, m.name, m.rank ?? null, m.level, m.vocation])
}

/** Agrega un personaje o una guild. Se valida contra TibiaData: un nombre inexistente falla al instante. */
export async function addWatchEntry(ctx: AppContext, e: { listId: number; kind: 'character' | 'guild'; name: string; note: string | null }): Promise<WatchEntry> {
  const api = tibiaData(ctx.http)
  if (!get(ctx.db, 'SELECT 1 FROM watch_lists WHERE id = ?', [e.listId])) throw new Error('La lista no existe')
  if (e.kind === 'character') {
    const ch = await api.character(e.name)
    if (!ch) throw new Error(`No existe un personaje llamado «${e.name.trim()}» (según TibiaData).`)
    run(ctx.db, `INSERT INTO watch_entries (list_id, kind, name, world, note, resolved_at, created_at) VALUES (?, 'character', ?, ?, ?, ?, ?) ON CONFLICT(list_id, kind, name) DO UPDATE SET world = excluded.world, note = excluded.note, resolved_at = excluded.resolved_at`, [
      e.listId,
      ch.name,
      ch.world,
      e.note,
      nowIso(),
      nowIso(),
    ])
    return listWatchEntries(ctx.db, e.listId).find((x) => x.kind === 'character' && x.name === ch.name)!
  }
  const g = await api.guild(e.name)
  if (!g) throw new Error(`No existe una guild llamada «${e.name.trim()}» (según TibiaData).`)
  tx(ctx.db, () => {
    run(ctx.db, `INSERT INTO watch_entries (list_id, kind, name, world, note, resolved_at, created_at) VALUES (?, 'guild', ?, ?, ?, ?, ?) ON CONFLICT(list_id, kind, name) DO UPDATE SET world = excluded.world, note = excluded.note, resolved_at = excluded.resolved_at`, [
      e.listId,
      g.name,
      g.world,
      e.note,
      nowIso(),
      nowIso(),
    ])
    const id = get<{ id: number }>(ctx.db, `SELECT id FROM watch_entries WHERE list_id = ? AND kind = 'guild' AND name = ?`, [e.listId, g.name])!.id
    storeGuildMembers(ctx.db, id, g.members)
  })
  return listWatchEntries(ctx.db, e.listId).find((x) => x.kind === 'guild' && x.name === g.name)!
}

export function listWatchOnline(db: Db): WatchOnline[] {
  const rows = all<{ name: string; world: string; level: number | null; vocation: string | null; last_login_at: string | null; list_name: string; via: string | null }>(
    db,
    `SELECT s.name, s.world, s.level, s.vocation, s.last_login_at, l.name AS list_name, NULL AS via
       FROM watch_status s JOIN watch_entries e ON e.kind = 'character' AND lower(e.name) = s.name_key JOIN watch_lists l ON l.id = e.list_id WHERE s.online = 1
     UNION ALL
     SELECT s.name, s.world, s.level, s.vocation, s.last_login_at, l.name, e.name
       FROM watch_status s JOIN watch_guild_members m ON lower(m.name) = s.name_key JOIN watch_entries e ON e.id = m.entry_id JOIN watch_lists l ON l.id = e.list_id WHERE s.online = 1`,
  )
  const byName = new Map<string, WatchOnline>()
  for (const r of rows) {
    const cur = byName.get(r.name) ?? { name: r.name, world: r.world, level: r.level, vocation: r.vocation, lastLoginAt: r.last_login_at, lists: [], via: r.via }
    if (!cur.lists.includes(r.list_name)) cur.lists.push(r.list_name)
    cur.via ??= r.via
    byName.set(r.name, cur)
  }
  return [...byName.values()].sort((a, b) => (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? '') || a.name.localeCompare(b.name))
}

export function listWatchEvents(db: Db, limit: number): WatchEvent[] {
  return all<{ id: number; list_name: string | null; kind: WatchEvent['kind']; name: string | null; world: string | null; level: number | null; message: string; detected_at: string }>(
    db,
    'SELECT ev.*, l.name AS list_name FROM watch_events ev LEFT JOIN watch_lists l ON l.id = ev.list_id ORDER BY ev.detected_at DESC, ev.id DESC LIMIT ?',
    [limit],
  ).map((r) => ({ id: r.id, listName: r.list_name, kind: r.kind, name: r.name, world: r.world, level: r.level, message: r.message, detectedAt: r.detected_at }))
}

// ---------- Escaneo ----------

interface Watched {
  name: string
  lists: ListRow[]
}

/** Índice mundo → personajes vigilados (directos o por guild) → listas a las que pertenecen. */
function watchedIndex(db: Db): Map<string, Map<string, Watched>> {
  const lists = new Map(all<ListRow>(db, 'SELECT * FROM watch_lists').map((l) => [l.id, l]))
  const rows = all<{ name: string; world: string; list_id: number }>(
    db,
    `SELECT e.name, e.world, e.list_id FROM watch_entries e WHERE e.kind = 'character' AND e.world IS NOT NULL
     UNION ALL SELECT m.name, e.world, e.list_id FROM watch_guild_members m JOIN watch_entries e ON e.id = m.entry_id WHERE e.world IS NOT NULL`,
  )
  const idx = new Map<string, Map<string, Watched>>()
  for (const r of rows) {
    const byName = idx.get(r.world) ?? new Map<string, Watched>()
    const w = byName.get(watchKey(r.name)) ?? { name: r.name, lists: [] }
    const list = lists.get(r.list_id)
    if (list && !w.lists.some((l) => l.id === list.id)) w.lists.push(list)
    byName.set(watchKey(r.name), w)
    idx.set(r.world, byName)
  }
  return idx
}

export interface ScanResult {
  logins: number
  logouts: number
  bursts: number
  notifications: { title: string; body: string }[]
  messages: string[]
  online: number
}

export interface Watcher {
  scan(): Promise<ScanResult>
  restart(): void
  stop(): void
  status(): WatchStatus
}

export function createWatcher(ctx: AppContext, onUpdate: (r: ScanResult) => void): Watcher {
  const prev = new Map<string, Map<string, OnlinePlayer>>()
  const bursts = new Map<number, BurstState>()
  let timer: NodeJS.Timeout | null = null
  let scanning: Promise<ScanResult> | null = null
  let lastScanAt: string | null = null
  let sourceTimestamp: string | null = null
  let error: string | null = null
  let worlds: string[] = []

  const event = (listId: number | null, kind: WatchEvent['kind'], name: string | null, world: string | null, level: number | null, message: string, at: string) =>
    run(ctx.db, 'INSERT INTO watch_events (list_id, kind, name, world, level, message, detected_at) VALUES (?,?,?,?,?,?,?)', [listId, kind, name, world, level, message, at])

  // Re-resuelve pocas entradas por ciclo: mundos de personajes (transferencias) y miembros de guilds.
  async function refreshEntries(): Promise<void> {
    const api = tibiaData(ctx.http)
    const stale = all<EntryRow>(
      ctx.db,
      `SELECT * FROM watch_entries WHERE resolved_at IS NULL OR (kind = 'character' AND resolved_at < ?) OR (kind = 'guild' AND resolved_at < ?) ORDER BY resolved_at LIMIT 3`,
      [new Date(Date.now() - CHARACTER_REFRESH_MS).toISOString(), new Date(Date.now() - GUILD_REFRESH_MS).toISOString()],
    )
    for (const e of stale) {
      try {
        if (e.kind === 'character') {
          const ch = await api.character(e.name)
          run(ctx.db, 'UPDATE watch_entries SET world = COALESCE(?, world), resolved_at = ? WHERE id = ?', [ch?.world ?? null, nowIso(), e.id])
        } else {
          const g = await api.guild(e.name)
          tx(ctx.db, () => {
            if (g) {
              run(ctx.db, 'UPDATE watch_entries SET world = ?, resolved_at = ? WHERE id = ?', [g.world, nowIso(), e.id])
              storeGuildMembers(ctx.db, e.id, g.members)
            } else run(ctx.db, 'UPDATE watch_entries SET resolved_at = ? WHERE id = ?', [nowIso(), e.id])
          })
        }
      } catch (err) {
        ctx.log.warn(`No se pudo actualizar ${e.kind} ${e.name}`, err)
      }
    }
  }

  async function doScan(): Promise<ScanResult> {
    const result: ScanResult = { logins: 0, logouts: 0, bursts: 0, notifications: [], messages: [], online: 0 }
    await refreshEntries()
    const idx = watchedIndex(ctx.db)
    worlds = [...idx.keys()].sort()
    const api = tibiaData(ctx.http)
    const now = new Date()
    const at = now.toISOString()
    const errors: string[] = []

    for (const [world, watched] of idx) {
      let players: OnlinePlayer[]
      try {
        const r = await api.worldOnline(world)
        players = r.players
        sourceTimestamp = r.sourceTimestamp
      } catch (e) {
        errors.push(`${world}: ${e instanceof Error ? e.message : String(e)}`)
        continue
      }
      const keys = new Set(watched.keys())
      const change = diffOnline(prev.get(world) ?? null, players, keys)
      prev.set(world, toOnlineMap(players))
      const onlineNow = players.filter((p) => keys.has(watchKey(p.name)))
      result.online += onlineNow.length

      tx(ctx.db, () => {
        const loginKeys = new Set(change.logins.map((p) => watchKey(p.name)))
        for (const p of onlineNow) {
          run(
            ctx.db,
            `INSERT INTO watch_status (name_key, name, world, online, level, vocation, last_login_at, last_seen_at, updated_at) VALUES (?,?,?,1,?,?,?,?,?)
             ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, world = excluded.world, online = 1, level = excluded.level, vocation = excluded.vocation,
               last_login_at = CASE WHEN ? THEN excluded.last_seen_at ELSE watch_status.last_login_at END, last_seen_at = excluded.last_seen_at, updated_at = excluded.updated_at`,
            [watchKey(p.name), p.name, world, p.level, p.vocation, loginKeys.has(watchKey(p.name)) ? at : null, at, at, loginKeys.has(watchKey(p.name))],
          )
        }
        const offline = [...keys].filter((k) => !onlineNow.some((p) => watchKey(p.name) === k))
        for (const k of offline) run(ctx.db, 'UPDATE watch_status SET online = 0, updated_at = ? WHERE name_key = ? AND online = 1', [at, k])

        for (const p of change.logins) {
          for (const list of watched.get(watchKey(p.name))!.lists) {
            const msg = `${p.name} (${p.level} ${p.vocation}) se conectó en ${world}`
            event(list.id, 'login', p.name, world, p.level, msg, at)
            result.logins++
            result.messages.push(`[${list.name}] ${msg}`)
            if (list.notify_login) result.notifications.push({ title: `${list.name}: ${p.name} conectado`, body: `Nivel ${p.level} ${p.vocation} · ${world}` })
          }
        }
        for (const name of change.logouts) {
          for (const list of watched.get(watchKey(name))?.lists ?? []) event(list.id, 'logout', name, world, null, `${name} se desconectó de ${world}`, at)
          result.logouts++
        }
        for (const lc of change.levelChanges) {
          for (const list of watched.get(watchKey(lc.name))?.lists ?? []) {
            const msg = `${lc.name} pasó de nivel ${lc.from} a ${lc.to} (${world})`
            event(list.id, 'level', lc.name, world, lc.to, msg, at)
            result.messages.push(`[${list.name}] ${msg}`)
          }
        }
      })

      // Ráfagas por lista: N o más conexiones de la lista dentro de su ventana.
      const byList = new Map<number, { list: ListRow; names: string[] }>()
      for (const p of change.logins) {
        for (const list of watched.get(watchKey(p.name))!.lists) {
          const b = byList.get(list.id) ?? { list, names: [] }
          b.names.push(p.name)
          byList.set(list.id, b)
        }
      }
      for (const { list, names } of byList.values()) {
        if (!list.burst_threshold) continue
        const r = trackBurst(bursts.get(list.id) ?? { recent: [], lastAlertAt: null }, names.map((name) => ({ name })), now.getTime(), { threshold: list.burst_threshold, windowMs: list.burst_window_sec * 1_000 })
        bursts.set(list.id, r.state)
        if (r.fired) {
          const msg = `${r.fired.count} de «${list.name}» se conectaron en ≤ ${list.burst_window_sec} s: ${r.fired.names.join(', ')}`
          event(list.id, 'burst', null, world, null, msg, at)
          result.bursts++
          result.messages.unshift(`⚠ ${msg}`)
          result.notifications.unshift({ title: `⚠ ${r.fired.count} de ${list.name} conectados de golpe`, body: r.fired.names.join(', ') })
        }
      }
    }
    lastScanAt = at
    error = errors.length ? errors.join('; ') : null
    return result
  }

  const scan = () => {
    // Un escaneo a la vez; si ya hay uno en curso, se espera ese.
    scanning ??= doScan().finally(() => (scanning = null))
    return scanning
  }

  return {
    scan,
    restart() {
      if (timer) clearInterval(timer)
      timer = null
      const s = getSettings(ctx.db).watch
      if (!s.enabled) return
      const tick = () =>
        void scan()
          .then((r) => onUpdate(r))
          .catch((e) => {
            error = e instanceof Error ? e.message : String(e)
            ctx.log.warn('Vigilancia', e)
          })
      tick()
      timer = setInterval(tick, Math.max(MIN_INTERVAL_SEC, s.intervalSec) * 1_000)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    status() {
      const s = getSettings(ctx.db).watch
      const watched = get<{ n: number }>(ctx.db, `SELECT COUNT(*) AS n FROM (SELECT lower(name) FROM watch_entries WHERE kind = 'character' UNION SELECT lower(name) FROM watch_guild_members)`)?.n ?? 0
      return { enabled: s.enabled, intervalSec: Math.max(MIN_INTERVAL_SEC, s.intervalSec), running: timer !== null, lastScanAt, sourceTimestamp, worlds, watched, error }
    },
  }
}
