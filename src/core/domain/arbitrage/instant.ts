import { mulGp, sumGp, type Gp } from '../money/gp'
import { sortLevels, depth, type OfferLevel } from '../market/order-book'

// Instant: comprar en origen aceptando sell offers (barato primero) y liquidar en destino aceptando
// buy offers (quien paga más primero). Aceptar ofertas existentes NO paga comisión de publicación.

export interface MatchedLot {
  buyPrice: Gp
  sellPrice: Gp
  amount: number
  /** Ganancia por unidad de este lote (puede ser negativa en modo cantidad fija). */
  unitProfit: Gp
}

export interface InstantResult {
  mode: 'max-profitable' | 'fixed'
  requested: number | null
  quantity: number
  buyCost: Gp
  revenue: Gp
  grossProfit: Gp
  lots: MatchedLot[]
  /** Unidades pedidas que no se pudieron comprar (sin profundidad en origen). */
  unfilledInOrigin: number
  /** Unidades compradas o pedidas sin contraparte de compra en el destino. */
  withoutDestinationBuyer: number
  originDepth: number
  destinationDepth: number
  warnings: string[]
}

export interface InstantOptions {
  /** Cantidad fija; si se omite, se toman todas las unidades con ganancia positiva. */
  quantity?: number
  maxQuantity?: number
  budgetGp?: Gp
}

export function instantArbitrage(originSell: readonly OfferLevel[], destBuy: readonly OfferLevel[], opts: InstantOptions = {}): InstantResult {
  const sells = sortLevels('sell', originSell)
  const buys = sortLevels('buy', destBuy)
  const fixed = opts.quantity !== undefined
  const target = fixed ? opts.quantity! : Math.min(opts.maxQuantity ?? Number.MAX_SAFE_INTEGER, depth(sells))
  const lots: MatchedLot[] = []
  const warnings: string[] = []

  let i = 0
  let j = 0
  let remSell = sells[0]?.amount ?? 0
  let remBuy = buys[0]?.amount ?? 0
  let qty = 0
  let spent = 0

  while (qty < target && i < sells.length && j < buys.length) {
    const s = sells[i]!
    const b = buys[j]!
    if (!fixed && b.unitPrice <= s.unitPrice) break
    let take = Math.min(remSell, remBuy, target - qty)
    if (opts.budgetGp !== undefined) take = Math.min(take, Math.floor((opts.budgetGp - spent) / s.unitPrice))
    if (take <= 0) break
    lots.push({ buyPrice: s.unitPrice, sellPrice: b.unitPrice, amount: take, unitProfit: b.unitPrice - s.unitPrice })
    qty += take
    spent += take * s.unitPrice
    remSell -= take
    remBuy -= take
    if (remSell === 0) remSell = sells[++i]?.amount ?? 0
    if (remBuy === 0) remBuy = buys[++j]?.amount ?? 0
  }

  // En modo fijo, lo que no tuvo comprador en destino igual se compra en origen (si hay profundidad).
  let unboughtCost = 0
  let withoutDestinationBuyer = 0
  let unfilledInOrigin = 0
  if (fixed && qty < target) {
    const want = target - qty
    let have = 0
    while (have < want && i < sells.length) {
      const take = Math.min(remSell, want - have)
      unboughtCost += take * sells[i]!.unitPrice
      have += take
      remSell -= take
      if (remSell === 0) remSell = sells[++i]?.amount ?? 0
    }
    withoutDestinationBuyer = have
    unfilledInOrigin = want - have
    if (withoutDestinationBuyer > 0) warnings.push(`${withoutDestinationBuyer} unidades sin buy offers en el destino`)
    if (unfilledInOrigin > 0) warnings.push(`${unfilledInOrigin} unidades sin sell offers suficientes en el origen`)
  }

  const buyCost = sumGp([...lots.map((l) => mulGp(l.buyPrice, l.amount)), unboughtCost])
  const revenue = sumGp(lots.map((l) => mulGp(l.sellPrice, l.amount)))
  if (lots.length === 0 && !fixed) warnings.push('Sin unidades con ganancia inmediata')
  return {
    mode: fixed ? 'fixed' : 'max-profitable',
    requested: fixed ? target : null,
    quantity: qty + withoutDestinationBuyer,
    buyCost,
    revenue,
    grossProfit: revenue - buyCost,
    lots,
    unfilledInOrigin,
    withoutDestinationBuyer,
    originDepth: depth(sells),
    destinationDepth: depth(buys),
    warnings,
  }
}
