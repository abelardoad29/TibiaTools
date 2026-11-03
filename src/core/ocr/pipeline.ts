import { parseGp } from '../domain/money/gp'
import { binarize, crop, scaleRect, toBinary, toGray, type Binary, type Gray } from './image'
import { readLine, rowSpans } from './glyphs'
import { locateAnchor } from './locate'
import type { ItemListDef, OcrField, OcrItemEntry, OcrItemRead, OcrOfferRow, OcrProfile, OcrResult, OffersTableDef, Rect, RgbaImage } from './types'

export const OCR_VERSION = 'glyph-v2'
export const PARSER_VERSION = 'tt-parser-v2'

const EMPTY_FIELD: OcrField = { raw: '', value: null, confidence: 0, unknownGlyphs: 0 }

/** Proyección de regiones del perfil a la captura: escala (perfiles sin ancla) más el desplazamiento del ancla. */
interface Place {
  sx: number
  sy: number
  dx: number
  dy: number
}

const place = (r: Rect, p: Place): Rect => {
  const s = scaleRect(r, p.sx, p.sy)
  return { ...s, x: s.x + p.dx, y: s.y + p.dy }
}
const placeX = (x: number, p: Place) => Math.round(x * p.sx) + p.dx

const hasInk = (b: Binary) => b.data.some((v) => v === 1)

function readField(gray: Gray, rect: Rect, profile: OcrProfile, kind: 'int' | 'gp'): OcrField {
  const bin = toBinary(crop(gray, rect), profile.preprocess)
  const line = readLine(bin, profile.atlas, profile.preprocess.spaceGap)
  const raw = line.text.trim()
  let value: number | null = null
  if (raw && line.unknownGlyphs === 0) {
    if (kind === 'gp') value = parseGp(raw)
    else value = /^\d{1,3}(,\d{3})*$|^\d+$/.test(raw) ? Number(raw.replace(/,/g, '')) : null
  }
  return { raw, value, confidence: value === null ? 0 : line.confidence, unknownGlyphs: line.unknownGlyphs }
}

/** Une dos binarios lado a lado (sin la línea separadora de columnas que hay entre ellos en pantalla). */
function besides(a: Binary, b: Binary): Binary {
  const h = Math.min(a.height, b.height)
  const w = a.width + b.width
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    data.set(a.data.subarray(y * a.width, (y + 1) * a.width), y * w)
    data.set(b.data.subarray(y * b.width, (y + 1) * b.width), y * w + a.width)
  }
  return { width: w, height: h, data }
}

function readTable(gray: Gray, table: OffersTableDef, profile: OcrProfile, p: Place): OcrOfferRow[] {
  const area = place(table.rect, p)
  const col = (key: string) => table.columns.find((c) => c.key === key)
  const colRect = (key: string, y: number, h: number): Rect | null => {
    const c = col(key)
    return c ? { x: placeX(c.x, p), y, w: Math.max(1, Math.round(c.w * p.sx)), h } : null
  }
  // Las filas se detectan con la cantidad y el precio juntos (una fila con texto en cualquiera de las dos cuenta).
  const keyCols = ['amount', 'unitPrice'].map((k) => colRect(k, area.y, area.h)).filter((r): r is Rect => r !== null)
  if (!keyCols.length) return []
  const keyBinary = keyCols.map((r) => toBinary(crop(gray, r), profile.preprocess)).reduce(besides)
  let spans: { y0: number; y1: number }[]
  if (table.rowHeight) {
    const rh = Math.max(1, Math.round(table.rowHeight * p.sy))
    spans = Array.from({ length: Math.floor(area.h / rh) }, (_, i) => ({ y0: i * rh, y1: (i + 1) * rh }))
      // Filas vacías al final de una tabla con pocas ofertas.
      .filter((s) => hasInk(crop(keyBinary, { x: 0, y: s.y0, w: keyBinary.width, h: s.y1 - s.y0 })))
  } else {
    spans = rowSpans(keyBinary)
  }
  // Con alto fijo la celda es la franja exacta de la fila; detectada por proyección se le da 1 px de margen.
  const pad = table.rowHeight ? 0 : 1
  return spans.map((s, rowIndex) => {
    const y = area.y + Math.max(0, s.y0 - pad)
    const h = s.y1 - s.y0 + 2 * pad
    const amountRect = colRect('amount', y, h)
    const priceRect = colRect('unitPrice', y, h)
    const totalRect = colRect('totalPrice', y, h)
    const endsRect = colRect('endsAt', y, h)
    let endsAt: OcrOfferRow['endsAt'] = null
    if (endsRect) {
      const l = readLine(toBinary(crop(gray, endsRect), profile.preprocess), profile.atlas, profile.preprocess.spaceGap)
      endsAt = { raw: l.text.trim(), confidence: l.confidence }
    }
    return {
      side: table.side,
      rowIndex,
      rect: { x: area.x, y: area.y + s.y0, w: area.w, h: s.y1 - s.y0 },
      amount: amountRect ? readField(gray, amountRect, profile, 'int') : EMPTY_FIELD,
      unitPrice: priceRect ? readField(gray, priceRect, profile, 'gp') : EMPTY_FIELD,
      totalPrice: totalRect ? readField(gray, totalRect, profile, 'gp') : null,
      endsAt,
      issues: [],
    }
  })
}

