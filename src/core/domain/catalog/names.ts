/** Normaliza nombres de items/mundos para búsquedas: minúsculas, sin acentos, apóstrofos unificados. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Puntaje de coincidencia 0–100 para búsqueda difusa. Prefiere coincidencia exacta, luego prefijo,
 * luego inicio de palabra, luego subcadena y por último subsecuencia (p. ej. "gmp" → "great mana potion").
 */
export function matchScore(query: string, candidate: string): number {
  const q = normalizeName(query)
  const c = normalizeName(candidate)
  if (!q) return 0
  if (c === q) return 100
  if (c.startsWith(q)) return 90 - Math.min(20, c.length - q.length)
  const words = c.split(' ')
  if (words.some((w) => w.startsWith(q))) return 70
  if (c.includes(q)) return 55
  const initials = words.map((w) => w[0]).join('')
  if (initials.startsWith(q.replace(/\s/g, ''))) return 50
  let i = 0
  for (const ch of c) if (ch === q[i]) i++
  return i === q.length ? Math.round(30 * (q.length / c.length)) + 5 : 0
}

/** "Great Mana Potion" → "Great_Mana_Potion" (formato de archivo de MediaWiki). */
export function wikiFileName(name: string): string {
  return name.trim().replace(/\s+/g, '_')
}
