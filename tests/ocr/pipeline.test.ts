import { describe, expect, it } from 'vitest'
import { binarize, crop, otsu, scaleRect, toGray, downsample, meanAbsDiff } from '@core/ocr/image'
import { learnGlyphs, mergeAtlas, readLine, rowSpans } from '@core/ocr/glyphs'
import { reviewLevel, runOcr } from '@core/ocr/pipeline'
import type { OcrProfile, Rect, RgbaImage } from '@core/ocr/types'

// Fuente sintética 5×7 (no es la fuente de Tibia: solo valida el pipeline). La coma es 2×3 y baja.
const FONT: Record<string, string[]> = {
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

function blank(w: number, h: number): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    // ruido leve de fondo
    const n = (i * 7919) % 9
    data.set([BG[0]! + n, BG[1]! + n, BG[2]! + n, 255], i * 4)
  }
  return { width: w, height: h, data }
}

/** Dibuja texto alineado a la derecha dentro de `rect` (como las columnas numéricas del Market). */
function draw(img: RgbaImage, text: string, rect: Rect): void {
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

const ROW_H = 14
const COLS = { amount: { x: 10, w: 60 }, unitPrice: { x: 80, w: 100 }, totalPrice: { x: 190, w: 120 } }

function marketImage(rows: { amount: string; price: string; total: string }[], top = 20): RgbaImage {
  const img = blank(330, top + rows.length * ROW_H + 10)
  rows.forEach((r, i) => {
    const y = top + i * ROW_H
    draw(img, r.amount, { x: COLS.amount.x, y, w: COLS.amount.w, h: ROW_H })
    draw(img, r.price, { x: COLS.unitPrice.x, y, w: COLS.unitPrice.w, h: ROW_H })
    draw(img, r.total, { x: COLS.totalPrice.x, y, w: COLS.totalPrice.w, h: ROW_H })
  })
  return img
}

function calibratedProfile(): OcrProfile {
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

describe('OCR: primitivas', () => {
  it('Otsu separa texto claro de fondo oscuro', () => {
    const img = blank(40, 10)
    draw(img, '8', { x: 0, y: 0, w: 40, h: 10 })
    const g = toGray(img)
    const t = otsu(g)
    // El umbral queda entre el fondo más claro (con ruido) y el texto.
    expect(t).toBeGreaterThanOrEqual(Math.max(...g.data.filter((v) => v < 100)))
    expect(t).toBeLessThan(208)
    const ink = binarize(g, t, false).data.reduce((a, b) => a + b, 0)
    expect(ink).toBe(FONT['8']!.join('').split('').filter((c) => c === '1').length)
  })
  it('detecta filas por proyección', () => {
    const img = marketImage([
      { amount: '1', price: '10', total: '10' },
      { amount: '2', price: '20', total: '40' },
    ])
    expect(rowSpans(binarize(toGray(img), 'otsu', false))).toHaveLength(2)
  })
  it('calibración falla con un mensaje claro si no coinciden los glifos', () => {
    const img = blank(60, 12)
    draw(img, '123', { x: 0, y: 0, w: 60, h: 12 })
    const r = learnGlyphs(binarize(toGray(img), 'otsu', false), '1234')
    expect('error' in r && r.error).toMatch(/3 glifos/)
  })
  it('escala rectángulos y compara firmas', () => {
    expect(scaleRect({ x: 10, y: 10, w: 20, h: 5 }, 2, 2)).toEqual({ x: 20, y: 20, w: 40, h: 10 })
    const a = toGray(marketImage([{ amount: '1', price: '10', total: '10' }]))
    const b = toGray(marketImage([{ amount: '9', price: '90', total: '810' }]))
    expect(meanAbsDiff(downsample(a, 32), downsample(a, 32))).toBe(0)
    expect(meanAbsDiff(downsample(a, 32), downsample(b, 32))).toBeGreaterThan(0)
  })
})

describe('OCR: pipeline completo con fuente sintética', () => {
  it('lee cantidades y precios con separadores y valida totales', () => {
    const profile = calibratedProfile()
    const img = marketImage([
      { amount: '25', price: '1,000', total: '25,000' },
      { amount: '1,400', price: '44,099', total: '61,738,600' },
      { amount: '3', price: '150,000', total: '450,000' },
    ])
    const r = runOcr(img, profile)
    expect(r.warnings).toEqual([])
    expect(r.rows.map((x) => [x.amount.value, x.unitPrice.value, x.totalPrice?.value])).toEqual([
      [25, 1_000, 25_000],
      [1_400, 44_099, 61_738_600],
      [3, 150_000, 450_000],
    ])
    expect(r.rows.every((x) => x.issues.length === 0)).toBe(true)
    expect(Math.min(...r.rows.map((x) => x.unitPrice.confidence))).toBeGreaterThanOrEqual(0.98)
    expect(reviewLevel(r.rows[0]!.unitPrice.confidence, { acceptThreshold: 0.98, reviewThreshold: 0.9 })).toBe('accept')
  })

  it('marca total inconsistente y orden incorrecto', () => {
    const profile = calibratedProfile()
    const img = marketImage([
      { amount: '2', price: '500', total: '1,001' },
      { amount: '1', price: '400', total: '400' },
    ])
    const r = runOcr(img, profile)
    expect(r.rows[0]!.issues.join()).toMatch(/Total/)
    expect(r.rows[1]!.issues.join()).toMatch(/Fuera de orden/)
  })

  it('advierte si la imagen no coincide con la escala del perfil', () => {
    const profile = calibratedProfile()
    const img = blank(660, (20 + 3 * ROW_H + 10) * 2)
    expect(runOcr(img, profile).warnings.join()).toMatch(/escala/)
  })

  it('un glifo desconocido deja el campo ilegible en vez de inventar', () => {
    const profile = calibratedProfile()
    profile.atlas = { glyphs: profile.atlas.glyphs.filter((g) => g.ch !== '7') }
    const img = marketImage([{ amount: '7', price: '700', total: '4,900' }])
    const r = runOcr(img, profile)
    expect(r.rows[0]!.amount.value).toBeNull()
    expect(r.rows[0]!.issues).toContain('Cantidad ilegible')
  })

  it('readLine separa palabras por espacios', () => {
    const profile = calibratedProfile()
    const img = blank(120, 12)
    draw(img, '12', { x: 0, y: 0, w: 40, h: 12 })
    draw(img, '34', { x: 40, y: 0, w: 60, h: 12 })
    const line = readLine(binarize(crop(toGray(img), { x: 0, y: 0, w: 120, h: 12 }), 'otsu', false), profile.atlas, 3)
    expect(line.text).toBe('12 34')
  })
})
