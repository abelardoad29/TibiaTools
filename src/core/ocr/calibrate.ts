import { crop, toBinary, type Gray } from './image'
import { boxBits, glyphBoxes, rowSpans } from './glyphs'
import type { Glyph, Preprocess, Rect } from './types'

// Aprendizaje de glifos a partir de texto conocido: celdas de las tablas (números y fechas) y entradas de la
// lista de items (nombres, que pueden ocupar dos líneas). Lo usan el script de calibración y la app cuando el
// usuario confirma un item, así cada captura revisada enseña las letras que faltaban.

export type Learned = { glyphs: Glyph[] } | { error: string }

function learnLines(lines: { b: ReturnType<typeof toBinary>; y0: number; y1: number }[], text: string): Learned {
  const chars = [...text.replace(/\s+/g, '')]
  const glyphs: Glyph[] = []
  const boxes = lines.flatMap(({ b, y0, y1 }) => {
    const line = crop(b, { x: 0, y: y0, w: b.width, h: y1 - y0 })
    return glyphBoxes(line).map((box) => ({ line, box }))
  })
  if (boxes.length !== chars.length) return { error: `Se detectaron ${boxes.length} glifos pero «${text}» tiene ${chars.length} caracteres` }
  boxes.forEach(({ line, box }, i) => glyphs.push({ ch: chars[i]!, ...boxBits(line, box) }))
  return { glyphs }
}

/** Glifos de una celda de una sola línea (cantidad, precio, total, fecha). */
export function learnFromCell(gray: Gray, rect: Rect, preprocess: Preprocess, text: string): Learned {
  const b = toBinary(crop(gray, rect), preprocess)
  return learnLines([{ b, y0: 0, y1: b.height }], text)
}

/** Glifos de una entrada de la lista de items con su nombre real (una o dos líneas). */
export function learnFromItemEntry(gray: Gray, rect: Rect, preprocess: Preprocess, name: string): Learned {
  const b = toBinary(crop(gray, rect), preprocess)
  const spans = rowSpans(b, 2)
  if (!spans.length) return { error: 'La entrada no tiene texto' }
  return learnLines(spans.map((s) => ({ b, ...s })), name)
}
