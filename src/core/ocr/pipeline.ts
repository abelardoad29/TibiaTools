import { parseGp } from '../domain/money/gp'
import { binarize, crop, scaleRect, toGray, type Gray } from './image'
import { readLine, rowSpans } from './glyphs'
import type { OcrField, OcrOfferRow, OcrProfile, OcrResult, OffersTableDef, Rect, RgbaImage } from './types'

export const OCR_VERSION = 'glyph-v1'
export const PARSER_VERSION = 'tt-parser-v1'

function readField(gray: Gray, rect: Rect, profile: OcrProfile, kind: 'int' | 'gp'): OcrField {
  const bin = binarize(crop(gray, rect), profile.preprocess.threshold, profile.preprocess.darkText)
  const line = readLine(bin, profile.atlas, profile.preprocess.spaceGap)
  const raw = line.text.trim()
  let value: number | null = null
  if (raw && line.unknownGlyphs === 0) {
    if (kind === 'gp') value = parseGp(raw)
    else value = /^\d{1,3}(,\d{3})*$|^\d+$/.test(raw) ? Number(raw.replace(/,/g, '')) : null
  }
  return { raw, value, confidence: value === null ? 0 : line.confidence, unknownGlyphs: line.unknownGlyphs }
}

function readTable(gray: Gray, table: OffersTableDef, profile: OcrProfile, sx: number, sy: number): OcrOfferRow[] {
  const area = scaleRect(table.rect, sx, sy)
  const col = (key: string) => table.columns.find((c) => c.key === key)
  // Las filas se detectan sobre la columna de cantidad (siempre tiene texto) o por alto fijo.
  const anchor = col('amount') ?? col('unitPrice')
  if (!anchor) return []
  let spans: { y0: number; y1: number }[]
  if (table.rowHeight) {
    const rh = Math.max(1, Math.round(table.rowHeight * sy))
    spans = Array.from({ length: Math.floor(area.h / rh) }, (_, i) => ({ y0: i * rh, y1: (i + 1) * rh }))
  } else {
    const anchorRect = { x: Math.round(anchor.x * sx), y: area.y, w: Math.max(1, Math.round(anchor.w * sx)), h: area.h }
    spans = rowSpans(binarize(crop(gray, anchorRect), profile.preprocess.threshold, profile.preprocess.darkText))
  }
  const rows: OcrOfferRow[] = []
  spans.forEach((s, rowIndex) => {
    const pad = 1
    const cell = (key: string): Rect | null => {
      const c = col(key)
      return c ? { x: Math.round(c.x * sx), y: area.y + Math.max(0, s.y0 - pad), w: Math.max(1, Math.round(c.w * sx)), h: s.y1 - s.y0 + 2 * pad } : null
    }
    const amountRect = cell('amount')
    const priceRect = cell('unitPrice')
    const totalRect = cell('totalPrice')
    const endsRect = cell('endsAt')
    const amount = amountRect ? readField(gray, amountRect, profile, 'int') : { raw: '', value: null, confidence: 0, unknownGlyphs: 0 }
    const unitPrice = priceRect ? readField(gray, priceRect, profile, 'gp') : { raw: '', value: null, confidence: 0, unknownGlyphs: 0 }
    const totalPrice = totalRect ? readField(gray, totalRect, profile, 'gp') : null
    let endsAt: OcrOfferRow['endsAt'] = null
    if (endsRect) {
      const bin = binarize(crop(gray, endsRect), profile.preprocess.threshold, profile.preprocess.darkText)
      const l = readLine(bin, profile.atlas, profile.preprocess.spaceGap)
      endsAt = { raw: l.text, confidence: l.confidence }
    }
    rows.push({ side: table.side, rowIndex, rect: { x: area.x, y: area.y + s.y0, w: area.w, h: s.y1 - s.y0 }, amount, unitPrice, totalPrice, endsAt, issues: [] })
  })
  return rows
}

/** Validaciones cruzadas: total = cantidad × precio, valores positivos y orden de precios por lado. */
export function validateRows(rows: OcrOfferRow[]): OcrOfferRow[] {
  return rows.map((r, i, list) => {
    const issues: string[] = []
    if (r.amount.value === null) issues.push('Cantidad ilegible')
    else if (r.amount.value <= 0) issues.push('Cantidad debe ser > 0')
    if (r.unitPrice.value === null) issues.push('Precio ilegible')
    else if (r.unitPrice.value <= 0) issues.push('Precio debe ser > 0')
    if (r.totalPrice && r.totalPrice.value !== null && r.amount.value !== null && r.unitPrice.value !== null && r.amount.value * r.unitPrice.value !== r.totalPrice.value) {
      issues.push(`Total ${r.totalPrice.value.toLocaleString('en-US')} ≠ cantidad × precio`)
    }
    const prev = list.slice(0, i).reverse().find((p) => p.side === r.side && p.unitPrice.value !== null)
    if (prev && r.unitPrice.value !== null && prev.unitPrice.value !== null) {
      if (r.side === 'sell' && r.unitPrice.value < prev.unitPrice.value) issues.push('Fuera de orden: las sell offers van de menor a mayor precio')
      if (r.side === 'buy' && r.unitPrice.value > prev.unitPrice.value) issues.push('Fuera de orden: las buy offers van de mayor a menor precio')
    }
    return { ...r, issues }
  })
}

export function runOcr(img: RgbaImage, profile: OcrProfile): OcrResult {
  const warnings: string[] = []
  const sx = img.width / profile.refWidth
  const sy = img.height / profile.refHeight
  if (Math.abs(sx - sy) > 0.02) warnings.push(`La imagen (${img.width}×${img.height}) no tiene la proporción del perfil (${profile.refWidth}×${profile.refHeight}): revisa la región`)
  if (Math.abs(sx - 1) > 0.01) warnings.push(`La imagen está a escala ${sx.toFixed(2)} respecto al perfil: los glifos pueden no coincidir; recalibra para esta resolución`)
  if (profile.atlas.glyphs.length === 0) warnings.push('El perfil no tiene glifos calibrados: calibra con al menos una línea de cada dígito y la coma')
  const gray = toGray(img)

  const rows = validateRows(profile.tables.flatMap((t) => readTable(gray, t, profile, sx, sy)))
  const details = profile.detailsFields.map((f) => ({ side: f.side, field: f.field, value: readField(gray, scaleRect(f.rect, sx, sy), profile, f.field === 'transactions' ? 'int' : 'gp') }))
  return { ocrVersion: OCR_VERSION, profileVersion: profile.version, scale: sx, rows, details, warnings }
}

/** Nivel de revisión según los umbrales configurables (no son precisión garantizada). */
export function reviewLevel(confidence: number, thresholds: { acceptThreshold: number; reviewThreshold: number }): 'accept' | 'review' | 'required' {
  if (confidence >= thresholds.acceptThreshold) return 'accept'
  if (confidence >= thresholds.reviewThreshold) return 'review'
  return 'required'
}
