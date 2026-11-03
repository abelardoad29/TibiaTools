import type { BossDef } from './list'

// Predicción de apariciones a partir de las Kill Statistics de tibia.com (método de TibiaWiki:Bosses Spawn
// Frequency). Las estadísticas se publican una vez al día, ~3 a. m. CET (7 h antes del server save), y solo
// registran un boss si murió o mató a alguien. Un "día de estadística" D cubre las muertes de ~3 a. m. del día
// anterior a ~3 a. m. de D, o sea casi todo el día de juego D−1.
// Sin imports en tiempo de ejecución: lo usa también scripts/build-boss-stats.ts con Node directo.

export interface Sighting {
  /** Día de la estadística (YYYY-MM-DD). */
  day: string
  killed: number
  playersKilled: number
}

/** Estadísticas de aparición de un boss (seed/boss_spawns.json). */
export interface BossSpawnStats {
  name: string
  race: string
  group: string
  appearances: number
  intervals: { n: number; min: number; p10: number; p50: number; p90: number; max: number } | null
  /** hazard[d − 1] = probabilidad de aparecer el día d tras d − 1 días sin aparecer. */
  hazard: number[]
  /** Probabilidad diaria más allá del último día con muestra suficiente. */
  tailHazard: number | null
}

export type ChanceTier = 'high' | 'medium' | 'low' | 'none'

export interface BossOutlook {
  name: string
  group: string
  lastSeen: Sighting | null
  /** Días entre la última aparición y la próxima estadística (el día de juego en curso). */
  daysSince: number | null
  /** 0–1: probabilidad de que aparezca en el día de juego en curso; null sin datos del boss. */
  chance: number | null
  tier: ChanceTier
  /** Días hasta que la probabilidad deja de ser ~0 (0 = la ventana ya está abierta). */
  windowOpensIn: number | null
  /** Días hasta que la probabilidad acumulada llega al 50 %. */
  expectedIn: number | null
  /** Ya pasó el percentil 90 del intervalo: pudo aparecer sin que lo mataran (no quedó registrado). */
  overdue: boolean
  /** La última aparición solo mató jugadores: puede seguir vivo. */
  maybeAlive: boolean
  /** No aparece en el historial disponible: los días son un mínimo. */
  noRecord: boolean
}

const DAY_MS = 86_400_000
const ZERO = 0.002

export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

/**
 * Une dos días seguidos cuando el primero solo registró jugadores muertos (el boss seguía vivo): es el mismo
 * boss que murió después de la actualización de las 3 a. m. CET, no una aparición nueva.
 */
export function mergeSameSpawn(list: Sighting[]): Sighting[] {
  const out: Sighting[] = []
  for (const s of [...list].sort((a, b) => a.day.localeCompare(b.day))) {
    const prev = out.at(-1)
    if (prev && prev.day === s.day) continue
    if (prev && prev.killed === 0 && diffDays(prev.day, s.day) === 1) {
      prev.killed += s.killed
      prev.playersKilled += s.playersKilled
    } else out.push({ ...s })
  }
  return out
}

/** Índice por nombre de la estadística, sin distinguir mayúsculas (tibia.com escribe "Arthom The Hunter"). */
export function bossesByRace(bosses: BossDef[]): Map<string, BossDef> {
  return new Map(bosses.map((b) => [b.race.toLowerCase(), b]))
}

/** Apariciones de bosses en una estadística diaria (formato de TibiaData). `byRace` viene de bossesByRace. */
export function sightingsFromEntries(entries: { race: string; last_day_killed: number; last_day_players_killed: number }[], day: string, byRace: Map<string, BossDef>): (Sighting & { boss: string })[] {
  return entries
    .filter((e) => byRace.has(e.race.toLowerCase()) && (e.last_day_killed > 0 || e.last_day_players_killed > 0))
    .map((e) => ({ boss: byRace.get(e.race.toLowerCase())!.name, day, killed: e.last_day_killed, playersKilled: e.last_day_players_killed }))
}

/** Día de estadística vigente: fecha de Berlín, contando la actualización de ~3 a. m. (margen hasta las 4). */
export function currentStatsDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const p = (t: string) => parts.find((x) => x.type === t)!.value
  const day = `${p('year')}-${p('month')}-${p('day')}`
  return Number(p('hour')) < 4 ? addDays(day, -1) : day
}

export function hazardAt(stats: BossSpawnStats, d: number): number | null {
  if (d < 1) return 0
  if (d <= stats.hazard.length) return stats.hazard[d - 1]!
  return stats.tailHazard
}

export function bossOutlook(stats: BossSpawnStats, sightings: Sighting[], nextStatsDay: string, historyFrom: string | null): BossOutlook {
  const merged = mergeSameSpawn(sightings)
  const last = merged.at(-1) ?? null
  const base = { name: stats.name, group: stats.group, lastSeen: last, maybeAlive: !!last && last.killed === 0 }
  const from = last?.day ?? historyFrom
  if (!from || (!stats.hazard.length && stats.tailHazard === null)) {
    return { ...base, daysSince: null, chance: null, tier: 'none', windowOpensIn: null, expectedIn: null, overdue: false, noRecord: !last }
  }
  const d = diffDays(from, nextStatsDay)
  const chance = hazardAt(stats, d)
  const peak = Math.max(0, ...stats.hazard)
  const tier: ChanceTier = chance === null || chance < ZERO ? 'none' : peak > 0 && chance >= peak * 0.5 ? 'high' : peak > 0 && chance >= peak * 0.2 ? 'medium' : 'low'

  let windowOpensIn: number | null = null
  let expectedIn: number | null = null
  let survive = 1
  for (let k = 0; k <= 366; k++) {
    const h = hazardAt(stats, d + k) ?? 0
    if (windowOpensIn === null && h >= ZERO) windowOpensIn = k
    survive *= 1 - h
    if (expectedIn === null && 1 - survive >= 0.5) expectedIn = k
    if (windowOpensIn !== null && expectedIn !== null) break
  }
  return {
    ...base,
    daysSince: d,
    chance,
    tier,
    windowOpensIn,
    expectedIn,
    overdue: !!stats.intervals && d > stats.intervals.p90,
    noRecord: !last,
  }
}
