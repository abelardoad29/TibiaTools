import { describe, expect, it } from 'vitest'
import { applyBps, divRound, formatGpShort, mulGp, parseGp } from '@core/domain/money/gp'
import { postingFee, type MarketFeeRule } from '@core/domain/money/market-fee'
import { sortLevels, walkBook, type BookSide } from '@core/domain/market/order-book'
import { diffSnapshots } from '@core/domain/market/snapshot-diff'
import { percentile, priceStats } from '@core/domain/pricing/stats'
import { instantArbitrage } from '@core/domain/arbitrage/instant'
import { historicalArbitrage } from '@core/domain/arbitrage/historical'
import { analyzeItem, rankOpportunities, type AnalysisParams } from '@core/domain/arbitrage/opportunity'
import { DEFAULT_SCORE_PARAMS, DEFAULT_WEIGHTS } from '@core/domain/arbitrage/scoring'
import { gpToBuyTc, tcQuote } from '@core/domain/tc/tc'
import { buildCart, compareCarts } from '@core/domain/cart/greedy'
import { estimateLiquidity } from '@core/domain/liquidity/liquidity'

const FEE: MarketFeeRule = { rateBps: 250, minGp: 20, maxGp: 2_500_000, basis: 'total', rounding: 'ceil', basisVerified: false, roundingVerified: false }
const NOW = new Date('2026-11-02T12:00:00Z')
const ev = (source: 'own_capture' | 'third_party' = 'own_capture', observedAt = '2026-11-02T11:00:00Z') => ({ scanId: 's', observedAt, source, confidence: source === 'own_capture' ? 0.99 : null })

describe('dinero', () => {
  it('parsea formatos del juego sin floats', () => {
    expect(parseGp('1,234,567')).toBe(1_234_567)
    expect(parseGp('15k')).toBe(15_000)
    expect(parseGp('1.5kk')).toBe(1_500_000)
    expect(parseGp('2.25kk')).toBe(2_250_000)
    expect(parseGp('-12,345')).toBe(-12_345)
    expect(parseGp('1.5')).toBeNull()
    expect(parseGp('12,34')).toBeNull()
    expect(parseGp('abc')).toBeNull()
  })
  it('redondea explícitamente', () => {
    expect(divRound(7, 2, 'floor')).toBe(3)
    expect(divRound(7, 2, 'ceil')).toBe(4)
    expect(divRound(7, 2, 'round')).toBe(4)
    expect(applyBps(1_001, 250, 'ceil')).toBe(26) // 25.025 → 26
    expect(formatGpShort(1_550_000)).toBe('1.5kk')
    expect(formatGpShort(999)).toBe('999')
  })
  it('lanza fuera del rango de enteros seguros', () => {
    expect(() => mulGp(2 ** 40, 2 ** 20)).toThrow()
  })
})

describe('comisión de Market (solo al publicar)', () => {
  it('2.5 % con mínimo y máximo', () => {
    expect(postingFee(FEE, 100, 1).fee).toBe(20) // 2.5 → mínimo 20
    expect(postingFee(FEE, 10_000, 10).fee).toBe(2_500)
    expect(postingFee(FEE, 1_000_000_000, 10).fee).toBe(2_500_000) // tope
    expect(postingFee(FEE, 1_001, 1).fee).toBe(26) // 25.025 redondeado hacia arriba, sobre el mínimo
  })
  it('base unitaria configurable y advertencias si no está verificada', () => {
    const r = postingFee({ ...FEE, basis: 'unit' }, 10_000, 10)
    expect(r.fee).toBe(250)
    expect(r.warnings).toHaveLength(2)
    expect(postingFee({ ...FEE, basisVerified: true, roundingVerified: true }, 1, 1).warnings).toEqual([])
  })
})

describe('order book', () => {
  it('ordena por lado y descarta niveles vacíos', () => {
    const lv = [{ unitPrice: 30, amount: 1 }, { unitPrice: 10, amount: 0 }, { unitPrice: 20, amount: 2 }]
    expect(sortLevels('sell', lv).map((l) => l.unitPrice)).toEqual([20, 30])
    expect(sortLevels('buy', lv).map((l) => l.unitPrice)).toEqual([30, 20])
  })
  it('compra escalonada: no extrapola el mejor precio', () => {
    const r = walkBook(sortLevels('sell', [{ unitPrice: 100, amount: 3 }, { unitPrice: 150, amount: 5 }]), 6)
    expect(r.total).toBe(3 * 100 + 3 * 150)
    expect(r.unfilled).toBe(0)
    expect(r.worstPrice).toBe(150)
  })
  it('devuelve la cantidad no cubierta', () => {
    const r = walkBook([{ unitPrice: 100, amount: 3 }], 10)
    expect(r.filled).toBe(3)
    expect(r.unfilled).toBe(7)
  })
})

