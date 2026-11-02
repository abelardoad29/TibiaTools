// Detección de eventos de personajes seguidos (subida de nivel, muertes) entre dos consultas a TibiaData.

export interface CharacterDeath {
  time: string
  level: number
  reason: string
}

export interface CharacterSnapshot {
  name: string
  world: string
  level: number
  vocation: string
  deaths: CharacterDeath[]
}

export interface CharacterEvent {
  type: 'level_up' | 'level_down' | 'death'
  /** Clave estable para no repetir el mismo evento. */
  dedupeKey: string
  message: string
  occurredAt: string | null
}

export function deathKey(d: CharacterDeath): string {
  return `death:${d.time}:${d.level}`
}

export function detectCharacterEvents(
  prev: { level: number | null; knownDeathKeys: readonly string[] },
  next: CharacterSnapshot,
): CharacterEvent[] {
  const events: CharacterEvent[] = []
  if (prev.level !== null && next.level > prev.level) {
    events.push({ type: 'level_up', dedupeKey: `level:${next.level}`, message: `${next.name} subió a nivel ${next.level}`, occurredAt: null })
  } else if (prev.level !== null && next.level < prev.level) {
    events.push({ type: 'level_down', dedupeKey: `level:${next.level}`, message: `${next.name} bajó a nivel ${next.level}`, occurredAt: null })
  }
  const known = new Set(prev.knownDeathKeys)
  for (const d of next.deaths) {
    const key = deathKey(d)
    if (known.has(key)) continue
    // En la primera consulta (prev.level null) las muertes existentes se registran sin notificar como nuevas.
    if (prev.level === null) continue
    events.push({ type: 'death', dedupeKey: key, message: `${next.name} murió a nivel ${d.level}: ${d.reason}`, occurredAt: d.time })
  }
  return events
}
