import type { ThirdPartySyncStatus, ThirdPartyWorldRow } from '@shared/api'
import type { Settings } from '@shared/settings'
import { all, get, nowIso, run } from '../db/database'
import { tibiaMarket } from '../external/tibiamarket'
import type { AppContext } from '../context'
import { storeMarketValues } from './market'
import { getSettings } from './settings'

// Descarga en segundo plano los precios de tibiamarket.top de todos los mundos: una consulta por mundo
// (todos sus items a la vez) respetando su límite de 1 consulta cada 5 s, que aplica el cliente HTTP.
// Un mundo solo se vuelve a bajar si tibiamarket publicó un escaneo nuevo desde la última importación.

export interface ThirdPartySync {
  /** Inicia una corrida en segundo plano (si ya hay una, devuelve su estado). */
  start(opts: { worlds: string[] | null; force: boolean }): ThirdPartySyncStatus
  cancel(): ThirdPartySyncStatus
  status(): ThirdPartySyncStatus
  worlds(): ThirdPartyWorldRow[]
  /** Reprograma la revisión automática según Ajustes. */
  reschedule(): void
  stop(): void
  /** Para tests: espera a que termine la corrida en curso. */
  idle(): Promise<void>
}

const AUTO_MIN_DELAY_MS = 60_000

export const syncHours = (s: Settings['network']) => Math.min(168, Math.max(1, Math.round(s.thirdPartySyncHours || 6)))

/** Mundo propio primero, luego "Mis mundos" y luego el escaneo más reciente. */
function priority(settings: Settings): (name: string) => number {
  const order = [settings.homeWorld, ...settings.favoriteWorlds].filter((w): w is string => typeof w === 'string').map((w) => w.toLowerCase())
  return (name) => {
    const i = order.indexOf(name.toLowerCase())
    return i < 0 ? order.length : i
  }
}