describe('Instant', () => {
  const sell = [{ unitPrice: 1_000, amount: 10 }, { unitPrice: 1_200, amount: 10 }, { unitPrice: 2_000, amount: 50 }]
  const buy = [{ unitPrice: 1_500, amount: 5 }, { unitPrice: 1_300, amount: 8 }, { unitPrice: 900, amount: 100 }]

  it('ganancia: toma solo unidades con margen positivo, nivel por nivel', () => {
    const r = instantArbitrage(sell, buy)
    // 5u 1000→1500, 5u 1000→1300, 3u 1200→1300; luego 1200 vs 900 deja de convenir
    expect(r.lots).toEqual([
      { buyPrice: 1_000, sellPrice: 1_500, amount: 5, unitProfit: 500 },
      { buyPrice: 1_000, sellPrice: 1_300, amount: 5, unitProfit: 300 },
      { buyPrice: 1_200, sellPrice: 1_300, amount: 3, unitProfit: 100 },
    ])
    expect(r.quantity).toBe(13)
    expect(r.buyCost).toBe(10_000 + 3_600)
    expect(r.revenue).toBe(7_500 + 6_500 + 3_900)
    expect(r.grossProfit).toBe(4_300)
  })
  it('pérdida: cantidad fija mayor que la contraparte muestra unidades sin comprador', () => {
    const r = instantArbitrage(sell, [{ unitPrice: 1_100, amount: 4 }], { quantity: 6 })
    expect(r.withoutDestinationBuyer).toBe(2)
    expect(r.buyCost).toBe(6 * 1_000)
    expect(r.revenue).toBe(4 * 1_100)
    expect(r.grossProfit).toBe(4_400 - 6_000)
    expect(r.warnings[0]).toMatch(/sin buy offers/)
  })
  it('cantidad parcial: sin profundidad en origen', () => {
    const r = instantArbitrage([{ unitPrice: 10, amount: 2 }], [{ unitPrice: 50, amount: 10 }], { quantity: 5 })
    expect(r.unfilledInOrigin).toBe(3)
    expect(r.quantity).toBe(2)
  })
  it('respeta el presupuesto', () => {
    const r = instantArbitrage(sell, buy, { budgetGp: 5_500 })
    expect(r.quantity).toBe(5)
    expect(r.buyCost).toBe(5_000)
  })
  it('sin datos de destino no hay ganancia', () => {
    const r = instantArbitrage(sell, [])
    expect(r.quantity).toBe(0)
    expect(r.warnings).toContain('Sin unidades con ganancia inmediata')
  })
})

describe('Historical', () => {
  const prices = [1_400, 1_500, 1_500, 1_600, 1_700, 1_800, 2_000]
  it('P25/P50/P75 con comisión de publicación', () => {
    const r = historicalArbitrage({ originSell: [{ unitPrice: 1_000, amount: 10 }], destSellPrices: prices, sample: { snapshots: 7, days: 7, lastObservedAt: '2026-11-02T10:00:00Z' }, officialSoldPerDay: 20, feeRule: FEE, minSnapshots: 5 })
    expect(r.status).toBe('ok')
    expect(r.quantity).toBe(10)
    expect(percentile([...prices].sort((a, b) => a - b), 0.5)).toBe(1_600)
    const base = r.scenarios.find((s) => s.name === 'base')!
    expect(base.targetPrice).toBe(1_600)
    expect(base.postingFee).toBe(400) // 2.5 % de 16,000
    expect(base.netProfit).toBe(16_000 - 10_000 - 400)
    expect(r.noSaleRisk).toBe('low')
  })
  it('bloquea con muestra insuficiente y marca experimental en el medio', () => {
    const blocked = historicalArbitrage({ originSell: [{ unitPrice: 1, amount: 1 }], destSellPrices: [5], sample: { snapshots: 1, days: 1, lastObservedAt: null }, officialSoldPerDay: null, feeRule: FEE, minSnapshots: 5 })
    expect(blocked.status).toBe('insufficient_sample')
    expect(blocked.scenarios).toEqual([])
    const exp = historicalArbitrage({ originSell: [{ unitPrice: 1_000, amount: 1 }], destSellPrices: prices, sample: { snapshots: 3, days: 2, lastObservedAt: null }, officialSoldPerDay: null, feeRule: FEE, minSnapshots: 5 })
    expect(exp.status).toBe('experimental')
    expect(exp.noSaleRisk).toBe('unknown')
  })
})

