import type { Gp } from '../money/gp'
import type { RouteStatus } from '../transfers/rules'

// Alertas locales. Solo notifican: nunca ejecutan acciones en el juego.
// La clave de deduplicación evita repetir la misma alerta mientras la condición siga igual.

export type AlertRule =
  | { id: number; kind: 'roi_above'; params: { minRoi: number; originWorld?: string; destinationWorld?: string } }
  | { id: number; kind: 'item_below_price'; params: { world: string; itemId: number; itemName: string; maxPrice: Gp } }
  | { id: number; kind: 'tc_spread_above'; params: { world?: string; minSpreadPct: number } }
  | { id: number; kind: 'stale_data'; params: { world: string; maxAgeHours: number } }
  | { id: number; kind: 'route_invalid'; params: { originWorld: string; destinationWorld: string } }

export interface AlertContext {
  now: Date
  opportunities: { origin: string; destination: string; itemId: number; itemName: string; roi: number | null; netProfit: Gp; observedAt: string }[]
  bestSellPrices: { world: string; itemId: number; price: Gp; observedAt: string }[]
  tcSpreads: { world: string; spreadPct: number | null; observedAt: string }[]
  lastObservedByWorld: Record<string, string | undefined>
  routeStatuses: { origin: string; destination: string; status: RouteStatus }[]
}

export interface AlertHit {
  ruleId: number
  dedupeKey: string
  message: string
}

const day = (iso: string) => iso.slice(0, 10)

export function evaluateAlerts(rules: readonly AlertRule[], ctx: AlertContext): AlertHit[] {
  const hits: AlertHit[] = []
  for (const r of rules) {
    switch (r.kind) {
      case 'roi_above':
        for (const o of ctx.opportunities) {
          if (o.roi === null || o.roi < r.params.minRoi) continue
          if (r.params.originWorld && o.origin !== r.params.originWorld) continue
          if (r.params.destinationWorld && o.destination !== r.params.destinationWorld) continue
          hits.push({ ruleId: r.id, dedupeKey: `${o.origin}>${o.destination}:${o.itemId}:${day(o.observedAt)}`, message: `${o.itemName}: ROI ${o.roi.toFixed(1)} % (${o.origin} → ${o.destination})` })
        }
        break
      case 'item_below_price':
        for (const p of ctx.bestSellPrices) {
          if (p.world === r.params.world && p.itemId === r.params.itemId && p.price <= r.params.maxPrice) {
            hits.push({ ruleId: r.id, dedupeKey: `${p.world}:${p.itemId}:${p.price}`, message: `${r.params.itemName} a ${p.price.toLocaleString('en-US')} gp en ${p.world}` })
          }
        }
        break
      case 'tc_spread_above':
        for (const s of ctx.tcSpreads) {
          if (r.params.world && s.world !== r.params.world) continue
          if (s.spreadPct !== null && s.spreadPct >= r.params.minSpreadPct) {
            hits.push({ ruleId: r.id, dedupeKey: `${s.world}:${day(s.observedAt)}`, message: `Spread de TC en ${s.world}: ${s.spreadPct.toFixed(1)} %` })
          }
        }
        break
      case 'stale_data': {
        const last = ctx.lastObservedByWorld[r.params.world]
        const age = last ? (ctx.now.getTime() - new Date(last).getTime()) / 3_600_000 : Infinity
        if (age > r.params.maxAgeHours) {
          hits.push({ ruleId: r.id, dedupeKey: `${r.params.world}:${last ?? 'nunca'}`, message: `Datos de ${r.params.world} ${last ? `con ${Math.round(age)} h` : 'sin capturas'}` })
        }
        break
      }
      case 'route_invalid': {
        const s = ctx.routeStatuses.find((x) => x.origin === r.params.originWorld && x.destination === r.params.destinationWorld)
        if (s && s.status !== 'allowed') {
          hits.push({ ruleId: r.id, dedupeKey: `${s.origin}>${s.destination}:${s.status}`, message: `Ruta ${s.origin} → ${s.destination}: ${s.status === 'blocked' ? 'bloqueada' : 'no verificada'}` })
        }
        break
      }
    }
  }
  return hits
}
