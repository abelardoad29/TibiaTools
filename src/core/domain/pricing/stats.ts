import type { Gp } from '../money/gp'

export interface PriceObservation {
  price: Gp
  amount: number
  observedAt: string
}

export interface PriceStats {
  count: number
  totalAmount: number
  min: Gp | null
  max: Gp | null
  p25: Gp | null
  median: Gp | null
  p75: Gp | null
  iqr: Gp | null
  mean: Gp | null
  /** Media ponderada por cantidad ofertada (no por ventas). */
  amountWeightedMean: Gp | null
  /** Coeficiente de variación (desv. estándar / media); null con menos de 2 datos. */
  cv: number | null
  firstAt: string | null
  lastAt: string | null
}

/** Percentil con interpolación lineal sobre valores ordenados; redondeo hacia abajo a GP entero. */
export function percentile(sorted: readonly number[], p: number): Gp | null {
  if (sorted.length === 0) return null
  if (p <= 0) return sorted[0]!
  if (p >= 1) return sorted.at(-1)!
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const v = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)
  return Math.floor(v)
}

export function priceStats(obs: readonly PriceObservation[]): PriceStats {
  const prices = obs.map((o) => o.price).sort((a, b) => a - b)
  const n = prices.length
  if (n === 0) {
    return { count: 0, totalAmount: 0, min: null, max: null, p25: null, median: null, p75: null, iqr: null, mean: null, amountWeightedMean: null, cv: null, firstAt: null, lastAt: null }
  }
  const total = prices.reduce((a, b) => a + b, 0)
  const mean = total / n
  const totalAmount = obs.reduce((s, o) => s + o.amount, 0)
  const weighted = totalAmount > 0 ? obs.reduce((s, o) => s + o.price * o.amount, 0) / totalAmount : null
  const variance = n > 1 ? prices.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : null
  const p25 = percentile(prices, 0.25)
  const p75 = percentile(prices, 0.75)
  const times = obs.map((o) => o.observedAt).sort()
  return {
    count: n,
    totalAmount,
    min: prices[0]!,
    max: prices.at(-1)!,
    p25,
    median: percentile(prices, 0.5),
    p75,
    iqr: p25 !== null && p75 !== null ? p75 - p25 : null,
    mean: Math.floor(mean),
    amountWeightedMean: weighted === null ? null : Math.floor(weighted),
    cv: variance === null || mean === 0 ? null : Math.sqrt(variance) / mean,
    firstAt: times[0] ?? null,
    lastAt: times.at(-1) ?? null,
  }
}

export function ageHours(observedAt: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(observedAt).getTime()) / 3_600_000)
}