function dominantTone(g: Gray): number {
  const hist = new Uint32Array(256)
  for (const v of g.data) hist[v]!++
  let mode = 0
  for (let v = 1; v < 256; v++) if (hist[v]! > hist[mode]!) mode = v
  return mode
}

/** Lee la lista "Items:" y decide cuál es el item seleccionado (el de fondo más claro). */
export function readItemList(gray: Gray, def: ItemListDef, profile: OcrProfile, p: Place = { sx: 1, sy: 1, dx: 0, dy: 0 }): OcrItemRead {
  const area = place(def.rect, p)
  const eh = Math.max(1, Math.round(def.entryHeight * p.sy))
  const icon = Math.round(def.iconWidth * p.sx)
  const entries: OcrItemEntry[] = []
  for (let i = 0; (i + 1) * eh <= area.h; i++) {
    const rect = { x: area.x + icon, y: area.y + i * eh, w: area.w - icon, h: eh }
    const g = crop(gray, rect)
    const b = toBinary(g, profile.preprocess)
    // Hueco mínimo de 2 líneas: el punto de la "i" no parte la línea; un nombre en dos líneas sí.
    const lines = rowSpans(b, 2).map((s) => readLine(crop(b, { x: 0, y: s.y0, w: b.width, h: s.y1 - s.y0 }), def.atlas, def.spaceGap))
    if (!lines.length) continue
    entries.push({
      index: i,
      raw: lines.map((l) => l.text.trim()).join(' '),
      confidence: Math.min(...lines.map((l) => l.confidence)),
      unknownGlyphs: lines.reduce((a, l) => a + l.unknownGlyphs, 0),
      background: dominantTone(g),
      rect,
    })
  }
  let selected: OcrItemEntry | null = null
  if (entries.length === 1) selected = entries[0]!
  else if (entries.length > 1) {
    const sorted = [...entries].sort((a, b) => b.background - a.background)
    // Se exige una diferencia clara de fondo: si todas se ven iguales no se adivina.
    if (sorted[0]!.background - sorted[1]!.background >= 8) selected = sorted[0]!
  }
  return { entries, selected }
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
  const gray = toGray(img)
  let p: Place
  let offset: OcrResult['offset'] = { dx: 0, dy: 0, score: null }
  if (profile.anchor) {
    // La ventana del Market tiene tamaño fijo en píxeles: con ancla no se escala, solo se desplaza.
    // Así el perfil sirve en cualquier resolución mientras la interfaz del cliente no esté escalada.
    const m = locateAnchor(binarize(gray, profile.anchor.threshold, false), profile.anchor)
    if (!m) {
      warnings.push(`No se encontró la ventana del Market (etiqueta «${profile.anchor.label}»). ¿Está abierta y sin tapar, con la interfaz a escala 100 %?`)
      return { ocrVersion: OCR_VERSION, profileVersion: profile.version, scale: 1, marketFound: false, item: null, offset, rows: [], details: [], warnings }
    }
    offset = { dx: m.dx, dy: m.dy, score: m.score }
    p = { sx: 1, sy: 1, dx: m.dx, dy: m.dy }
  } else {
    const sx = img.width / profile.refWidth
    const sy = img.height / profile.refHeight
    if (Math.abs(sx - sy) > 0.02) warnings.push(`La imagen (${img.width}×${img.height}) no tiene la proporción del perfil (${profile.refWidth}×${profile.refHeight}): revisa la región`)
    if (Math.abs(sx - 1) > 0.01) warnings.push(`La imagen está a escala ${sx.toFixed(2)} respecto al perfil: los glifos pueden no coincidir; recalibra para esta resolución`)
    p = { sx, sy, dx: 0, dy: 0 }
  }
  if (profile.atlas.glyphs.length === 0) warnings.push('El perfil no tiene glifos calibrados: calibra con al menos una línea de cada dígito y la coma')

  const rows = validateRows(profile.tables.flatMap((t) => readTable(gray, t, profile, p)))
  const details = profile.detailsFields.map((f) => ({ side: f.side, field: f.field, value: readField(gray, place(f.rect, p), profile, f.field === 'transactions' ? 'int' : 'gp') }))
  const item = profile.itemList ? readItemList(gray, profile.itemList, profile, p) : null
  return { ocrVersion: OCR_VERSION, profileVersion: profile.version, scale: p.sx, marketFound: true, item, offset, rows, details, warnings }
}

/** Nivel de revisión según los umbrales configurables (no son precisión garantizada). */
export function reviewLevel(confidence: number, thresholds: { acceptThreshold: number; reviewThreshold: number }): 'accept' | 'review' | 'required' {
  if (confidence >= thresholds.acceptThreshold) return 'accept'
  if (confidence >= thresholds.reviewThreshold) return 'review'
  return 'required'
}
