import type { AlertEventRow, AnalysisResult, StoredAlertRule } from '@shared/api'
import { evaluateAlerts, type AlertContext, type AlertRule } from '@core/domain/alerts/rules'
import { all, get, nowIso, run, tx, type Db } from '../db/database'
import type { AppContext } from '../context'
import { requireWorld } from './catalog'
import { bestSellPrice } from './market'
import { routeEvaluation, tcQuotes } from './analysis'

export function listAlertRules(db: Db): StoredAlertRule[] {
  return all<{ id: number; kind: AlertRule['kind']; params_json: string; enabled: number; created_at: string }>(db, 'SELECT * FROM alert_rules ORDER BY id').map((r) => ({
    rule: { id: r.id, kind: r.kind, params: JSON.parse(r.params_json) } as AlertRule,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }))
}

export function saveAlertRule(db: Db, rule: AlertRule, enabled: boolean): StoredAlertRule {
  let id = rule.id
  if (id > 0 && get(db, 'SELECT 1 FROM alert_rules WHERE id = ?', [id])) {
    run(db, 'UPDATE alert_rules SET kind = ?, params_json = ?, enabled = ? WHERE id = ?', [rule.kind, JSON.stringify(rule.params), enabled, id])
  } else {
    id = Number(run(db, 'INSERT INTO alert_rules (kind, params_json, enabled, created_at) VALUES (?,?,?,?)', [rule.kind, JSON.stringify(rule.params), enabled, nowIso()]).lastInsertRowid)
  }
  return listAlertRules(db).find((r) => r.rule.id === id)!
}

export function listAlertEvents(db: Db, unreadOnly: boolean, limit: number): AlertEventRow[] {
  return all<{ id: number; rule_id: number; message: string; fired_at: string; read_at: string | null }>(
    db,
    `SELECT * FROM alert_events ${unreadOnly ? 'WHERE read_at IS NULL' : ''} ORDER BY fired_at DESC LIMIT ?`,
    [limit],
  ).map((r) => ({ id: r.id, ruleId: r.rule_id, message: r.message, firedAt: r.fired_at, readAt: r.read_at }))
}

/** Evalúa las reglas activas contra los datos actuales y guarda solo las alertas nuevas. */
export function runAlerts(ctx: AppContext): string[] {
  const rules = listAlertRules(ctx.db).filter((r) => r.enabled).map((r) => r.rule)
  if (rules.length === 0) return []
  const lastRuns = all<{ result_json: string }>(ctx.db, `SELECT result_json FROM arbitrage_runs WHERE started_at >= ? AND result_json IS NOT NULL ORDER BY started_at DESC LIMIT 20`, [
    new Date(ctx.now().getTime() - 86_400_000).toISOString(),
  ])
  const opportunities: AlertContext['opportunities'] = []
  for (const r of lastRuns) {
    const res = JSON.parse(r.result_json) as AnalysisResult
    for (const o of res.opportunities) {
      if (o.netProfit <= 0) continue
      opportunities.push({ origin: res.origin, destination: res.destination, itemId: o.itemId, itemName: o.itemName, roi: o.roiCommitted, netProfit: o.netProfit, observedAt: o.evidence.map((e) => e.observedAt).sort()[0] ?? res.startedAt })
    }
  }
  const bestSellPrices: AlertContext['bestSellPrices'] = []
  for (const r of rules) {
    if (r.kind !== 'item_below_price') continue
    const w = requireWorld(ctx.db, r.params.world)
    const p = bestSellPrice(ctx.db, w.id, r.params.itemId, true)
    if (p) bestSellPrices.push({ world: w.name, itemId: r.params.itemId, price: p.price, observedAt: p.observedAt })
  }
  const lastObservedByWorld: Record<string, string | undefined> = Object.fromEntries(
    all<{ name: string; last: string | null }>(ctx.db, `SELECT w.name, MAX(s.observed_at_utc) AS last FROM worlds w LEFT JOIN market_scans s ON s.world_id = w.id AND s.source = 'own_capture' GROUP BY w.name`).map((r) => [r.name, r.last ?? undefined]),
  )
  const needsTc = rules.some((r) => r.kind === 'tc_spread_above')
  const ctxData: AlertContext = {
    now: ctx.now(),
    opportunities,
    bestSellPrices,
    tcSpreads: needsTc ? tcQuotes(ctx, true).map((q) => ({ world: q.world, spreadPct: q.spreadPct, observedAt: q.observedAt ?? '' })) : [],
    lastObservedByWorld,
    routeStatuses: rules.flatMap((r) => (r.kind === 'route_invalid' ? [{ origin: r.params.originWorld, destination: r.params.destinationWorld, status: routeEvaluation(ctx, r.params.originWorld, r.params.destinationWorld).status }] : [])),
  }
  const fresh: string[] = []
  tx(ctx.db, () => {
    for (const h of evaluateAlerts(rules, ctxData)) {
      const r = run(ctx.db, 'INSERT OR IGNORE INTO alert_events (rule_id, dedupe_key, message, fired_at) VALUES (?,?,?,?)', [h.ruleId, h.dedupeKey, h.message, nowIso()])
      if (Number(r.changes) > 0) fresh.push(h.message)
    }
  })
  return fresh
}
