import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AnalysisRequest, AnalysisResult, RouteMatrixCell, RuleVersion, TcWorldQuote, TransferCostEstimate } from '@shared/api'
import type { DataSource } from '@shared/provenance'
import type { Settings } from '@shared/settings'
import transferRulesSeed from '@seed/transfer_rules.json'
import { analyzeItem, type ItemMarketData } from '@core/domain/arbitrage/opportunity'
import { instantArbitrage } from '@core/domain/arbitrage/instant'
import { compareCarts, type Cart, type CartConstraints, type CartItemInfo } from '@core/domain/cart/greedy'
import type { MarketFeeRule } from '@core/domain/money/market-fee'
import { depth } from '@core/domain/market/order-book'
import { priceStats } from '@core/domain/pricing/stats'
import { gpToBuyTc, tcQuote } from '@core/domain/tc/tc'
import { characterChecklist, finalTransferStatus, type TransferProfile } from '@core/domain/transfers/checklist'
import { evaluateRoute, type ManualRouteRule, type RouteStatus, type TransferRuleSet } from '@core/domain/transfers/rules'
import { all, bool, get, nowIso, parseJson, run, tx, type Db } from '../db/database'
import type { AppContext } from '../context'
import { requireWorld, TIBIA_COINS_ID, worldTransferInfo, listWorlds } from './catalog'
import { bookSide, latestStats, sellObservations, topOfBook } from './market'

export const TRANSFER_RULES = transferRulesSeed as unknown as TransferRuleSet

// ---------- Reglas económicas versionadas ----------

interface RuleRow {
  id: number
  rule_key: string
  value_json: string
  source_url: string | null
  effective_from: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
}

const toRule = <T>(r: RuleRow): RuleVersion<T> => ({
  id: r.id,
  key: r.rule_key,
  value: JSON.parse(r.value_json) as T,
  sourceUrl: r.source_url,
  effectiveFrom: r.effective_from,
  verifiedAt: r.verified_at,
  notes: r.notes,
  createdAt: r.created_at,
})

export function currentRule<T>(db: Db, key: string): RuleVersion<T> {
  const r = get<RuleRow>(db, 'SELECT * FROM economic_rule_versions WHERE rule_key = ? ORDER BY id DESC LIMIT 1', [key])
  if (!r) throw new Error(`Regla ${key} no configurada`)
  return toRule<T>(r)
}

export function ruleHistory(db: Db, key: string): RuleVersion[] {
  return all<RuleRow>(db, 'SELECT * FROM economic_rule_versions WHERE rule_key = ? ORDER BY id DESC', [key]).map((r) => toRule(r))
}

export function addRule(db: Db, key: string, value: unknown, sourceUrl: string | null, notes: string | null, verifiedAt: string | null): RuleVersion {
  const r = run(db, 'INSERT INTO economic_rule_versions (rule_key, value_json, source_url, effective_from, verified_at, notes, created_at) VALUES (?,?,?,?,?,?,?)', [
    key,
    JSON.stringify(value),
    sourceUrl,
    nowIso(),
    verifiedAt,
    notes,
    nowIso(),
  ])
  return toRule(get<RuleRow>(db, 'SELECT * FROM economic_rule_versions WHERE id = ?', [Number(r.lastInsertRowid)])!)
}

export function rulesBundle(db: Db) {
  return {
    marketFee: currentRule<MarketFeeRule>(db, 'market_fee'),
    offerDurationDays: currentRule<number>(db, 'offer_duration_days'),
    transferCostTc: currentRule<{ regular: number | null; express: number | null }>(db, 'transfer_cost_tc'),
    transferRules: TRANSFER_RULES,
  }
}

// ---------- Rutas y costo de transferencia ----------

function manualRule(db: Db, originId: number, destId: number): ManualRouteRule | null {
  const r = get<{ status: RouteStatus; reason: string; source_url: string | null; verified_at: string; valid_until: string | null }>(
    db,
    'SELECT status, reason, source_url, verified_at, valid_until FROM transfer_rules WHERE origin_world_id = ? AND destination_world_id = ? ORDER BY verified_at DESC LIMIT 1',
    [originId, destId],
  )
  return r ? { status: r.status, reason: r.reason, sourceUrl: r.source_url, verifiedAt: r.verified_at, validUntil: r.valid_until } : null
}

