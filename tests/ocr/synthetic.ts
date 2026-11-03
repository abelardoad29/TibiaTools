import { binarize, crop, toGray } from '@core/ocr/image'
import { learnGlyphs, mergeAtlas } from '@core/ocr/glyphs'
import type { OcrProfile, Rect, RgbaImage } from '@core/ocr/types'

// Capturas sintéticas para probar el OCR sin las capturas reales (que muestran nombres de otros jugadores).

// Fuente sintética 5×7 (no es la fuente de Tibia: solo valida el pipeline). La coma es 2×3 y baja.
export const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ',': ['00', '00', '00', '00', '00', '01', '01', '10'],
}

const BG = [52, 46, 40]
const FG = [208, 208, 208]

export function blank(w: number, h: number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    // ruido leve de fondo
    const n = (i * 7919) % 9
    data.set([BG[0]! + n, BG[1]! + n, BG[2]! + n, 255], i * 4)
  }
  return { width: w, height: h, data }
}

/** Dibuja texto alineado a la derecha dentro de `rect` (como las columnas numéricas del Market). */
export function draw(img: RgbaImage, text: string, rect: Rect): void {
  const widths = [...text].map((c) => FONT[c]![0]!.length)
  const total = widths.reduce((a, b) => a + b + 1, -1)
  let x = rect.x + rect.w - total - 2
  for (const c of text) {
    const g = FONT[c]!
    g.forEach((row, dy) => {
      ;[...row].forEach((bit, dx) => {
        if (bit === '1') img.data.set([FG[0]!, FG[1]!, FG[2]!, 255], ((rect.y + 2 + dy) * img.width + x + dx) * 4)
      })
    })
    x += g[0]!.length + 1
  }
}

export const ROW_H = 14
export const COLS = { amount: { x: 10, w: 60 }, unitPrice: { x: 80, w: 100 }, totalPrice: { x: 190, w: 120 } }

export function marketImage(rows: { amount: string; price: string; total: string }[], top = 20): RgbaImage {
  const img = blank(330, top + rows.length * ROW_H + 10)
  rows.forEach((r, i) => {
    const y = top + i * ROW_H
    draw(img, r.amount, { x: COLS.amount.x, y, w: COLS.amount.w, h: ROW_H })
    draw(img, r.price, { x: COLS.unitPrice.x, y, w: COLS.unitPrice.w, h: ROW_H })
    draw(img, r.total, { x: COLS.totalPrice.x, y, w: COLS.totalPrice.w, h: ROW_H })
  })
  return img
}

export function calibratedProfile(): OcrProfile {
  // Calibración: una línea etiquetada que contiene todos los dígitos y la coma.
  const sample = blank(200, 16)
  draw(sample, '1,234,567,890', { x: 0, y: 0, w: 200, h: 16 })
  const learned = learnGlyphs(binarize(toGray(sample), 'otsu', false), '1,234,567,890')
  if ('error' in learned) throw new Error(learned.error)
  return {
    id: 1,
    name: 'sintético',
    screenType: 'offers',
    refWidth: 330,
    refHeight: 20 + 3 * ROW_H + 10,
    tables: [
      {
        side: 'sell',
        rect: { x: 0, y: 20, w: 330, h: 3 * ROW_H },
        columns: [
          { key: 'amount', ...COLS.amount },
          { key: 'unitPrice', ...COLS.unitPrice },
          { key: 'totalPrice', ...COLS.totalPrice },
        ],
        rowHeight: null,
      },
    ],
    detailsFields: [],
    preprocess: { threshold: 'otsu', darkText: false, spaceGap: 3 },
    atlas: mergeAtlas({ glyphs: [] }, learned.glyphs),
    version: 1,
    updatedAt: null,
  }
}

// ---------- Market real: tonos por fila, ventana desplazada y lista de items ----------