export function createThirdPartySync(ctx: AppContext, onProgress: (s: ThirdPartySyncStatus) => void): ThirdPartySync {
  let status: ThirdPartySyncStatus = { running: false, done: 0, total: 0, current: null, imported: 0, unchanged: 0, failed: 0, startedAt: null, finishedAt: null, nextAutoAt: null, error: null }
  let cancelled = false
  let stopped = false
  let timer: NodeJS.Timeout | null = null
  let current: Promise<void> = Promise.resolve()
  /** Última lista de mundos de tibiamarket (clave en minúsculas → last_update). */
  let remote: Map<string, string> | null = null

  const update = (patch: Partial<ThirdPartySyncStatus>) => {
    status = { ...status, ...patch }
    onProgress(status)
  }

  const mark = (worldId: number, fields: { remoteUpdatedAt?: string; items?: number; error: string | null }) => {
    const at = nowIso()
    if (fields.remoteUpdatedAt !== undefined) {
      run(
        ctx.db,
        `INSERT INTO third_party_sync (world_id, remote_updated_at, imported_at, items, error, checked_at) VALUES (?,?,?,?,NULL,?)
         ON CONFLICT(world_id) DO UPDATE SET remote_updated_at = excluded.remote_updated_at, imported_at = excluded.imported_at, items = excluded.items, error = NULL, checked_at = excluded.checked_at`,
        [worldId, fields.remoteUpdatedAt, at, fields.items ?? 0, at],
      )
    } else {
      // Sin import correcto: se conserva remote_updated_at para que el mundo se reintente la próxima vez.
      run(
        ctx.db,
        `INSERT INTO third_party_sync (world_id, remote_updated_at, imported_at, items, error, checked_at) VALUES (?,NULL,NULL,0,?,?)
         ON CONFLICT(world_id) DO UPDATE SET error = excluded.error, checked_at = excluded.checked_at`,
        [worldId, fields.error, at],
      )
    }
  }

  async function runSync(opts: { worlds: string[] | null; force: boolean }): Promise<void> {
    const api = tibiaMarket(ctx.http)
    cancelled = false
    update({ running: true, done: 0, total: 0, current: null, imported: 0, unchanged: 0, failed: 0, startedAt: nowIso(), finishedAt: null, error: null })
    const problems: string[] = []
    try {
      remote = new Map((await api.worlds(0)).map((w) => [w.world.toLowerCase(), w.lastUpdate]))
      const wanted = opts.worlds ? new Set(opts.worlds.map((w) => w.toLowerCase())) : null
      const rank = priority(getSettings(ctx.db))
      const local = all<{ id: number; name: string; is_active: number; remote_updated_at: string | null }>(
        ctx.db,
        'SELECT w.id, w.name, w.is_active, s.remote_updated_at FROM worlds w LEFT JOIN third_party_sync s ON s.world_id = w.id',
      )
      const targets = local
        .filter((w) => (wanted ? wanted.has(w.name.toLowerCase()) : w.is_active === 1) && remote!.has(w.name.toLowerCase()))
        .map((w) => ({ ...w, remoteAt: remote!.get(w.name.toLowerCase())! }))
        .sort((a, b) => rank(a.name) - rank(b.name) || b.remoteAt.localeCompare(a.remoteAt))
      if (wanted) {
        for (const w of opts.worlds!) if (!targets.some((t) => t.name.toLowerCase() === w.toLowerCase())) problems.push(`tibiamarket.top no sigue ${w}`)
      }
      const pending = targets.filter((t) => opts.force || t.remote_updated_at !== t.remoteAt)
      const unchanged = targets.length - pending.length
      for (const t of targets) if (!pending.includes(t)) run(ctx.db, 'UPDATE third_party_sync SET checked_at = ? WHERE world_id = ?', [nowIso(), t.id])
      update({ total: targets.length, unchanged, done: unchanged })

      for (const t of pending) {
        if (cancelled || stopped) break
        update({ current: t.name })
        try {
          const stored = storeMarketValues(ctx.db, t.id, await api.marketValues(t.name, null))
          mark(t.id, { remoteUpdatedAt: t.remoteAt, items: stored.items, error: null })
          update({ imported: status.imported + 1 })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          mark(t.id, { error: msg })
          ctx.log.warn(`tibiamarket: no se pudo importar ${t.name}`, e)
          update({ failed: status.failed + 1 })
        }
        update({ done: status.done + 1 })
      }
      if (cancelled) problems.push('Cancelado')
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e))
    } finally {
      update({ running: false, current: null, finishedAt: nowIso(), error: problems.length ? problems.join('; ') : null })
      ctx.log.info('Sincronización tibiamarket', { ...status })
    }
  }

  function reschedule(): void {
    if (timer) clearTimeout(timer)
    timer = null
    const net = getSettings(ctx.db).network
    if (stopped || !net.thirdPartyEnabled || !net.thirdPartyAutoSync) {
      if (status.nextAutoAt !== null) update({ nextAutoAt: null })
      return
    }
    const last = get<{ at: string | null }>(ctx.db, 'SELECT MAX(checked_at) AS at FROM third_party_sync')?.at
    const due = last ? new Date(last).getTime() + syncHours(net) * 3_600_000 : 0
    const delay = Math.max(AUTO_MIN_DELAY_MS, due - Date.now())
    timer = setTimeout(() => {
      timer = null
      if (status.running) return reschedule()
      api.start({ worlds: null, force: false })
    }, delay)
    update({ nextAutoAt: new Date(Date.now() + delay).toISOString() })
  }

  const api: ThirdPartySync = {
    start(opts) {
      if (status.running || stopped) return status
      current = runSync(opts).finally(reschedule)
      return status
    },
    cancel() {
      cancelled = true
      return status
    },
    status: () => status,
    worlds() {
      return all<{ name: string; remote_updated_at: string | null; imported_at: string | null; items: number | null; error: string | null }>(
        ctx.db,
        `SELECT w.name, s.remote_updated_at, s.imported_at, s.items, s.error FROM worlds w LEFT JOIN third_party_sync s ON s.world_id = w.id
         WHERE w.is_active = 1 OR s.world_id IS NOT NULL ORDER BY w.name`,
      ).map((r) => ({
        world: r.name,
        tracked: remote ? remote.has(r.name.toLowerCase()) : null,
        latestRemoteAt: remote?.get(r.name.toLowerCase()) ?? null,
        dataAt: r.remote_updated_at,
        importedAt: r.imported_at,
        items: r.items ?? 0,
        error: r.error,
      }))
    },
    reschedule,
    stop() {
      stopped = true
      cancelled = true
      if (timer) clearTimeout(timer)
      timer = null
    },
    idle: () => current,
  }
  return api
}