export function routeEvaluation(ctx: AppContext, origin: string, destination: string) {
  const o = requireWorld(ctx.db, origin)
  const d = requireWorld(ctx.db, destination)
  return evaluateRoute(worldTransferInfo(o), worldTransferInfo(d), TRANSFER_RULES, ctx.now(), manualRule(ctx.db, o.id, d.id))
}

/** Costo de la transferencia en GP: TC necesarios comprados en el Market del ORIGEN (sell offers). */
export function transferCost(ctx: AppContext, origin: string, type: 'regular' | 'express', includeThirdParty: boolean): TransferCostEstimate {
  const rule = currentRule<{ regular: number | null; express: number | null }>(ctx.db, 'transfer_cost_tc')
  const tc = rule.value[type]
  const warnings: string[] = []
  if (tc === null) {
    warnings.push('Precio de la transferencia en TC sin configurar (Ajustes → Reglas)')
    return { tc: null, type, gp: null, method: 'sin datos', observedAt: null, warnings }
  }
  if (!rule.verifiedAt) warnings.push('Precio de transferencia sin fecha de verificación')
  const world = requireWorld(ctx.db, origin)
  const tcItem = get<{ id: number }>(ctx.db, 'SELECT id FROM items WHERE tibia_item_id = ?', [TIBIA_COINS_ID])
  const book = tcItem ? bookSide(ctx.db, world.id, tcItem.id, 'sell', includeThirdParty) : null
  if (!book || book.levels.length === 0) {
    warnings.push(`Sin sell offers de Tibia Coins en ${origin}: no se puede convertir a GP`)
    return { tc, type, gp: null, method: 'sin cotización de TC', observedAt: null, warnings }
  }
  const walk = gpToBuyTc(book.levels, tc)
  if (walk.unfilled > 0) warnings.push(`Solo hay ${walk.filled} TC en venta en ${origin}`)
  if (book.evidence.source === 'third_party') warnings.push('Cotización de TC de terceros')
  warnings.push('Supone pagar con TC comprados en el Market; verifica que sean elegibles para la Store')
  return { tc, type, gp: walk.unfilled > 0 ? null : walk.total, method: `comprar ${tc} TC en el Market de ${origin}`, observedAt: book.evidence.observedAt, warnings }
}

// ---------- Análisis ----------

function itemIdsWithBooks(db: Db, worldId: number, includeThirdParty: boolean): number[] {
  return all<{ item_id: number }>(
    db,
    `SELECT DISTINCT item_id FROM market_scans WHERE world_id = ? AND review_status = 'accepted' AND scan_type <> 'details' ${includeThirdParty ? '' : `AND source <> 'third_party'`}`,
    [worldId],
  ).map((r) => r.item_id)
}

function itemMarketData(db: Db, itemId: number, originId: number, destId: number, req: AnalysisRequest, now: Date): ItemMarketData {
  const name = get<{ name: string }>(db, 'SELECT name FROM items WHERE id = ?', [itemId])?.name ?? `#${itemId}`
  const obs = sellObservations(db, destId, itemId, 30, req.includeThirdParty)
  const stats = priceStats(obs.rows.map((r) => ({ price: r.unit_price_gp, amount: r.amount, observedAt: r.observed_at_utc })))
  const official = latestStats(db, destId, itemId, req.includeThirdParty).find((s) => s.side === 'sell' && s.window === '30d') ?? null
  const inferred = get<{ q: number | null; first: string | null }>(
    db,
    `SELECT SUM(quantity) AS q, MIN(detected_at_utc) AS first FROM market_events WHERE world_id = ? AND item_id = ? AND offer_type = 'sell' AND event_type = 'possibly_filled' AND detected_at_utc >= ?`,
    [destId, itemId, new Date(now.getTime() - 30 * 86_400_000).toISOString()],
  )
  const lastSource = obs.rows.find((r) => r.observed_at_utc === obs.lastObservedAt)?.source
  return {
    itemId,
    itemName: name,
    originSell: bookSide(db, originId, itemId, 'sell', req.includeThirdParty, req.maxAgeHours),
    destBuy: bookSide(db, destId, itemId, 'buy', req.includeThirdParty, req.maxAgeHours),
    destSellHistory: {
      prices: obs.rows.map((r) => r.unit_price_gp),
      snapshots: obs.snapshots,
      days: obs.daysCovered,
      lastObservedAt: obs.lastObservedAt,
      cv: stats.cv,
      evidence: obs.lastObservedAt ? { scanId: null, observedAt: obs.lastObservedAt, source: (lastSource ?? 'own_capture') as 'own_capture', confidence: null } : null,
    },
    destOfficial: official?.transactions != null ? { transactions: official.transactions, windowDays: 30, source: official.source === 'third_party' ? 'third_party' : 'own_capture', observedAt: official.observedAt } : null,
    destInferred: inferred?.q ? { possiblyFilledQuantity: inferred.q, observedDays: Math.max(1, (now.getTime() - new Date(inferred.first!).getTime()) / 86_400_000) } : null,
  }
}

