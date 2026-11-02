import type { Binary } from './image'
import type { Glyph, GlyphAtlas } from './types'

// Reconocimiento por plantillas de glifos. Tibia dibuja el texto del Market con una fuente bitmap fija,
// así que una vez calibrada la escala, cada carácter es (casi) idéntico píxel a píxel.

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

export interface Span {
  y0: number
  y1: number
}

/** Franjas horizontales con tinta (filas de texto), separadas por al menos `minGap` líneas vacías. */
export function rowSpans(b: Binary, minGap = 1, minHeight = 3): Span[] {
  const ink = new Array<boolean>(b.height).fill(false)
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      if (b.data[y * b.width + x]) {
        ink[y] = true
        break
      }
    }
  }
  const spans: Span[] = []
  let start = -1
  let gap = 0
  for (let y = 0; y <= b.height; y++) {
    if (y < b.height && ink[y]) {
      if (start < 0) start = y
      gap = 0
    } else if (start >= 0) {
      gap++
      if (gap >= minGap || y === b.height) {
        const end = y - gap + 1
        if (end - start >= minHeight) spans.push({ y0: start, y1: end })
        start = -1
        gap = 0
      }
    }
  }
  return spans
}

/** Cajas de glifos: columnas con tinta separadas por columnas vacías; luego se ajusta la altura. */
export function glyphBoxes(b: Binary): Box[] {
  const boxes: Box[] = []
  let x0 = -1
  for (let x = 0; x <= b.width; x++) {
    let has = false
    for (let y = 0; x < b.width && y < b.height && !has; y++) has = b.data[y * b.width + x] === 1
    if (has && x0 < 0) x0 = x
    if (!has && x0 >= 0) {
      let y0 = b.height
      let y1 = 0
      for (let y = 0; y < b.height; y++) {
        for (let xx = x0; xx < x; xx++) {
          if (b.data[y * b.width + xx]) {
            y0 = Math.min(y0, y)
            y1 = Math.max(y1, y + 1)
          }
        }
      }
      boxes.push({ x0, x1: x, y0, y1 })
      x0 = -1
    }
  }
  return boxes
}

export function boxBits(b: Binary, box: Box): { w: number; h: number; bits: string } {
  let bits = ''
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) bits += b.data[y * b.width + x] ? '1' : '0'
  return { w: box.x1 - box.x0, h: box.y1 - box.y0, bits }
}

/** Similitud 0–1 entre dos bitmaps alineados arriba-izquierda; penaliza diferencias de tamaño. */
export function similarity(a: { w: number; h: number; bits: string }, b: { w: number; h: number; bits: string }): number {
  const w = Math.max(a.w, b.w)
  const h = Math.max(a.h, b.h)
  let same = 0
  let inkUnion = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const pa = x < a.w && y < a.h && a.bits[y * a.w + x] === '1'
      const pb = x < b.w && y < b.h && b.bits[y * b.w + x] === '1'
      if (pa || pb) {
        inkUnion++
        if (pa && pb) same++
      }
    }
  }
  // Jaccard sobre la tinta: robusto ante fondos grandes.
  return inkUnion === 0 ? 0 : same / inkUnion
}

export interface MatchResult {
  ch: string | null
  score: number
  margin: number
}

export function matchGlyph(g: { w: number; h: number; bits: string }, atlas: GlyphAtlas): MatchResult {
  let best: { ch: string; s: number } | null = null
  let second = 0
  for (const t of atlas.glyphs) {
    const s = similarity(g, t)
    if (!best || s > best.s) {
      if (best && best.ch !== t.ch) second = Math.max(second, best.s)
      best = { ch: t.ch, s }
    } else if (t.ch !== best.ch) second = Math.max(second, s)
  }
  if (!best) return { ch: null, score: 0, margin: 0 }
  return { ch: best.s >= 0.6 ? best.ch : null, score: best.s, margin: best.s - second }
}

export interface LineRead {
  text: string
  /** Peor confianza de los glifos de la línea (0–1). */
  confidence: number
  unknownGlyphs: number
}

/** Lee una línea binarizada. Un hueco mayor a `spaceGap` entre glifos se lee como espacio. */
export function readLine(b: Binary, atlas: GlyphAtlas, spaceGap: number): LineRead {
  const boxes = glyphBoxes(b)
  let text = ''
  let confidence = boxes.length ? 1 : 0
  let unknown = 0
  boxes.forEach((box, i) => {
    if (i > 0 && box.x0 - boxes[i - 1]!.x1 > spaceGap) text += ' '
    const m = matchGlyph(boxBits(b, box), atlas)
    // Si la segunda mejor opción está muy cerca, la confianza baja (p. ej. 8 vs 0).
    const conf = m.ch === null ? 0 : m.margin < 0.05 ? m.score * 0.9 : m.score
    confidence = Math.min(confidence, conf)
    if (m.ch === null) {
      unknown++
      text += '?'
    } else text += m.ch
  })
  return { text, confidence, unknownGlyphs: unknown }
}

/**
 * Aprende glifos de una línea etiquetada: la cantidad de cajas debe coincidir con los caracteres
 * (sin espacios) del texto. Devuelve los glifos nuevos o un error explicativo.
 */
export function learnGlyphs(b: Binary, text: string): { glyphs: Glyph[] } | { error: string } {
  const chars = [...text.replace(/\s+/g, '')]
  const boxes = glyphBoxes(b)
  if (boxes.length !== chars.length) {
    return { error: `Se detectaron ${boxes.length} glifos pero el texto tiene ${chars.length} caracteres. Ajusta el umbral o el recorte.` }
  }
  return { glyphs: boxes.map((box, i) => ({ ch: chars[i]!, ...boxBits(b, box) })) }
}

/** Une glifos nuevos al atlas sin duplicar bitmaps idénticos. */
export function mergeAtlas(atlas: GlyphAtlas, glyphs: Glyph[]): GlyphAtlas {
  const key = (g: Glyph) => `${g.ch}|${g.w}x${g.h}|${g.bits}`
  const seen = new Set(atlas.glyphs.map(key))
  const out = [...atlas.glyphs]
  for (const g of glyphs) {
    if (seen.has(key(g))) continue
    seen.add(key(g))
    out.push(g)
  }
  return { glyphs: out }
}