describe('opportunity + ranking', () => {
  const params: AnalysisParams = { strategy: 'hybrid', feeRule: FEE, minSnapshots: 3, staleAfterHours: 48, historicalHaircut: 0.5, weights: DEFAULT_WEIGHTS, scoreParams: DEFAULT_SCORE_PARAMS }
  const book = (side: 'buy' | 'sell', levels: { unitPrice: number; amount: number }[], source: 'own_capture' | 'third_party' = 'own_capture', at?: string): BookSide => ({ side, levels, evidence: ev(source, at) })
  const hist = { prices: [1_400, 1_500, 1_600], snapshots: 3, days: 3, lastObservedAt: '2026-11-02T10:00:00Z', cv: 0.1, evidence: ev() }

  it('Hybrid conserva ambos resultados y recomienda el mejor ajustado por riesgo', () => {
    const o = analyzeItem({ itemId: 1, itemName: 'X', originSell: book('sell', [{ unitPrice: 1_000, amount: 10 }]), destBuy: book('buy', [{ unitPrice: 1_100, amount: 10 }]), destSellHistory: hist, destOfficial: null, destInferred: null }, params, NOW)!
    expect(o.instant!.grossProfit).toBe(1_000)
    expect(o.historical!.scenarios.find((s) => s.name === 'base')!.netProfit).toBe(15_000 - 10_000 - 375)
    expect(o.recommended).toBe('historical') // 4625 × 0.5 > 1000
    expect(o.marketFees).toBe(375)
    expect(o.netProfit).toBe(4_625)
    expect(o.roiPurchase).toBeCloseTo(46.25)
  })
  it('advierte datos de terceros y viejos, y baja la confianza', () => {
    const own = analyzeItem({ itemId: 1, itemName: 'X', originSell: book('sell', [{ unitPrice: 1_000, amount: 10 }]), destBuy: book('buy', [{ unitPrice: 1_100, amount: 10 }]), destSellHistory: hist, destOfficial: null, destInferred: null }, { ...params, strategy: 'instant' }, NOW)!
    const tp = analyzeItem({ itemId: 1, itemName: 'X', originSell: book('sell', [{ unitPrice: 1_000, amount: 10 }], 'third_party', '2026-09-01T00:00:00Z'), destBuy: book('buy', [{ unitPrice: 1_100, amount: 10 }]), destSellHistory: hist, destOfficial: null, destInferred: null }, { ...params, strategy: 'instant' }, NOW)!
    expect(tp.warnings.some((w) => w.includes('terceros'))).toBe(true)
    expect(tp.warnings.some((w) => w.includes('antigüedad'))).toBe(true)
    expect(tp.scores.confidence).toBeLessThan(own.scores.confidence)
  })
  it('ranking excluye pérdidas', () => {
    const loss = analyzeItem({ itemId: 2, itemName: 'Y', originSell: book('sell', [{ unitPrice: 2_000, amount: 1 }]), destBuy: book('buy', [{ unitPrice: 1_000, amount: 1 }]), destSellHistory: { ...hist, prices: [] , snapshots: 0 }, destOfficial: null, destInferred: null }, { ...params, strategy: 'instant' }, NOW)
    expect(loss === null || rankOpportunities([loss], 'profit').length === 0).toBe(true)
  })
})

describe('eventos entre snapshots', () => {
  it('nunca produce ventas confirmadas', () => {
    const prev = [{ unitPrice: 100, amount: 10 }, { unitPrice: 120, amount: 5 }, { unitPrice: 150, amount: 2 }]
    const next = [{ unitPrice: 100, amount: 4 }, { unitPrice: 130, amount: 5 }, { unitPrice: 160, amount: 1 }]
    const evs = diffSnapshots('sell', prev, next, '2026-11-02T12:00:00Z')
    const types = evs.map((e) => e.type)
    expect(types).toContain('amount_reduced')
    expect(types).toContain('possibly_filled')
    expect(types).toContain('price_changed') // 120×5 → 130×5
    expect(types).toContain('possibly_removed') // 150 no era el mejor precio
    expect(types).toContain('first_seen') // 160
    expect(types.every((t) => !t.includes('sold'))).toBe(true)
  })
  it('marca vencidas como expired_unknown', () => {
    const evs = diffSnapshots('buy', [{ unitPrice: 100, amount: 1, expiresAt: '2026-11-01T00:00:00Z' }], [], '2026-11-02T00:00:00Z')
    expect(evs[0]!.type).toBe('expired_unknown')
  })
})