export function runAnalysis(ctx: AppContext, req: AnalysisRequest, settings: Settings): AnalysisResult {
  const now = ctx.now()
  const origin = requireWorld(ctx.db, req.origin)
  const dest = requireWorld(ctx.db, req.destination)
  const feeRule = currentRule<MarketFeeRule>(ctx.db, 'market_fee').value
  const originItems = new Set(itemIdsWithBooks(ctx.db, origin.id, req.includeThirdParty))
  const candidates = itemIdsWithBooks(ctx.db, dest.id, req.includeThirdParty).filter((id) => originItems.has(id))

  const params = {
    strategy: req.strategy,
    feeRule,
    minSnapshots: settings.analysis.minSnapshots,
    maxQuantityPerItem: req.maxQuantityPerItem ?? settings.analysis.maxQuantityPerItem ?? undefined,
    budgetGp: req.budgetGp ?? undefined,
    staleAfterHours: settings.analysis.staleAfterHours,
    historicalHaircut: settings.analysis.historicalHaircut,
    weights: settings.analysis.weights,
    scoreParams: settings.analysis.scoreParams,
  }
  const opportunities = candidates
    .map((id) => analyzeItem(itemMarketData(ctx.db, id, origin.id, dest.id, req, now), params, now))
    .filter((o): o is NonNullable<typeof o> => o !== null)
    .sort((a, b) => b.netProfit - a.netProfit)

  const route = routeEvaluation(ctx, origin.name, dest.name)
  const cost = transferCost(ctx, origin.name, 'regular', req.includeThirdParty)
  const warnings: string[] = []
  if (route.status !== 'allowed') warnings.push(route.status === 'blocked' ? 'La ruta de transferencia está bloqueada' : 'La ruta de transferencia no está verificada')
  if (!feeRule.basisVerified) warnings.push('La base de la comisión del Market no está verificada')
  if (candidates.length === 0) warnings.push('No hay items con order book en ambos mundos')

  const result: AnalysisResult = {
    runId: randomUUID(),
    origin: origin.name,
    destination: dest.name,
    strategy: req.strategy,
    startedAt: now.toISOString(),
    itemsConsidered: candidates.length,
    opportunities,
    route,
    transferCost: cost,
    feeRule,
    warnings,
  }
  tx(ctx.db, () => {
    run(ctx.db, `INSERT INTO arbitrage_runs (id, origin_world_id, destination_world_id, strategy, parameters_json, result_json, started_at, completed_at, status) VALUES (?,?,?,?,?,?,?,?, 'completed')`, [
      result.runId,
      origin.id,
      dest.id,
      req.strategy,
      JSON.stringify(req),
      JSON.stringify(result),
      result.startedAt,
      nowIso(),
    ])
    for (const o of opportunities) {
      run(
        ctx.db,
        `INSERT INTO arbitrage_opportunities (run_id, item_id, strategy, quantity, buy_cost_gp, gross_revenue_gp, market_fees_gp, transfer_cost_gp, other_costs_gp, net_profit_gp, roi_percent, liquidity_score, confidence_score, warnings_json, evidence_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [result.runId, o.itemId, o.recommended === 'none' ? o.strategy : o.recommended, o.quantity, o.buyCost, o.grossRevenue, o.marketFees, o.transferCost, o.otherCosts, o.netProfit, o.roiCommitted, o.liquidity.score, o.scores.confidence, JSON.stringify(o.warnings), JSON.stringify(o.evidence)],
      )
    }
  })
  return result
}

export function getRun(db: Db, id: string): AnalysisResult | null {
  const r = get<{ result_json: string | null }>(db, 'SELECT result_json FROM arbitrage_runs WHERE id = ?', [id])
  return r?.result_json ? (JSON.parse(r.result_json) as AnalysisResult) : null
}

export function listRuns(db: Db, limit: number) {
  return all<{ id: string; origin: string; destination: string; strategy: string; started_at: string; opportunities: number }>(
    db,
    `SELECT r.id, o.name AS origin, d.name AS destination, r.strategy, r.started_at, (SELECT COUNT(*) FROM arbitrage_opportunities x WHERE x.run_id = r.id) AS opportunities
     FROM arbitrage_runs r JOIN worlds o ON o.id = r.origin_world_id JOIN worlds d ON d.id = r.destination_world_id ORDER BY r.started_at DESC LIMIT ?`,
    [limit],
  ).map((r) => ({ id: r.id, origin: r.origin, destination: r.destination, strategy: r.strategy, startedAt: r.started_at, opportunities: r.opportunities }))
}

/** Matriz de rutas entre mundos con datos: estado de transferencia + mejor Instant por ruta. */
export function routeMatrix(ctx: AppContext, includeThirdParty: boolean, maxAgeHours: number | null): RouteMatrixCell[] {
  const worldsWithData = all<{ world_id: number; name: string }>(
    ctx.db,
    `SELECT DISTINCT s.world_id, w.name FROM market_scans s JOIN worlds w ON w.id = s.world_id WHERE s.review_status = 'accepted' AND s.scan_type <> 'details' ${includeThirdParty ? '' : `AND s.source <> 'third_party'`} ORDER BY w.name`,
  )
  const items = new Map(worldsWithData.map((w) => [w.world_id, new Set(itemIdsWithBooks(ctx.db, w.world_id, includeThirdParty))]))
  const cells: RouteMatrixCell[] = []
  for (const o of worldsWithData) {
    for (const d of worldsWithData) {
      if (o.world_id === d.world_id) continue
      const common = [...items.get(o.world_id)!].filter((id) => items.get(d.world_id)!.has(id))
      let best: number | null = null
      let count = 0
      for (const id of common) {
        const sell = bookSide(ctx.db, o.world_id, id, 'sell', includeThirdParty, maxAgeHours)
        const buy = bookSide(ctx.db, d.world_id, id, 'buy', includeThirdParty, maxAgeHours)
        if (!sell || !buy) continue
        const r = instantArbitrage(sell.levels, buy.levels)
        if (r.grossProfit > 0) {
          count++
          best = Math.max(best ?? 0, r.grossProfit)
        }
      }
      cells.push({ origin: o.name, destination: d.name, status: routeEvaluation(ctx, o.name, d.name).status, commonItems: common.length, bestInstantProfit: best, opportunities: count })
    }
  }
  return cells
}

// ---------- Tibia Coins ----------

export function tcQuotes(ctx: AppContext, includeThirdParty: boolean): TcWorldQuote[] {
  const tcItem = get<{ id: number }>(ctx.db, 'SELECT id FROM items WHERE tibia_item_id = ?', [TIBIA_COINS_ID])
  if (!tcItem) return []
  const out: TcWorldQuote[] = []
  for (const w of listWorlds(ctx.db, false)) {
    const buy = bookSide(ctx.db, w.id, tcItem.id, 'buy', includeThirdParty)
    const sell = bookSide(ctx.db, w.id, tcItem.id, 'sell', includeThirdParty)
    if (buy || sell) {
      const q = tcQuote(buy?.levels ?? [], sell?.levels ?? [])
      const ev = [buy?.evidence, sell?.evidence].filter(Boolean).sort((a, b) => b!.observedAt.localeCompare(a!.observedAt))[0]
      out.push({ world: w.name, ...q, observedAt: ev?.observedAt ?? null, source: (ev?.source as DataSource) ?? null, buyDepth: depth(buy?.levels ?? []), sellDepth: depth(sell?.levels ?? []) })
      continue
    }
    const top = topOfBook(ctx.db, w.id, includeThirdParty).get(tcItem.id)
    if (top) {
      const spread = top.bestBuy !== null && top.bestSell !== null ? top.bestSell - top.bestBuy : null
      out.push({ world: w.name, bestBuyOffer: top.bestBuy, bestSellOffer: top.bestSell, spread, spreadPct: spread !== null && top.bestBuy ? (spread / top.bestBuy) * 100 : null, observedAt: top.observedAt, source: top.source, buyDepth: 0, sellDepth: 0 })
    }
  }
  return out.sort((a, b) => (a.bestSellOffer ?? Infinity) - (b.bestSellOffer ?? Infinity))
}

export function tcHistory(ctx: AppContext, world: string, days: number, includeThirdParty: boolean) {
  const w = requireWorld(ctx.db, world)
  const since = new Date(ctx.now().getTime() - days * 86_400_000).toISOString()
  const fromRates = all<{ captured_at_utc: string; buy_price_gp: number | null; sell_price_gp: number | null; source: DataSource }>(
    ctx.db,
    `SELECT captured_at_utc, buy_price_gp, sell_price_gp, source FROM tc_rates WHERE world_id = ? AND captured_at_utc >= ? ${includeThirdParty ? '' : `AND source <> 'third_party'`}`,
    [w.id, since],
  ).map((r) => ({ observedAt: r.captured_at_utc, bestBuy: r.buy_price_gp, bestSell: r.sell_price_gp, source: r.source }))
  const tcItem = get<{ id: number }>(ctx.db, 'SELECT id FROM items WHERE tibia_item_id = ?', [TIBIA_COINS_ID])
  const fromQuotes = tcItem && includeThirdParty
    ? all<{ observed_at_utc: string; best_buy_gp: number | null; best_sell_gp: number | null; source: DataSource }>(
        ctx.db,
        'SELECT observed_at_utc, best_buy_gp, best_sell_gp, source FROM market_quotes WHERE world_id = ? AND item_id = ? AND observed_at_utc >= ?',
        [w.id, tcItem.id, since],
      ).map((r) => ({ observedAt: r.observed_at_utc, bestBuy: r.best_buy_gp, bestSell: r.best_sell_gp, source: r.source }))
    : []
  return [...fromRates, ...fromQuotes].sort((a, b) => a.observedAt.localeCompare(b.observedAt))
}

// ---------- Transferencias: perfiles y reglas manuales ----------

interface ProfileRow {
  id: number
  name: string
  current_world: string | null
  last_transfer_at: string | null
  has_skull_restriction: number | null
  is_guild_leader: number | null
  owns_house: number | null
  has_relevant_open_offers: number | null
  is_on_main_continent: number | null
  visited_calva: number | null
  transfer_type: 'regular' | 'express'
  available_eligible_tc: number | null
}

export function listTransferProfiles(db: Db): (TransferProfile & { id: number })[] {
  return all<ProfileRow>(db, 'SELECT p.*, w.name AS current_world FROM transfer_profiles p LEFT JOIN worlds w ON w.id = p.current_world_id ORDER BY p.name').map((r) => ({
    id: r.id,
    name: r.name,
    currentWorld: r.current_world,
    lastTransferAt: r.last_transfer_at,
    hasRedOrBlackSkull: bool(r.has_skull_restriction),
    isGuildLeader: bool(r.is_guild_leader),
    ownsHouse: bool(r.owns_house),
    hasOpenTcMarketOffers: bool(r.has_relevant_open_offers),
    isOnMainContinent: bool(r.is_on_main_continent),
    visitedCalvaOrCalvera: bool(r.visited_calva),
    transferType: r.transfer_type,
    availableEligibleTc: r.available_eligible_tc,
  }))
}

export function saveTransferProfile(db: Db, p: TransferProfile & { id: number | null }): TransferProfile & { id: number } {
  const worldId = p.currentWorld ? requireWorld(db, p.currentWorld).id : null
  const values = [p.name, worldId, p.lastTransferAt, p.hasRedOrBlackSkull, p.isGuildLeader, p.ownsHouse, p.hasOpenTcMarketOffers, p.isOnMainContinent, p.visitedCalvaOrCalvera, p.transferType, p.availableEligibleTc, nowIso()]
  let id = p.id
  if (id === null) {
    id = Number(
      run(
        db,
        `INSERT INTO transfer_profiles (name, current_world_id, last_transfer_at, has_skull_restriction, is_guild_leader, owns_house, has_relevant_open_offers, is_on_main_continent, visited_calva, transfer_type, available_eligible_tc, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        values,
      ).lastInsertRowid,
    )
  } else {
    run(
      db,
      `UPDATE transfer_profiles SET name=?, current_world_id=?, last_transfer_at=?, has_skull_restriction=?, is_guild_leader=?, owns_house=?, has_relevant_open_offers=?, is_on_main_continent=?, visited_calva=?, transfer_type=?, available_eligible_tc=?, updated_at=? WHERE id = ?`,
      [...values, id],
    )
  }
  return listTransferProfiles(db).find((x) => x.id === id)!
}

export function evaluateTransfer(ctx: AppContext, origin: string, destination: string, profileId: number | null) {
  const route = routeEvaluation(ctx, origin, destination)
  const profile = profileId === null ? null : listTransferProfiles(ctx.db).find((p) => p.id === profileId) ?? null
  const o = worldTransferInfo(requireWorld(ctx.db, origin))
  const d = worldTransferInfo(requireWorld(ctx.db, destination))
  const checklist = profile
    ? characterChecklist(profile, o, d, ctx.now())
    : [{ key: 'profile', label: 'Perfil del personaje', result: 'unknown' as const, detail: 'Crea o elige un perfil para validar los requisitos personales' }]
  const cost = transferCost(ctx, origin, profile?.transferType ?? 'regular', true)
  return { route, checklist, final: finalTransferStatus(route, checklist), cost }
}

export function listManualRules(db: Db) {
  return all<{ id: number; origin: string; destination: string; status: RouteStatus; reason: string; source_url: string | null; verified_at: string; valid_until: string | null }>(
    db,
    'SELECT r.id, o.name AS origin, d.name AS destination, r.status, r.reason, r.source_url, r.verified_at, r.valid_until FROM transfer_rules r JOIN worlds o ON o.id = r.origin_world_id JOIN worlds d ON d.id = r.destination_world_id ORDER BY r.verified_at DESC',
  ).map((r) => ({ id: r.id, origin: r.origin, destination: r.destination, status: r.status, reason: r.reason, sourceUrl: r.source_url, verifiedAt: r.verified_at, validUntil: r.valid_until }))
}

export function saveManualRule(db: Db, r: { origin: string; destination: string; status: RouteStatus; reason: string; sourceUrl: string | null; validUntil: string | null }): void {
  run(db, 'INSERT INTO transfer_rules (origin_world_id, destination_world_id, status, reason, source_url, verified_at, valid_until) VALUES (?,?,?,?,?,?,?)', [
    requireWorld(db, r.origin).id,
    requireWorld(db, r.destination).id,
    r.status,
    r.reason,
    r.sourceUrl,
    nowIso(),
    r.validUntil,
  ])
}

// ---------- Carritos ----------

export function buildCarts(ctx: AppContext, runId: string, constraints: CartConstraints): Cart[] {
  const result = getRun(ctx.db, runId)
  if (!result) throw new Error('Análisis no encontrado')
  const ids = result.opportunities.map((o) => o.itemId)
  const info = new Map<number, CartItemInfo>(
    ids.length
      ? all<{ id: number; weight_oz: number | null; stack_size: number | null }>(ctx.db, `SELECT id, weight_oz, stack_size FROM items WHERE id IN (${ids.map(() => '?').join(',')})`, ids).map((r) => [
          r.id,
          { itemId: r.id, weightOz: r.weight_oz, stackSize: r.stack_size },
        ])
      : [],
  )
  return compareCarts(result.opportunities, info, constraints)
}

export function saveCart(db: Db, name: string, runId: string, cart: Cart, constraints: CartConstraints): string {
  const id = randomUUID()
  tx(db, () => {
    run(db, 'INSERT INTO saved_carts (id, name, run_id, constraints_json, summary_json, created_at) VALUES (?,?,?,?,?,?)', [id, name, runId, JSON.stringify(constraints), JSON.stringify(cart), nowIso()])
    for (const l of cart.lines) {
      run(db, 'INSERT INTO saved_cart_items (cart_id, item_id, quantity, buy_cost_gp, expected_revenue_gp, estimated_weight, estimated_slots) VALUES (?,?,?,?,?,?,?)', [id, l.itemId, l.quantity, l.buyCost, l.expectedRevenue, l.weightOz, l.slots])
    }
  })
  return id
}

export function listCarts(db: Db) {
  return all<{ id: string; name: string; run_id: string | null; created_at: string; summary_json: string }>(db, 'SELECT * FROM saved_carts ORDER BY created_at DESC').map((r) => {
    const cart = parseJson<Cart | null>(r.summary_json, null)
    return { id: r.id, name: r.name, runId: r.run_id, createdAt: r.created_at, netProfit: cart?.netProfit ?? null, lines: cart?.lines.length ?? 0 }
  })
}

export function getCart(db: Db, id: string) {
  const r = get<{ id: string; name: string; run_id: string | null; created_at: string; summary_json: string; constraints_json: string }>(db, 'SELECT * FROM saved_carts WHERE id = ?', [id])
  if (!r) return null
  const cart = JSON.parse(r.summary_json) as Cart
  return { summary: { id: r.id, name: r.name, runId: r.run_id, createdAt: r.created_at, netProfit: cart.netProfit, lines: cart.lines.length }, cart, constraints: JSON.parse(r.constraints_json) as CartConstraints }
}

// ---------- Exportación ----------

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0]!)
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
}

