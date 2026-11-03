import { mulGp, sumGp, type Gp } from '../money/gp'

export type OfferSide = 'buy' | 'sell'

export interface OfferLevel {
  unitPrice: Gp
  amount: number
  expiresAt?: string | null
}

/** Origen y frescura de un lado del libro, para mostrar siempre de dónde salió cada número. */
export interface BookEvidence {
  scanId: string | null
  observedAt: string
  source: 'own_capture' | 'third_party' | 'manual'
  /** Confianza media del OCR (0–1); null si no aplica (terceros, manual). */
  confidence: number | null
}

export interface BookSide {
  side: OfferSide
  levels: OfferLevel[]
  evidence: BookEvidence
}

/** Sell: precio ascendente (lo más barato primero). Buy: descendente (quien paga más primero). */
export function sortLevels(side: OfferSide, levels: readonly OfferLevel[]): OfferLevel[] {
  return [...levels]
    .filter((l) => l.amount > 0 && l.unitPrice > 0)
    .sort((a, b) => (side === 'sell' ? a.unitPrice - b.unitPrice : b.unitPrice - a.unitPrice))
}

export interface Fill {
  unitPrice: Gp
  amount: number
}

export interface WalkResult {
  requested: number
  filled: number
  unfilled: number
  total: Gp
  fills: Fill[]
  worstPrice: Gp | null
}

/**
 * Consume niveles ya ordenados hasta cubrir `quantity`. No extrapola el mejor precio: cada unidad se
 * paga al precio de su nivel. `accept` permite cortar en un precio límite.
 */
export function walkBook(levels: readonly OfferLevel[], quantity: number, accept: (price: Gp) => boolean = () => true): WalkResult {
  let remaining = quantity
  const fills: Fill[] = []
  for (const level of levels) {
    if (remaining <= 0 || !accept(level.unitPrice)) break
    const take = Math.min(level.amount, remaining)
    fills.push({ unitPrice: level.unitPrice, amount: take })
    remaining -= take
  }
  const filled = quantity - remaining
  return {
    requested: quantity,
    filled,
    unfilled: remaining,
    total: sumGp(fills.map((f) => mulGp(f.unitPrice, f.amount))),
    fills,
    worstPrice: fills.at(-1)?.unitPrice ?? null,
  }
}

export function depth(levels: readonly OfferLevel[]): number {
  return levels.reduce((s, l) => s + l.amount, 0)
}

export function bestPrice(side: OfferSide, levels: readonly OfferLevel[]): Gp | null {
  return sortLevels(side, levels)[0]?.unitPrice ?? null
}
