import { describe, expect, it } from 'vitest'
import { binarize, binarizeAdaptive, crop, otsu, scaleRect, toGray, downsample, meanAbsDiff } from '@core/ocr/image'
import { learnFromCell, learnFromItemEntry } from '@core/ocr/calibrate'
import { learnGlyphs, readLine, rowSpans } from '@core/ocr/glyphs'
import { reviewLevel, runOcr } from '@core/ocr/pipeline'
import { anchoredProfile, AUTO, blank, calibratedProfile, COLS, draw, FONT, marketImage, marketWindow, ROW_H, ROWS3 } from './synthetic'

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


describe('OCR: Market real (umbral por fila, ancla, lista de items)', () => {
  it('el umbral adaptativo toma como fondo el tono oscuro aunque el texto ocupe más de media línea', () => {
    const g = { width: 10, height: 1, data: new Uint8Array([64, 192, 192, 192, 64, 192, 192, 192, 64, 64]) }
    expect([...binarizeAdaptive(g, 20, false).data]).toEqual([0, 1, 1, 1, 0, 1, 1, 1, 0, 0])
  })

  it('lee filas con fondos y textos de distinto tono, salta las vacías y ubica la ventana desplazada', () => {
    const r = runOcr(marketWindow(37, 11, ROWS3, [{ name: ['12'], bg: 64 }]), anchoredProfile())
    expect(r.marketFound).toBe(true)
    expect(r.offset).toMatchObject({ dx: 37, dy: 11 })
    expect(r.rows.map((x) => [x.amount.value, x.unitPrice.value, x.totalPrice?.value])).toEqual([
      [25, 1_000, 25_000],
      [3, 1_005, 3_015],
      [10, 1_010, 10_100],
    ])
    expect(r.rows.every((x) => x.issues.length === 0)).toBe(true)
    // Con un umbral fijo de 150 la fila atenuada (128) y la rojiza (147) desaparecen.
    const fixed = runOcr(marketWindow(37, 11, ROWS3, []), { ...anchoredProfile(), preprocess: { threshold: 150, darkText: false, spaceGap: 3 } })
    expect(fixed.rows).toHaveLength(1)
  })

  it('sin la etiqueta ancla avisa que no encontró el Market en vez de leer basura', () => {
    const img = blank(480, 170)
    const r = runOcr(img, anchoredProfile())
    expect(r.marketFound).toBe(false)
    expect(r.rows).toEqual([])
    expect(r.warnings.join()).toMatch(/ventana del Market/)
  })

  it('elige la entrada seleccionada de la lista (fondo más claro) y une nombres en dos líneas', () => {
    const r = runOcr(marketWindow(0, 0, ROWS3, [{ name: ['12', '56'], bg: 64 }, { name: ['34'], bg: 88 }]), anchoredProfile())
    expect(r.item?.entries.map((e) => e.raw)).toEqual(['12 56', '34'])
    expect(r.item?.selected).toMatchObject({ index: 1, raw: '34' })
    // Dos entradas con el mismo fondo: no se adivina.
    const tie = runOcr(marketWindow(0, 0, ROWS3, [{ name: ['12'], bg: 64 }, { name: ['34'], bg: 64 }]), anchoredProfile())
    expect(tie.item?.selected).toBeNull()
  })

  it('aprende glifos de un nombre en dos líneas y de una celda', () => {
    const img = marketWindow(0, 0, ROWS3, [{ name: ['12', '56'], bg: 64 }])
    const g = toGray(img)
    const entry = learnFromItemEntry(g, { x: 13, y: 20, w: 62, h: 24 }, AUTO, '12 56')
    expect('glyphs' in entry && entry.glyphs.map((x) => x.ch).join('')).toBe('1256')
    expect('error' in learnFromItemEntry(g, { x: 13, y: 20, w: 62, h: 24 }, AUTO, '125')).toBe(true)
    const cell = learnFromCell(g, { x: 90 + COLS.unitPrice.x, y: 20 + ROW_H, w: COLS.unitPrice.w, h: ROW_H }, AUTO, '1,005')
    expect('glyphs' in cell && cell.glyphs.map((x) => x.ch).join('')).toBe('1,005')
  })
})
