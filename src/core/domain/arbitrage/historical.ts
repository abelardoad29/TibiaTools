import { mulGp, type Gp } from '../money/gp'
import { postingFee, type MarketFeeRule } from '../money/market-fee'
import { sortLevels, walkBook, type OfferLevel } from '../market/order-book'
import { percentile } from '../pricing/stats'

// Historical: comprar en origen y PUBLICAR una sell offer en destino a un precio objetivo tomado de
// la distribución de precios observados ahí (P25 pesimista, P50 base, P75 optimista).
// Es una estimación, no una predicción: si la muestra es pequeña el escenario se marca o se bloquea.

export type ScenarioName = 'pessimistic' | 'base' | 'optimistic'

export interface HistoricalScenario {
  name: ScenarioName
  percentile: number
  targetPrice: Gp
  revenue: Gp
  postingFee: Gp
  netProfit: Gp
}

export interface HistoricalResult {
  status: 'ok' | 'experimental' | 'insufficient_sample'
  quantity: number
  buyCost: Gp
  scenarios: HistoricalScenario[]
  sample: { observations: number; snapshots: number; days: number; lastObservedAt: string | null }
  /** Días mínimos para vender si se capturara el 100 % de las ventas oficiales; null sin datos oficiales. */
  minDaysToSell: number | null
  noSaleRisk: 'low' | 'medium' | 'high' | 'unknown'
  warnings: string[]
}

export interface HistoricalInput {
  originSell: readonly OfferLevel[]
  /** Precios de sell offers observados en el destino (cada nivel de cada snapshot). */
  destSellPrices: readonly Gp[]
  sample: { snapshots: number; days: number; lastObservedAt: string | null }
  officialSoldPerDay: number | null
  feeRule: MarketFeeRule
  minSnapshots: number
  quantity?: number
  maxQuantity?: number
  budgetGp?: Gp
  /** Duración de una oferta publicada (30 días según el manual). */
  offerDurationDays?: number
}

const PCTS: [ScenarioName, number][] = [
  ['pessimistic', 0.25],
  ['base', 0.5],
  ['optimistic', 0.75],
]

export function historicalArbitrage(input: HistoricalInput): HistoricalResult {
  const prices = [...input.destSellPrices].sort((a, b) => a - b)
  const warnings: string[] = []
  const sample = { observations: prices.length, ...input.sample }
  const status: HistoricalResult['status'] =
    input.sample.snapshots >= input.minSnapshots ? 'ok' : input.sample.snapshots >= Math.min(3, input.minSnapshots) ? 'experimental' : 'insufficient_sample'
  if (status !== 'ok') warnings.push(`Muestra de ${input.sample.snapshots} snapshots (mínimo ${input.minSnapshots})`)

  const base = percentile(prices, 0.5)
  if (status === 'insufficient_sample' || base === null) {
    return { status: 'insufficient_sample', quantity: 0, buyCost: 0, scenarios: [], sample, minDaysToSell: null, noSaleRisk: 'unknown', warnings }
  }

  // Cantidad: unidades de origen cuyo precio deja margen contra el escenario base después de comisión.
  const sells = sortLevels('sell', input.originSell)
  const feePerUnitEstimate = Math.ceil((base * input.feeRule.rateBps) / 10_000)
  let quantity = input.quantity ?? walkBook(sells, input.maxQuantity ?? Number.MAX_SAFE_INTEGER, (p) => p + feePerUnitEstimate < base).filled
  if (input.budgetGp !== undefined && input.quantity === undefined) {
    let spent = 0
    let q = 0
    for (const l of sells) {
      if (l.unitPrice + feePerUnitEstimate >= base) break
      const take = Math.min(l.amount, quantity - q, Math.floor((input.budgetGp - spent) / l.unitPrice))
      if (take <= 0) break
      q += take
      spent += take * l.unitPrice
    }
    quantity = q
  }
  const walk = walkBook(sells, quantity)
  if (walk.unfilled > 0) warnings.push(`${walk.unfilled} unidades sin sell offers en el origen`)
  quantity = walk.filled

  const scenarios: HistoricalScenario[] = quantity === 0 ? [] : PCTS.map(([name, p]) => {
    const targetPrice = percentile(prices, p)!
    const fee = postingFee(input.feeRule, targetPrice, quantity)
    const revenue = mulGp(targetPrice, quantity)
    return { name, percentile: p, targetPrice, revenue, postingFee: fee.fee, netProfit: revenue - walk.total - fee.fee }
  })
  const feeWarnings = quantity > 0 ? postingFee(input.feeRule, base, quantity).warnings : []

  const duration = input.offerDurationDays ?? 30
  const minDaysToSell = input.officialSoldPerDay && input.officialSoldPerDay > 0 ? quantity / input.officialSoldPerDay : null
  const noSaleRisk: HistoricalResult['noSaleRisk'] =
    minDaysToSell === null ? 'unknown' : minDaysToSell > duration / 2 ? 'high' : minDaysToSell > duration / 10 ? 'medium' : 'low'
  if (minDaysToSell !== null && minDaysToSell > duration) warnings.push(`Aun vendiendo todo el volumen oficial tardaría ${Math.ceil(minDaysToSell)} días (> ${duration} de vigencia)`)
  if (input.officialSoldPerDay === null) warnings.push('Sin estadísticas oficiales de ventas: liquidez desconocida')

  return { status, quantity, buyCost: walk.total, scenarios, sample, minDaysToSell, noSaleRisk, warnings: [...warnings, ...feeWarnings] }
}
