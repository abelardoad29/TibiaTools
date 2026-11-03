import type { Gp } from '../money/gp'
import type { MarketFeeRule } from '../money/market-fee'
import type { BookEvidence, BookSide } from '../market/order-book'
import { estimateLiquidity, type LiquidityEstimate, type OfficialStats } from '../liquidity/liquidity'
import { ageHours } from '../pricing/stats'
import { historicalArbitrage, type HistoricalResult } from './historical'
import { instantArbitrage, type InstantResult } from './instant'
import {
  confidenceScore,
  roi,
  roiScore,
  stabilityScore,
  totalScore,
  type ScoreBreakdown,
  type ScoreParams,
  type ScoreWeights,
} from './scoring'

export type Strategy = 'instant' | 'historical' | 'hybrid'

export interface ItemMarketData {
  itemId: number
  itemName: string
  originSell: BookSide | null
  destBuy: BookSide | null
  destSellHistory: { prices: Gp[]; snapshots: number; days: number; lastObservedAt: string | null; cv: number | null; evidence: BookEvidence | null }
  destOfficial: OfficialStats | null
  destInferred: { possiblyFilledQuantity: number; observedDays: number } | null
}

export interface AnalysisParams {
  strategy: Strategy
  feeRule: MarketFeeRule
  minSnapshots: number
  maxQuantityPerItem?: number
  budgetGp?: Gp
  /** Datos más viejos que esto generan advertencia (no se ocultan). */
  staleAfterHours: number
  /** Factor con que Hybrid descuenta la ganancia histórica frente a la inmediata (0–1). */
  historicalHaircut: number
  weights: ScoreWeights
  scoreParams: ScoreParams
}

export interface Opportunity {
  itemId: number
  itemName: string
  strategy: Strategy
  /** En Hybrid, la estrategia que gana tras el descuento por riesgo. */
  recommended: 'instant' | 'historical' | 'none'
  quantity: number
  buyCost: Gp
  grossRevenue: Gp
  marketFees: Gp
  /** El costo de transferencia es por viaje: se aplica a nivel de ruta/carrito, no por item. */
  transferCost: Gp
  otherCosts: Gp
  netProfit: Gp
  roiCommitted: number | null
  roiPurchase: number | null
  liquidity: LiquidityEstimate
  scores: ScoreBreakdown
  instant: InstantResult | null
  historical: HistoricalResult | null
  evidence: BookEvidence[]
  warnings: string[]
}

export function analyzeItem(data: ItemMarketData, p: AnalysisParams, now: Date): Opportunity | null {
  if (!data.originSell) return null
  const evidence: BookEvidence[] = [data.originSell.evidence]
  const warnings: string[] = []

  const instant = p.strategy !== 'historical' && data.destBuy
    ? instantArbitrage(data.originSell.levels, data.destBuy.levels, { maxQuantity: p.maxQuantityPerItem, budgetGp: p.budgetGp })
    : null
  if (instant && data.destBuy) evidence.push(data.destBuy.evidence)

  const liquidity = estimateLiquidity(data.destOfficial, data.destInferred)
  const historical = p.strategy !== 'instant'
    ? historicalArbitrage({
        originSell: data.originSell.levels,
        destSellPrices: data.destSellHistory.prices,
        sample: { snapshots: data.destSellHistory.snapshots, days: data.destSellHistory.days, lastObservedAt: data.destSellHistory.lastObservedAt },
        officialSoldPerDay: liquidity.officialTransactionsPerDay,
        feeRule: p.feeRule,
        minSnapshots: p.minSnapshots,
        maxQuantity: p.maxQuantityPerItem,
        budgetGp: p.budgetGp,
      })
    : null
  if (historical && data.destSellHistory.evidence) evidence.push(data.destSellHistory.evidence)

  const histBase = historical?.scenarios.find((s) => s.name === 'base') ?? null
  const instantNet = instant && instant.quantity > 0 ? instant.grossProfit : null
  const histNet = histBase && historical!.status !== 'insufficient_sample' ? histBase.netProfit : null

  let recommended: Opportunity['recommended']
  if (p.strategy === 'instant') recommended = instantNet !== null && instantNet > 0 ? 'instant' : 'none'
  else if (p.strategy === 'historical') recommended = histNet !== null && histNet > 0 ? 'historical' : 'none'
  else {
    const adjHist = histNet === null ? null : histNet * p.historicalHaircut
    if ((instantNet ?? 0) <= 0 && (adjHist ?? 0) <= 0) recommended = 'none'
    else recommended = (instantNet ?? -Infinity) >= (adjHist ?? -Infinity) ? 'instant' : 'historical'
  }
  if (recommended === 'none' && instantNet === null && histNet === null) return null

  const useHist = recommended === 'historical' || (recommended === 'none' && instantNet === null)
  const quantity = useHist ? (historical?.quantity ?? 0) : (instant?.quantity ?? 0)
  const buyCost = useHist ? (historical?.buyCost ?? 0) : (instant?.buyCost ?? 0)
  const grossRevenue = useHist ? (histBase?.revenue ?? 0) : (instant?.revenue ?? 0)
  const marketFees = useHist ? (histBase?.postingFee ?? 0) : 0
  const netProfit = grossRevenue - buyCost - marketFees
  const r = roi(netProfit, buyCost, marketFees)

  for (const e of evidence) {
    const age = ageHours(e.observedAt, now)
    if (age > p.staleAfterHours) warnings.push(`Dato ${e.source === 'third_party' ? 'de terceros ' : ''}con ${Math.round(age)} h de antigüedad`)
    if (e.source === 'third_party') warnings.push('Incluye datos de terceros (tibiamarket), no capturas propias')
  }
  warnings.push(...(instant?.warnings ?? []), ...(historical?.warnings ?? []))

  const scores = totalScore(
    {
      roi: roiScore(r.roiCommitted, p.scoreParams),
      liquidity: liquidity.score,
      confidence: confidenceScore(evidence, now, p.scoreParams),
      stability: stabilityScore(data.destSellHistory.cv),
    },
    p.weights,
  )

  return {
    itemId: data.itemId,
    itemName: data.itemName,
    strategy: p.strategy,
    recommended,
    quantity,
    buyCost,
    grossRevenue,
    marketFees,
    transferCost: 0,
    otherCosts: 0,
    netProfit,
    roiCommitted: r.roiCommitted,
    roiPurchase: r.roiPurchase,
    liquidity,
    scores,
    instant,
    historical,
    evidence,
    warnings: [...new Set(warnings)],
  }
}

export type Ranking = 'profit' | 'roi' | 'liquidity' | 'risk_adjusted'

export function rankOpportunities(list: readonly Opportunity[], by: Ranking): Opportunity[] {
  const key: Record<Ranking, (o: Opportunity) => number> = {
    profit: (o) => o.netProfit,
    roi: (o) => o.roiCommitted ?? -Infinity,
    liquidity: (o) => o.liquidity.score,
    risk_adjusted: (o) => o.scores.total,
  }
  return [...list].filter((o) => o.netProfit > 0).sort((a, b) => key[by](b) - key[by](a))
}
