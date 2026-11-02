import { mulGp, type Gp } from '../money/gp'
import type { Opportunity } from '../arbitrage/opportunity'

// Cart Builder, primera versión: heurística greedy documentada. NO garantiza el óptimo global.
// Según el manual oficial, el banco, depot, stash e inbox viajan con el personaje, así que la capacidad
// y los slots no limitan la transferencia; se ofrecen como restricción opcional (p. ej. para cargar a mano).

export interface CartItemInfo {
  itemId: number
  weightOz: number | null
  stackSize: number | null
}

export interface CartConstraints {
  budgetGp: Gp
  transferCostGp: Gp | null
  minRoi: number
  minConfidenceScore: number
  maxQuantityPerItem: number | null
  capacityOz: number | null
  slots: number | null
}

export type CartOrdering = 'roi' | 'profit' | 'profit_per_oz'

export interface CartLine {
  itemId: number
  itemName: string
  strategy: 'instant' | 'historical'
  quantity: number
  buyCost: Gp
  expectedRevenue: Gp
  fees: Gp
  netProfit: Gp
  weightOz: number | null
  slots: number | null
}

export interface Cart {
  ordering: CartOrdering
  lines: CartLine[]
  buyCost: Gp
  expectedRevenue: Gp
  fees: Gp
  transferCost: Gp | null
  netProfit: Gp | null
  roi: number | null
  totalWeightOz: number | null
  totalSlots: number | null
  capacityApproximate: boolean
  heuristic: true
  warnings: string[]
}

interface Lot {
  opp: Opportunity
  strategy: 'instant' | 'historical'
  buyPrice: Gp
  /** Ingreso neto por unidad (después de comisión en Historical). */
  unitNetRevenue: number
  amount: number
}

function lotsFor(opp: Opportunity): Lot[] {
  if (opp.recommended === 'instant' && opp.instant) {
    return opp.instant.lots.filter((l) => l.unitProfit > 0).map((l) => ({ opp, strategy: 'instant' as const, buyPrice: l.buyPrice, unitNetRevenue: l.sellPrice, amount: l.amount }))
  }
  const base = opp.historical?.scenarios.find((s) => s.name === 'base')
  if (opp.recommended === 'historical' && base && opp.quantity > 0) {
    const unitNet = (base.revenue - base.postingFee) / opp.quantity
    const avgBuy = Math.ceil(opp.buyCost / opp.quantity)
    return [{ opp, strategy: 'historical', buyPrice: avgBuy, unitNetRevenue: unitNet, amount: opp.quantity }]
  }
  return []
}

export function buildCart(opps: readonly Opportunity[], info: ReadonlyMap<number, CartItemInfo>, c: CartConstraints, ordering: CartOrdering): Cart {
  const warnings: string[] = []
  const eligible = opps.filter((o) => (o.roiCommitted ?? -1) >= c.minRoi && o.scores.confidence >= c.minConfidenceScore)
  const lots = eligible.flatMap(lotsFor)
  const unitProfit = (l: Lot) => l.unitNetRevenue - l.buyPrice
  const sortKey: Record<CartOrdering, (l: Lot) => number> = {
    roi: (l) => unitProfit(l) / l.buyPrice,
    profit: (l) => unitProfit(l) * l.amount,
    profit_per_oz: (l) => {
      const w = info.get(l.opp.itemId)?.weightOz
      return w ? unitProfit(l) / w : unitProfit(l) / l.buyPrice
    },
  }
  lots.sort((a, b) => sortKey[ordering](b) - sortKey[ordering](a))

  let budget = c.budgetGp
  let capacity = c.capacityOz
  let slots = c.slots
  let capacityApproximate = false
  const taken = new Map<number, CartLine>()

  for (const lot of lots) {
    const meta = info.get(lot.opp.itemId)
    const line = taken.get(lot.opp.itemId)
    let qty = lot.amount
    if (c.maxQuantityPerItem !== null) qty = Math.min(qty, c.maxQuantityPerItem - (line?.quantity ?? 0))
    qty = Math.min(qty, Math.floor(budget / lot.buyPrice))
    if (capacity !== null) {
      if (meta?.weightOz == null) capacityApproximate = true
      else qty = Math.min(qty, Math.floor(capacity / meta.weightOz))
    }
    if (slots !== null) {
      if (meta?.stackSize == null) capacityApproximate = true
      else {
        const used = line?.slots ?? 0
        const maxUnits = (used + slots) * meta.stackSize - (line?.quantity ?? 0)
        qty = Math.min(qty, maxUnits)
      }
    }
    if (qty <= 0) continue

    const cost = mulGp(lot.buyPrice, qty)
    const revenue = Math.floor(lot.unitNetRevenue * qty)
    const next: CartLine = line ?? { itemId: lot.opp.itemId, itemName: lot.opp.itemName, strategy: lot.strategy, quantity: 0, buyCost: 0, expectedRevenue: 0, fees: 0, netProfit: 0, weightOz: 0, slots: 0 }
    next.quantity += qty
    next.buyCost += cost
    next.expectedRevenue += revenue
    next.netProfit = next.expectedRevenue - next.buyCost
    next.weightOz = meta?.weightOz != null ? meta.weightOz * next.quantity : null
    next.slots = meta?.stackSize != null ? Math.ceil(next.quantity / meta.stackSize) : null
    taken.set(lot.opp.itemId, next)

    budget -= cost
    if (capacity !== null && meta?.weightOz != null) capacity -= meta.weightOz * qty
    if (slots !== null && meta?.stackSize != null) slots = (c.slots ?? 0) - [...taken.values()].reduce((s, l) => s + (l.slots ?? 0), 0)
  }

  const lines = [...taken.values()]
  const buyCost = lines.reduce((s, l) => s + l.buyCost, 0)
  const expectedRevenue = lines.reduce((s, l) => s + l.expectedRevenue, 0)
  if (c.transferCostGp === null) warnings.push('Costo de transferencia desconocido: la ganancia neta no se puede calcular')
  const netProfit = c.transferCostGp === null ? null : expectedRevenue - buyCost - c.transferCostGp
  if (capacityApproximate) warnings.push('Hay items sin peso o stack confirmados: capacidad/slots aproximados')
  if (lines.some((l) => l.strategy === 'historical')) warnings.push('Incluye ventas históricas estimadas (no inmediatas)')
  const committed = buyCost + (c.transferCostGp ?? 0)
  return {
    ordering,
    lines,
    buyCost,
    expectedRevenue,
    fees: 0,
    transferCost: c.transferCostGp,
    netProfit,
    roi: netProfit === null || committed === 0 ? null : (netProfit / committed) * 100,
    totalWeightOz: lines.every((l) => l.weightOz !== null) ? lines.reduce((s, l) => s + (l.weightOz ?? 0), 0) : null,
    totalSlots: lines.every((l) => l.slots !== null) ? lines.reduce((s, l) => s + (l.slots ?? 0), 0) : null,
    capacityApproximate,
    heuristic: true,
    warnings,
  }
}

export function compareCarts(opps: readonly Opportunity[], info: ReadonlyMap<number, CartItemInfo>, c: CartConstraints): Cart[] {
  return (['roi', 'profit', 'profit_per_oz'] as const).map((o) => buildCart(opps, info, c, o))
}