describe('estadísticas y liquidez', () => {
  it('percentiles y CV', () => {
    const s = priceStats([100, 200, 300, 400].map((p, i) => ({ price: p, amount: i + 1, observedAt: `2026-11-0${i + 1}T00:00:00Z` })))
    expect(s.median).toBe(250)
    expect(s.p25).toBe(175)
    expect(s.amountWeightedMean).toBe(300)
    expect(s.cv).toBeGreaterThan(0)
    expect(priceStats([]).median).toBeNull()
  })
  it('lo oficial manda; lo inferido pesa la mitad', () => {
    const off = estimateLiquidity({ transactions: 300, windowDays: 30, source: 'own_capture', observedAt: '' }, null)
    expect(off.officialTransactionsPerDay).toBe(10)
    expect(off.liquidityConfidence).toBe('official')
    const inf = estimateLiquidity(null, { possiblyFilledQuantity: 70, observedDays: 7 })
    expect(inf.liquidityConfidence).toBe('inferred')
    expect(inf.score).toBe(Math.round(off.score / 2))
  })
})

describe('Tibia Coins', () => {
  it('usa el lado correcto del mercado', () => {
    const buyOffers = [{ unitPrice: 42_821, amount: 25 }]
    const sellOffers = [{ unitPrice: 44_098, amount: 150 }, { unitPrice: 44_099, amount: 1_400 }]
    expect(tcQuote(buyOffers, sellOffers)).toMatchObject({ bestBuyOffer: 42_821, bestSellOffer: 44_098, spread: 1_277 })
    const cost = gpToBuyTc(sellOffers, 250)
    expect(cost.total).toBe(150 * 44_098 + 100 * 44_099)
  })
})

describe('Cart Builder (greedy)', () => {
  const params: AnalysisParams = { strategy: 'instant', feeRule: FEE, minSnapshots: 3, staleAfterHours: 48, historicalHaircut: 0.5, weights: DEFAULT_WEIGHTS, scoreParams: DEFAULT_SCORE_PARAMS }
  const mk = (id: number, buy: number, sell: number, qty: number) =>
    analyzeItem({ itemId: id, itemName: `I${id}`, originSell: { side: 'sell', levels: [{ unitPrice: buy, amount: qty }], evidence: ev() }, destBuy: { side: 'buy', levels: [{ unitPrice: sell, amount: qty }], evidence: ev() }, destSellHistory: { prices: [], snapshots: 0, days: 0, lastObservedAt: null, cv: null, evidence: null }, destOfficial: null, destInferred: null }, params, NOW)!
  const opps = [mk(1, 100, 200, 100), mk(2, 1_000, 1_300, 50)]
  const info = new Map([[1, { itemId: 1, weightOz: 1, stackSize: 100 }], [2, { itemId: 2, weightOz: null, stackSize: null }]])
  const base = { budgetGp: 30_000, transferCostGp: 5_000, minRoi: 0, minConfidenceScore: 0, maxQuantityPerItem: null, capacityOz: null, slots: null }

  it('respeta presupuesto con cantidades enteras y descuenta la transferencia una vez', () => {
    const cart = buildCart(opps, info, base, 'roi')
    expect(cart.lines[0]!.itemId).toBe(1) // ROI 100 % primero
    expect(cart.buyCost).toBeLessThanOrEqual(30_000)
    expect(cart.lines.every((l) => Number.isInteger(l.quantity))).toBe(true)
    expect(cart.netProfit).toBe(cart.expectedRevenue - cart.buyCost - 5_000)
    expect(cart.heuristic).toBe(true)
  })
  it('sin costo de transferencia no inventa ganancia neta', () => {
    expect(buildCart(opps, info, { ...base, transferCostGp: null }, 'roi').netProfit).toBeNull()
  })
  it('capacidad: marca aproximado si falta el peso', () => {
    const cart = buildCart(opps, info, { ...base, capacityOz: 50 }, 'profit')
    expect(cart.capacityApproximate).toBe(true)
    expect(cart.lines.find((l) => l.itemId === 1)?.quantity ?? 0).toBeLessThanOrEqual(50)
  })
  it('compara tres órdenes', () => {
    expect(compareCarts(opps, info, base).map((c) => c.ordering)).toEqual(['roi', 'profit', 'profit_per_oz'])
  })
})
