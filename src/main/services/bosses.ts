import bossSeed from '@seed/boss_spawns.json'
import creatureGifs from '@seed/creature_gifs.json'
import type { BossesOutlook, BossHistory } from '@shared/api'
import { BOSSES } from '@core/domain/bosses/list'
import { addDays, bossesByRace, bossOutlook, currentStatsDay, diffDays, mergeSameSpawn, sightingsFromEntries, type BossSpawnStats, type Sighting } from '@core/domain/bosses/spawn'
import { all, get, nowIso, run, tx, type Db } from '../db/database'
import { ExternalError } from '../external/http'
import { tibiaData, type KillStatsEntry } from '../external/tibiadata'
import type { AppContext } from '../context'

// Boss hunter: últimas apariciones por mundo + probabilidad de aparición de hoy.
// Las estadísticas de aparición (intervalos de todos los mundos) vienen del seed (scripts/build-boss-stats.ts).
// Los días que faltan desde el seed se bajan al abrir un mundo: los pasados del historial diario público de
// github.com/tibiamaps/tibia-kill-stats y el de hoy de TibiaData.

interface BossSeed {
  generatedAt: string
  source: string
  dataFrom: string | null
  dataThrough: string | null
  bosses: BossSpawnStats[]
  worlds: Record<string, { from: string; through: string; last: Record<string, [string, number, number][]> }>
}

const seed = bossSeed as unknown as BossSeed
const STATS = new Map(seed.bosses.map((b) => [b.name, b]))
const BY_RACE = bossesByRace(BOSSES)
const GIFS = creatureGifs as Record<string, string>
const RAW = 'https://raw.githubusercontent.com/tibiamaps/tibia-kill-stats/main/data'
/** Si falta más que esto, se baja solo lo más reciente. */
const MAX_BACKFILL_DAYS = 45

/** Carga las últimas apariciones del seed (una vez por versión del seed). */
export function ensureBossSeed(db: Db): void {
  const row = get<{ fetched_at: string }>(db, `SELECT fetched_at FROM seed_versions WHERE name = 'boss_spawns'`)
  if (row?.fetched_at === seed.generatedAt) return
  tx(db, () => {
    const ins = db.prepare(`INSERT OR IGNORE INTO boss_sightings (world, boss, stats_day, killed, players_killed, source) VALUES (?,?,?,?,?,'seed')`)
    const cov = db.prepare(
      `INSERT INTO boss_coverage (world, history_from, through, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(world) DO UPDATE SET history_from = MIN(boss_coverage.history_from, excluded.history_from),
         through = MAX(boss_coverage.through, excluded.through), updated_at = excluded.updated_at`,
    )
    for (const [world, w] of Object.entries(seed.worlds)) {
      for (const [boss, list] of Object.entries(w.last)) for (const [day, killed, players] of list) ins.run(world, boss, day, killed, players)
      cov.run(world, w.from, w.through, nowIso())
    }
    run(db, 'INSERT INTO seed_versions(name, fetched_at, loaded_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET fetched_at = excluded.fetched_at, loaded_at = excluded.loaded_at', [
      'boss_spawns',
      seed.generatedAt,
      nowIso(),
    ])
  })
}

/** Estadística de un día: null si todavía no está publicada (o falta en el historial). */
async function fetchDay(ctx: AppContext, world: string, day: string, today: string): Promise<{ entries: KillStatsEntry[]; source: 'tibiamaps' | 'tibiadata' } | null> {
  if (day === today) {
    const r = await tibiaData(ctx.http).killStatistics(world)
    // TibiaData guarda la página un rato: solo sirve si ya trae la estadística de hoy.
    return currentStatsDay(new Date(r.timestamp)) === day ? { entries: r.entries, source: 'tibiadata' } : null
  }
  try {
    const r = await ctx.http.getJson<{ killstatistics?: { entries?: KillStatsEntry[] } }>(`${RAW}/${encodeURIComponent(world.toLowerCase())}/${day}.json`, { retries: 1, staleOnError: false })
    return { entries: r.data.killstatistics?.entries ?? [], source: 'tibiamaps' }
  } catch (e) {
    if (e instanceof ExternalError && e.status === 404) return null
    throw e
  }
}

const syncing = new Map<string, Promise<void>>()