export function exportRun(ctx: AppContext, runId: string, format: 'csv' | 'json'): string {
  const result = getRun(ctx.db, runId)
  if (!result) throw new Error('Análisis no encontrado')
  const stamp = result.startedAt.replace(/[:.]/g, '-')
  const file = join(ctx.paths.exports, `analisis-${result.origin}-${result.destination}-${stamp}.${format}`)
  if (format === 'json') {
    writeFileSync(file, JSON.stringify({ schemaVersion: get<{ user_version: number }>(ctx.db, 'PRAGMA user_version')?.user_version, exportedAt: nowIso(), ...result }, null, 2), 'utf8')
  } else {
    writeFileSync(
      file,
      toCsv(
        result.opportunities.map((o) => ({
          item: o.itemName,
          estrategia: o.recommended,
          cantidad: o.quantity,
          costo_compra_gp: o.buyCost,
          ingreso_bruto_gp: o.grossRevenue,
          comisiones_gp: o.marketFees,
          ganancia_neta_gp: o.netProfit,
          roi_comprometido_pct: o.roiCommitted?.toFixed(2),
          roi_compra_pct: o.roiPurchase?.toFixed(2),
          liquidez: o.liquidity.score,
          confianza: Math.round(o.scores.confidence),
          score: o.scores.total,
          fuentes: [...new Set(o.evidence.map((e) => e.source))].join('|'),
          observado: o.evidence.map((e) => e.observedAt).sort()[0],
          advertencias: o.warnings.join(' | '),
        })),
      ),
      'utf8',
    )
  }
  return file
}

export function exportCart(ctx: AppContext, id: string, format: 'csv' | 'json'): string {
  const c = getCart(ctx.db, id)
  if (!c) throw new Error('Carrito no encontrado')
  const file = join(ctx.paths.exports, `carrito-${c.summary.name.replace(/[^\w-]+/g, '_')}-${c.summary.createdAt.replace(/[:.]/g, '-')}.${format}`)
  if (format === 'json') writeFileSync(file, JSON.stringify({ exportedAt: nowIso(), ...c }, null, 2), 'utf8')
  else writeFileSync(file, toCsv(c.cart.lines.map((l) => ({ item: l.itemName, estrategia: l.strategy, cantidad: l.quantity, costo_gp: l.buyCost, ingreso_esperado_gp: l.expectedRevenue, ganancia_gp: l.netProfit, peso_oz: l.weightOz, slots: l.slots }))), 'utf8')
  return file
}
