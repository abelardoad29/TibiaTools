// Resumen de la lista pública de conectados de un mundo (tibia.com vía TibiaData): vocaciones, niveles y top.

export interface OnlinePlayerLite {
  name: string
  level: number
  vocation: string
}

export interface WorldOnlineSummary {
  vocations: { vocation: string; count: number }[]
  levels: { min: number; median: number; max: number } | null
  /** Conectados por rango de nivel. */
  buckets: { label: string; count: number }[]
  top: OnlinePlayerLite[]
}

/** Vocación base: "Elite Knight" → "Knight"; sin vocación → "None". */
export function baseVocation(vocation: string): string {
  const v = vocation.trim()
  if (!v || v === 'None') return 'None'
  const promoted: Record<string, string> = {
    'Elite Knight': 'Knight',
    'Royal Paladin': 'Paladin',
    'Master Sorcerer': 'Sorcerer',
    'Elder Druid': 'Druid',
    'Exalted Monk': 'Monk',
  }
  return promoted[v] ?? v
}

const BUCKETS: [string, number, number][] = [
  ['1–99', 1, 99],
  ['100–299', 100, 299],
  ['300–499', 300, 499],
  ['500–999', 500, 999],
  ['1000+', 1000, Infinity],
]

export function summarizeOnline(players: OnlinePlayerLite[], topN = 10): WorldOnlineSummary {
  const voc = new Map<string, number>()
  for (const p of players) voc.set(baseVocation(p.vocation), (voc.get(baseVocation(p.vocation)) ?? 0) + 1)
  const levels = players.map((p) => p.level).sort((a, b) => a - b)
  const median = levels.length ? (levels.length % 2 ? levels[(levels.length - 1) / 2]! : Math.round((levels[levels.length / 2 - 1]! + levels[levels.length / 2]!) / 2)) : 0
  return {
    vocations: [...voc].map(([vocation, count]) => ({ vocation, count })).sort((a, b) => b.count - a.count || a.vocation.localeCompare(b.vocation)),
    levels: levels.length ? { min: levels[0]!, median, max: levels.at(-1)! } : null,
    buckets: BUCKETS.map(([label, lo, hi]) => ({ label, count: levels.filter((l) => l >= lo && l <= hi).length })),
    top: [...players].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)).slice(0, topN),
  }
}