/** Baja los días de estadística que faltan para un mundo. */
export function syncBossWorld(ctx: AppContext, world: string): Promise<void> {
  const key = world.toLowerCase()
  const running = syncing.get(key)
  if (running) return running
  const p = doSync(ctx, world).finally(() => syncing.delete(key))
  syncing.set(key, p)
  return p
}

async function doSync(ctx: AppContext, world: string): Promise<void> {
  ensureBossSeed(ctx.db)
  const today = currentStatsDay(ctx.now())
  const cov = get<{ history_from: string; through: string }>(ctx.db, 'SELECT history_from, through FROM boss_coverage WHERE world = ?', [world])
  let start = cov ? addDays(cov.through, 1) : addDays(today, -MAX_BACKFILL_DAYS + 1)
  if (diffDays(start, today) >= MAX_BACKFILL_DAYS) start = addDays(today, -MAX_BACKFILL_DAYS + 1)
  let through = cov?.through ?? null
  const ins = ctx.db.prepare(`INSERT OR REPLACE INTO boss_sightings (world, boss, stats_day, killed, players_killed, source) VALUES (?,?,?,?,?,?)`)
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const r = await fetchDay(ctx, world, day, today)
    if (!r) {
      // Ayer u hoy pueden no estar publicados todavía: se reintenta en la próxima apertura.
      if (diffDays(day, today) <= 1) break
      continue
    }
    tx(ctx.db, () => {
      for (const s of sightingsFromEntries(r.entries, day, BY_RACE)) ins.run(world, s.boss, s.day, s.killed, s.playersKilled, r.source)
    })
    through = day
  }
  if (through) {
    run(
      ctx.db,
      `INSERT INTO boss_coverage (world, history_from, through, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(world) DO UPDATE SET through = MAX(boss_coverage.through, excluded.through), updated_at = excluded.updated_at`,
      [world, cov?.history_from ?? start, through, nowIso()],
    )
  }
}

function sightingsByBoss(db: Db, world: string): Map<string, Sighting[]> {
  const out = new Map<string, Sighting[]>()
  for (const r of all<{ boss: string; stats_day: string; killed: number; players_killed: number }>(db, 'SELECT boss, stats_day, killed, players_killed FROM boss_sightings WHERE world = ? ORDER BY stats_day', [world])) {
    const list = out.get(r.boss) ?? []
    list.push({ day: r.stats_day, killed: r.killed, playersKilled: r.players_killed })
    out.set(r.boss, list)
  }
  return out
}

export async function bossesOutlook(ctx: AppContext, world: string): Promise<BossesOutlook> {
  ensureBossSeed(ctx.db)
  const today = currentStatsDay(ctx.now())
  let syncError: string | null = null
  try {
    await syncBossWorld(ctx, world)
  } catch (e) {
    syncError = e instanceof Error ? e.message : String(e)
    ctx.log.warn(`Boss hunter: no se pudo actualizar ${world}`, e)
  }
  const cov = get<{ history_from: string; through: string }>(ctx.db, 'SELECT history_from, through FROM boss_coverage WHERE world = ?', [world]) ?? null
  const next = addDays(today, 1)
  const byBoss = sightingsByBoss(ctx.db, world)
  return {
    world,
    statsDay: today,
    nextStatsDay: next,
    historyFrom: cov?.history_from ?? null,
    through: cov?.through ?? null,
    syncError,
    seed: { generatedAt: seed.generatedAt, dataFrom: seed.dataFrom, dataThrough: seed.dataThrough, source: seed.source },
    rows: BOSSES.flatMap((b) => {
      const stats = STATS.get(b.name)
      return stats ? [{ ...bossOutlook(stats, byBoss.get(b.name) ?? [], next, cov?.history_from ?? null), intervals: stats.intervals, appearances: stats.appearances, imageUrl: GIFS[b.name] ?? null }] : []
    }),
  }
}

export function bossHistory(ctx: AppContext, world: string, boss: string): BossHistory {
  const stats = STATS.get(boss)
  if (!stats) throw new Error(`Boss desconocido: ${boss}`)
  const sightings = mergeSameSpawn(sightingsByBoss(ctx.db, world).get(boss) ?? [])
  return { world, boss, group: stats.group, sightings: sightings.reverse(), hazard: stats.hazard, tailHazard: stats.tailHazard, intervals: stats.intervals }
}
