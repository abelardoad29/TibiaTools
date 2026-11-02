import type { Rect, RgbaImage } from './types'

// Operaciones de imagen mínimas, sin dependencias, sobre buffers en memoria.

export interface Gray {
  width: number
  height: number
  data: Uint8Array
}

/** 1 = tinta (texto), 0 = fondo. */
export interface Binary {
  width: number
  height: number
  data: Uint8Array
}

export function toGray(img: RgbaImage): Gray {
  const out = new Uint8Array(img.width * img.height)
  const d = img.data
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // Luminancia BT.601 en enteros.
    out[i] = (d[p]! * 299 + d[p + 1]! * 587 + d[p + 2]! * 114) / 1000
  }
  return { width: img.width, height: img.height, data: out }
}

export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width, Math.round(r.x)))
  const y = Math.max(0, Math.min(height, Math.round(r.y)))
  return { x, y, w: Math.max(0, Math.min(width - x, Math.round(r.w))), h: Math.max(0, Math.min(height - y, Math.round(r.h))) }
}

export function crop<T extends Gray | Binary>(img: T, r: Rect): T {
  const c = clampRect(r, img.width, img.height)
  const out = new Uint8Array(c.w * c.h)
  for (let y = 0; y < c.h; y++) out.set(img.data.subarray((c.y + y) * img.width + c.x, (c.y + y) * img.width + c.x + c.w), y * c.w)
  return { width: c.w, height: c.h, data: out } as T
}

/** Umbral de Otsu sobre el histograma de grises. */
export function otsu(g: Gray): number {
  const hist = new Array<number>(256).fill(0)
  for (const v of g.data) hist[v]!++
  const total = g.data.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]!
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]!
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

export function binarize(g: Gray, threshold: number | 'otsu', darkText: boolean): Binary {
  const t = threshold === 'otsu' ? otsu(g) : threshold
  const out = new Uint8Array(g.data.length)
  for (let i = 0; i < out.length; i++) out[i] = darkText ? (g.data[i]! <= t ? 1 : 0) : g.data[i]! > t ? 1 : 0
  return { width: g.width, height: g.height, data: out }
}

/** Escala un rectángulo del perfil (resolución de referencia) a la imagen real. */
export function scaleRect(r: Rect, sx: number, sy: number): Rect {
  return { x: Math.round(r.x * sx), y: Math.round(r.y * sy), w: Math.max(1, Math.round(r.w * sx)), h: Math.max(1, Math.round(r.h * sy)) }
}

/** Diferencia media absoluta entre dos imágenes de grises del mismo tamaño (detección de cambios). */
export function meanAbsDiff(a: Gray, b: Gray): number {
  if (a.width !== b.width || a.height !== b.height) return 255
  let s = 0
  for (let i = 0; i < a.data.length; i++) s += Math.abs(a.data[i]! - b.data[i]!)
  return s / Math.max(1, a.data.length)
}

/** Reducción por promedio de bloques (firma pequeña para comparar capturas). */
export function downsample(g: Gray, targetW: number): Gray {
  const f = Math.max(1, Math.floor(g.width / targetW))
  const w = Math.floor(g.width / f)
  const h = Math.floor(g.height / f)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += g.data[(y * f + dy) * g.width + x * f + dx]!
      out[y * w + x] = s / (f * f)
    }
  }
  return { width: w, height: h, data: out }
}
