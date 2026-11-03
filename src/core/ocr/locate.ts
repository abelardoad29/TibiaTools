import type { Binary } from './image'
import type { OcrAnchor } from './types'

// Ubica la ventana del Market en la captura buscando una etiqueta fija (el "ancla", p. ej. "Sell Offers:").
// Así el perfil sirve aunque muevas la ventana: todas las regiones se desplazan lo mismo que el ancla.

export interface AnchorMatch {
  dx: number
  dy: number
  /** 0–1: fracción de píxeles del ancla que coinciden. */
  score: number
}

function scoreAt(img: Binary, anchor: OcrAnchor, x: number, y: number, maxMismatch: number): number {
  let mismatch = 0
  for (let j = 0; j < anchor.h; j++) {
    const row = (y + j) * img.width + x
    for (let i = 0; i < anchor.w; i++) {
      const a = anchor.bits.charCodeAt(j * anchor.w + i) === 49 ? 1 : 0
      if (a !== img.data[row + i]) {
        mismatch++
        if (mismatch > maxMismatch) return -1
      }
    }
  }
  return 1 - mismatch / (anchor.w * anchor.h)
}

/**
 * Busca el ancla primero en su posición de referencia y, si no está, en toda la imagen (con corte temprano).
 * Devuelve null si nada alcanza `minScore`.
 */
export function locateAnchor(img: Binary, anchor: OcrAnchor, minScore = 0.97): AnchorMatch | null {
  const maxMismatch = Math.floor(anchor.w * anchor.h * (1 - minScore))
  const fits = (x: number, y: number) => x >= 0 && y >= 0 && x + anchor.w <= img.width && y + anchor.h <= img.height
  if (fits(anchor.x, anchor.y)) {
    const s = scoreAt(img, anchor, anchor.x, anchor.y, maxMismatch)
    if (s >= minScore) return { dx: 0, dy: 0, score: s }
  }
  let best: AnchorMatch | null = null
  for (let y = 0; y + anchor.h <= img.height; y++) {
    for (let x = 0; x + anchor.w <= img.width; x++) {
      const s = scoreAt(img, anchor, x, y, best ? Math.min(maxMismatch, Math.floor(anchor.w * anchor.h * (1 - best.score))) : maxMismatch)
      if (s >= minScore && (!best || s > best.score)) best = { dx: x - anchor.x, dy: y - anchor.y, score: s }
    }
  }
  return best
}
