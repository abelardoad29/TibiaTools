// Experiencia compartida: el nivel más alto del grupo no puede superar 3/2 del más bajo.
// Para un nivel L: mínimo = ceil(2L/3), máximo = floor(3L/2). (La v1 usaba floor/ceil y daba 66–150 para L=100.)

export interface ShareRange {
  level: number
  min: number
  max: number
}

export function shareRange(level: number): ShareRange {
  if (!Number.isInteger(level) || level < 1) throw new RangeError('El nivel debe ser un entero ≥ 1')
  return { level, min: Math.floor((2 * level + 2) / 3), max: Math.floor((3 * level) / 2) }
}

/** ¿Puede compartir experiencia un grupo con estos niveles? */
export function canShare(levels: readonly number[]): boolean {
  if (levels.length === 0) return false
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  return 2 * hi <= 3 * lo
}
