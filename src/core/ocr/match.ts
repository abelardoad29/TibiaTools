// Identifica el item a partir del nombre leído en la lista del Market. El OCR puede dejar letras sin
// reconocer ('?': aún no hay glifo aprendido para ellas) o confundir alguna parecida, así que se compara
// con todo el catálogo por distancia de edición, con '?' como comodín de una o dos letras (dos letras
// pegadas forman un solo glifo).

export interface NameCandidate {
  id: number
  name: string
}

export interface NameMatch extends NameCandidate {
  /** 0–1: 1 = idéntico. */
  score: number
}

export interface ItemIdentification {
  best: NameMatch | null
  /** Las mejores opciones, para elegir a mano si hace falta. */
  candidates: NameMatch[]
  /** true si el mejor es claro: puntuación alta y bien separado del segundo. */
  confident: boolean
}

const WILD_1 = 0.25
const WILD_2 = 0.5

/** Costo de edición entre lo leído (con comodines '?') y un nombre del catálogo, sin distinguir mayúsculas. */
export function nameDistance(read: string, name: string): number {
  const a = read.toLowerCase()
  const b = name.toLowerCase()
  const n = a.length
  const m = b.length
  // d[i][j] = costo de alinear a[0..i) con b[0..j)
  let prev2 = new Float64Array(m + 1)
  let prev = new Float64Array(m + 1)
  let cur = new Float64Array(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j
  for (let i = 1; i <= n; i++) {
    cur[0] = i
    const ca = a[i - 1]!
    for (let j = 1; j <= m; j++) {
      let best = Math.min(prev[j]! + 1, cur[j - 1]! + 1)
      if (ca === '?') {
        best = Math.min(best, prev[j - 1]! + (b[j - 1] === ' ' ? 1 : WILD_1))
        if (j >= 2 && b[j - 1] !== ' ' && b[j - 2] !== ' ') best = Math.min(best, prev[j - 2]! + WILD_2)
      } else best = Math.min(best, prev[j - 1]! + (ca === b[j - 1] ? 0 : 1))
      cur[j] = best
    }
    ;[prev2, prev, cur] = [prev, cur, prev2]
  }
  return prev[m]!
}

export function nameScore(read: string, name: string): number {
  const len = Math.max(read.length, name.length)
  return len === 0 ? 0 : Math.max(0, 1 - nameDistance(read, name) / len)
}

/**
 * Busca el item más parecido. Es "seguro" si puntúa ≥ `minScore` y le saca ≥ `minMargin` al segundo
 * (si dos nombres empatan no se adivina: queda para revisión).
 */
export function identifyItem(read: string, catalog: NameCandidate[], opts: { minScore?: number; minMargin?: number; top?: number } = {}): ItemIdentification {
  const { minScore = 0.8, minMargin = 0.08, top = 5 } = opts
  const text = read.trim().replace(/\s+/g, ' ')
  if (!text) return { best: null, candidates: [], confident: false }
  const scored: NameMatch[] = []
  for (const c of catalog) {
    // Descarte rápido: la longitud no puede diferir más de lo que permite la puntuación mínima.
    if (Math.abs(c.name.length - text.length) > Math.max(c.name.length, text.length) * (1 - minScore) + text.split('?').length) continue
    scored.push({ ...c, score: nameScore(text, c.name) })
  }
  scored.sort((x, y) => y.score - x.score || x.name.length - y.name.length)
  // Mismo nombre con varios ids (variantes del catálogo): cuenta como una sola opción.
  const unique = scored.filter((s, i) => scored.findIndex((o) => o.name.toLowerCase() === s.name.toLowerCase()) === i)
  const candidates = unique.slice(0, top)
  const best = candidates[0] ?? null
  const second = candidates[1]?.score ?? 0
  return { best, candidates, confident: !!best && best.score >= minScore && best.score - second >= minMargin }
}
