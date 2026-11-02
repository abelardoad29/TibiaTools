// Vigilancia de personajes (hunted list, amigos…) a partir de la lista pública de conectados de cada mundo.
// No existe un canal en tiempo real de Tibia: la lista se consulta periódicamente, así que una conexión se
// detecta en la primera lectura que la incluye (la precisión es el intervalo entre lecturas).

export interface OnlinePlayer {
  name: string
  level: number
  vocation: string
}

export interface OnlineChange {
  logins: OnlinePlayer[]
  logouts: string[]
  levelChanges: { name: string; from: number; to: number }[]
}

export const watchKey = (name: string) => name.trim().toLowerCase()

export const toOnlineMap = (players: readonly OnlinePlayer[]) => new Map(players.map((p) => [watchKey(p.name), p]))

/**
 * Cambios entre dos lecturas, limitados a los nombres vigilados. `prev` es la lista COMPLETA de la lectura
 * anterior (no solo vigilados), así alguien agregado a la lista mientras ya jugaba no cuenta como conexión.
 * Con `prev` null (primera lectura tras arrancar) no hay conexiones: no se sabe cuándo entraron.
 */
export function diffOnline(prev: ReadonlyMap<string, OnlinePlayer> | null, next: readonly OnlinePlayer[], watched: ReadonlySet<string>): OnlineChange {
  const now = new Map(next.filter((p) => watched.has(watchKey(p.name))).map((p) => [watchKey(p.name), p]))
  if (prev === null) return { logins: [], logouts: [], levelChanges: [] }
  const logins: OnlinePlayer[] = []
  const levelChanges: OnlineChange['levelChanges'] = []
  for (const [key, p] of now) {
    const before = prev.get(key)
    if (!before) logins.push(p)
    else if (before.level !== p.level) levelChanges.push({ name: p.name, from: before.level, to: p.level })
  }
  const logouts = [...prev.entries()].filter(([key]) => watched.has(key) && !now.has(key)).map(([, p]) => p.name)
  return { logins, logouts, levelChanges }
}

export interface BurstRule {
  threshold: number
  windowMs: number
}

export interface BurstState {
  /** Conexiones recientes detectadas (instante de detección y nombre). */
  recent: { at: number; name: string }[]
  /** Momento de la última alerta de ráfaga, para no repetirla mientras dure la misma ventana. */
  lastAlertAt: number | null
}

export interface BurstResult {
  state: BurstState
  fired: { count: number; names: string[] } | null
}

/** Registra conexiones y avisa si en la ventana hay `threshold` o más. Una alerta por ventana. */
export function trackBurst(state: BurstState, logins: readonly { name: string }[], now: number, rule: BurstRule): BurstResult {
  const recent = [...state.recent.filter((r) => now - r.at <= rule.windowMs), ...logins.map((l) => ({ at: now, name: l.name }))]
  const names = [...new Set(recent.map((r) => r.name))]
  const cooling = state.lastAlertAt !== null && now - state.lastAlertAt <= rule.windowMs
  if (logins.length > 0 && names.length >= rule.threshold && !cooling) {
    return { state: { recent, lastAlertAt: now }, fired: { count: names.length, names } }
  }
  return { state: { recent, lastAlertAt: state.lastAlertAt }, fired: null }
}