/** Pinta una franja de fondo uniforme (como las filas del Market). */
export function band(img: RgbaImage, y: number, h: number, v: number, x = 0, w = img.width): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) img.data.set([v, v, v, 255], (j * img.width + i) * 4)
}

/** Como draw() pero con un tono de texto dado. */
export function drawTone(img: RgbaImage, text: string, rect: Rect, v: number, align: 'left' | 'right' = 'right'): void {
  const widths = [...text].map((c) => (c === ' ' ? 3 : FONT[c]![0]!.length))
  const total = widths.reduce((a, b) => a + b + 1, -1)
  let x = align === 'right' ? rect.x + rect.w - total - 2 : rect.x + 2
  for (const c of text) {
    if (c === ' ') {
      x += 4
      continue
    }
    const g = FONT[c]!
    g.forEach((row, dy) => [...row].forEach((bit, dx) => bit === '1' && img.data.set([v, v, v, 255], ((rect.y + 2 + dy) * img.width + x + dx) * 4)))
    x += g[0]!.length + 1
  }
}

export const AUTO = { threshold: 'auto' as const, delta: 20, darkText: false, spaceGap: 3 }
export const ANCHOR_TEXT = '8,8,8'

/** Ventana de "Market" sintética: ancla arriba, lista de items a la izquierda y una tabla de 3 filas con tonos distintos. */
export function marketWindow(dx: number, dy: number, rows: { amount: string; price: string; total: string; bg: number; fg: number }[], items: { name: string[]; bg: number }[]): RgbaImage {
  const img = blank(480, 170)
  drawTone(img, ANCHOR_TEXT, { x: dx + 5, y: dy + 2, w: 60, h: 12 }, 208, 'left')
  items.forEach((it, i) => {
    band(img, dy + 20 + i * 24, 24, it.bg, dx + 5, 70)
    it.name.forEach((line, l) => drawTone(img, line, { x: dx + 15, y: dy + 20 + i * 24 + l * 10, w: 60, h: 10 }, 192, 'left'))
  })
  rows.forEach((r, i) => {
    const y = dy + 20 + i * ROW_H
    band(img, y, ROW_H, r.bg, dx + 90, 320)
    drawTone(img, r.amount, { x: dx + 90 + COLS.amount.x, y, w: COLS.amount.w, h: ROW_H }, r.fg)
    drawTone(img, r.price, { x: dx + 90 + COLS.unitPrice.x, y, w: COLS.unitPrice.w, h: ROW_H }, r.fg)
    drawTone(img, r.total, { x: dx + 90 + COLS.totalPrice.x, y, w: COLS.totalPrice.w, h: ROW_H }, r.fg)
  })
  return img
}

export function anchoredProfile(): OcrProfile {
  const base = calibratedProfile()
  const ref = marketWindow(0, 0, [], [])
  const anchorRect = { x: 4, y: 3, w: 30, h: 10 }
  const bits = [...binarize(crop(toGray(ref), anchorRect), 140, false).data].join('')
  return {
    ...base,
    preprocess: AUTO,
    tables: [{ side: 'sell', rect: { x: 90, y: 20, w: 320, h: 3 * ROW_H }, columns: (['amount', 'unitPrice', 'totalPrice'] as const).map((key) => ({ key, x: 90 + COLS[key].x, w: COLS[key].w })), rowHeight: ROW_H }],
    anchor: { ...anchorRect, threshold: 140, bits, label: ANCHOR_TEXT },
    itemList: { rect: { x: 5, y: 20, w: 70, h: 3 * 24 }, entryHeight: 24, iconWidth: 8, atlas: base.atlas, spaceGap: 2 },
  }
}

export const ROWS3 = [
  { amount: '25', price: '1,000', total: '25,000', bg: 88, fg: 244 }, // fila seleccionada (resaltada)
  { amount: '3', price: '1,005', total: '3,015', bg: 65, fg: 128 }, // atenuada
  { amount: '10', price: '1,010', total: '10,100', bg: 72, fg: 147 }, // rojiza
]
