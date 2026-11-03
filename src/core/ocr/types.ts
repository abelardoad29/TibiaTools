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

/** Lista "Items:" del Market: una entrada por bloque de `entryHeight`; la seleccionada tiene el fondo más claro. */
export interface ItemListDef {
  rect: Rect
  entryHeight: number
  /** Ancho a la izquierda ocupado por el icono del item (se salta al leer el nombre). */
  iconWidth: number
  /** Glifos de letras: la lista usa otra fuente que las tablas. */
  atlas: GlyphAtlas
  spaceGap: number
}

export interface DetailsFieldDef {
  side: 'buy' | 'sell'
  field: DetailsField
  rect: Rect
}

export interface Preprocess {
  /** Umbral 0–255, "otsu" por región, o "auto": adaptativo por línea (fondo = tono dominante + delta). */
  threshold: number | 'otsu' | 'auto'
  /** Separación mínima de tono entre texto y fondo para el modo "auto" (por defecto 10). */
  delta?: number
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

/** Etiqueta fija del Market usada para ubicar la ventana (posición de referencia + bitmap binarizado). */
export interface OcrAnchor {
  x: number
  y: number
  w: number
  h: number
  /** Umbral fijo con el que se binarizó (el fondo de la ventana tiene textura, el umbral adaptativo no sirve). */
  threshold: number
  bits: string
  label: string
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
  /** Opcional: si existe, las regiones se desplazan según dónde aparezca el ancla en la captura. */
  anchor?: OcrAnchor | null
  /** Opcional: dónde leer el nombre del item seleccionado. */
  itemList?: ItemListDef | null
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

export interface OcrItemEntry {
  index: number
  /** Texto leído ('?' = glifo desconocido); un nombre partido en dos líneas se une con un espacio. */
  raw: string
  confidence: number
  unknownGlyphs: number
  /** Tono de fondo dominante: la entrada seleccionada es la más clara. */
  background: number
  rect: Rect
}

export interface OcrItemRead {
  entries: OcrItemEntry[]
  /** Entrada seleccionada (fondo más claro, o la única de la lista); null si no se puede decidir. */
  selected: OcrItemEntry | null
}

export interface OcrResult {
  ocrVersion: string
  profileVersion: number
  scale: number
  /** null si la ventana del Market no se encontró (perfil con ancla). */
  marketFound: boolean
  item: OcrItemRead | null
  /** Desplazamiento aplicado a las regiones por el ancla (0,0 si no hay ancla o no se movió). */
  offset: { dx: number; dy: number; score: number | null }
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
