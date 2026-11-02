// Tipos del pipeline OCR. Todo está en coordenadas de píxel de la imagen de referencia del perfil.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type ScreenType = 'offers' | 'details'
export type OfferColumnKey = 'amount' | 'unitPrice' | 'totalPrice' | 'endsAt'
export type DetailsField = 'transactions' | 'highest' | 'average' | 'lowest'

export interface OffersTableDef {
  side: 'buy' | 'sell'
  /** Área de filas (sin cabecera). */
  rect: Rect
  /** Columnas: posición horizontal relativa a la imagen. */
  columns: { key: OfferColumnKey; x: number; w: number }[]
  /** Alto fijo de fila en px; null = detectar filas por proyección horizontal. */
  rowHeight: number | null
}

export interface DetailsFieldDef {
  side: 'buy' | 'sell'
  field: DetailsField
  rect: Rect
}

export interface Preprocess {
  /** Umbral de binarización 0–255, u "otsu" para calcularlo por región. */
  threshold: number | 'otsu'
  /** true si el texto es más oscuro que el fondo. */
  darkText: boolean
  /** Separación mínima (px) entre glifos que se considera espacio. */
  spaceGap: number
}

export interface Glyph {
  ch: string
  w: number
  h: number
  /** Bits fila por fila, '1' = tinta. */
  bits: string
}

export interface GlyphAtlas {
  glyphs: Glyph[]
}

export interface OcrProfile {
  id: number | null
  name: string
  screenType: ScreenType
  refWidth: number
  refHeight: number
  tables: OffersTableDef[]
  detailsFields: DetailsFieldDef[]
  preprocess: Preprocess
  atlas: GlyphAtlas
  version: number
  updatedAt: string | null
}

export interface OcrField {
  raw: string
  value: number | null
  /** 0–1: peor coincidencia de glifo del campo. */
  confidence: number
  unknownGlyphs: number
}

export interface OcrOfferRow {
  side: 'buy' | 'sell'
  rowIndex: number
  rect: Rect
  amount: OcrField
  unitPrice: OcrField
  totalPrice: OcrField | null
  endsAt: { raw: string; confidence: number } | null
  issues: string[]
}

export interface OcrDetailsValue {
  side: 'buy' | 'sell'
  field: DetailsField
  value: OcrField
}

export interface OcrResult {
  ocrVersion: string
  profileVersion: number
  scale: number
  rows: OcrOfferRow[]
  details: OcrDetailsValue[]
  warnings: string[]
}

/** Imagen RGBA cruda, compatible con ImageData del navegador. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}
