import type { BookEvidence } from '../market/order-book'
import { ageHours } from '../pricing/stats'

// Puntuación 0–100 por componentes. El score total solo ordena: la UI siempre muestra las métricas
// originales (ganancia, ROI, liquidez, frescura) junto a él.

export interface ScoreWeights {
  roi: number
  liquidity: number
  confidence: number
  stability: number
}

export const DEFAULT_WEIGHTS: ScoreWeights = { roi: 0.35, liquidity: 0.3, confidence: 0.2, stability: 0.15 }

export interface ScoreParams {
  /** ROI (%) que equivale a 100 puntos. */
  roiForFullScore: number
  /** Vida media de la confianza por antigüedad, en horas. */
  freshnessHalfLifeHours: number
  /** Peso de los datos de terceros frente a capturas propias. */
  thirdPartyWeight: number
}

export const DEFAULT_SCORE_PARAMS: ScoreParams = { roiForFullScore: 50, freshnessHalfLifeHours: 24, thirdPartyWeight: 0.6 }

export interface ScoreBreakdown {
  roi: number
  liquidity: number
  confidence: number
  stability: number
  total: number
}

const clamp = (x: number) => Math.max(0, Math.min(100, x))

export function roiScore(roiPct: number | null, params: ScoreParams): number {
  return roiPct === null ? 0 : clamp((roiPct / params.roiForFullScore) * 100)
}

/** Confianza de un conjunto de evidencias: la peor de ellas (fuente × frescura × OCR). */
export function confidenceScore(evidence: readonly BookEvidence[], now: Date, params: ScoreParams): number {
  if (evidence.length === 0) return 0
  const each = evidence.map((e) => {
    const sourceWeight = e.source === 'third_party' ? params.thirdPartyWeight : 1
    const freshness = 0.5 ** (ageHours(e.observedAt, now) / params.freshnessHalfLifeHours)
    return sourceWeight * freshness * (e.confidence ?? 1)
  })
  return clamp(Math.min(...each) * 100)
}

export function stabilityScore(cv: number | null): number {
  return cv === null ? 50 : clamp(100 * (1 - Math.min(1, cv)))
}

export function totalScore(parts: Omit<ScoreBreakdown, 'total'>, w: ScoreWeights = DEFAULT_WEIGHTS): ScoreBreakdown {
  const sumW = w.roi + w.liquidity + w.confidence + w.stability || 1
  const total = (parts.roi * w.roi + parts.liquidity * w.liquidity + parts.confidence * w.confidence + parts.stability * w.stability) / sumW
  return { ...parts, total: Math.round(total) }
}

/** ROI sobre capital comprometido (compra + costos pagados) y sobre compra; dos denominadores documentados. */
export function roi(netProfit: number, buyCost: number, paidCosts: number): { roiCommitted: number | null; roiPurchase: number | null } {
  const committed = buyCost + paidCosts
  return {
    roiCommitted: committed > 0 ? (netProfit / committed) * 100 : null,
    roiPurchase: buyCost > 0 ? (netProfit / buyCost) * 100 : null,
  }
}
