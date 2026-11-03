import { describe, expect, it } from 'vitest'
import { evaluateRoute, type TransferRuleSet, type WorldTransferInfo } from '@core/domain/transfers/rules'
import { characterChecklist, finalTransferStatus, type TransferProfile } from '@core/domain/transfers/checklist'
import { evaluateAlerts } from '@core/domain/alerts/rules'
import rulesSeed from '@seed/transfer_rules.json'

const RULES = rulesSeed as unknown as TransferRuleSet
const NOW = new Date('2026-11-02T12:00:00Z')
const w = (name: string, pvpType: string, extra: Partial<WorldTransferInfo> = {}): WorldTransferInfo => ({
  name,
  pvpType,
  battleyeDate: 'release',
  battleyeProtected: true,
  transferType: 'regular',
  gameWorldType: 'regular',
  looserTransferConditions: false,
  ...extra,
})

describe('rutas de transferencia', () => {
  it('PvP: solo a reglas iguales o más limitadas', () => {
    expect(evaluateRoute(w('A', 'Open PvP'), w('B', 'Optional PvP'), RULES, NOW).status).toBe('allowed')
    expect(evaluateRoute(w('A', 'Optional PvP'), w('B', 'Open PvP'), RULES, NOW).status).toBe('blocked')
    expect(evaluateRoute(w('A', 'Retro Hardcore PvP'), w('B', 'Open PvP'), RULES, NOW).status).toBe('allowed')
  })
  it('PvP no permitido con "looser conditions" desconocido queda unknown, no blocked ni allowed', () => {
    expect(evaluateRoute(w('A', 'Optional PvP'), w('B', 'Open PvP', { looserTransferConditions: null }), RULES, NOW).status).toBe('unknown')
  })
  it('BattlEye: a un mundo protegido desde el lanzamiento solo desde otro igual', () => {
    expect(evaluateRoute(w('A', 'Open PvP', { battleyeDate: '2017-08-29' }), w('B', 'Open PvP'), RULES, NOW).status).toBe('blocked')
    expect(evaluateRoute(w('A', 'Open PvP'), w('B', 'Open PvP', { battleyeDate: '2017-08-29' }), RULES, NOW).status).toBe('allowed')
    expect(evaluateRoute(w('A', 'Open PvP', { battleyeDate: null }), w('B', 'Open PvP'), RULES, NOW).status).toBe('unknown')
  })
  it('mundos blocked y locked', () => {
    expect(evaluateRoute(w('A', 'Open PvP'), w('B', 'Open PvP', { transferType: 'blocked' }), RULES, NOW).status).toBe('blocked')
    expect(evaluateRoute(w('A', 'Open PvP', { transferType: 'blocked' }), w('B', 'Open PvP'), RULES, NOW).status).toBe('allowed')
    expect(evaluateRoute(w('A', 'Optional PvP'), w('Z', 'Open PvP', { transferType: 'locked', gameWorldType: 'experimental' }), RULES, NOW).status).toBe('allowed')
    expect(evaluateRoute(w('Z', 'Open PvP', { transferType: 'locked' }), w('B', 'Open PvP'), RULES, NOW).status).toBe('blocked')
  })
  it('reglas vencidas → unknown', () => {
    expect(evaluateRoute(w('A', 'Open PvP'), w('B', 'Optional PvP'), RULES, new Date('2030-01-01')).status).toBe('unknown')
  })
})

describe('checklist del personaje', () => {
  const profile: TransferProfile = { name: 'Abe', currentWorld: 'A', lastTransferAt: '2025-01-01', hasRedOrBlackSkull: false, isGuildLeader: false, ownsHouse: false, hasOpenTcMarketOffers: false, isOnMainContinent: true, visitedCalvaOrCalvera: null, transferType: 'regular', availableEligibleTc: 750 }
  it('eligible solo con todo confirmado', () => {
    const route = evaluateRoute(w('A', 'Open PvP'), w('B', 'Optional PvP'), RULES, NOW)
    expect(finalTransferStatus(route, characterChecklist(profile, w('A', 'Open PvP'), w('B', 'Optional PvP'), NOW))).toBe('eligible')
    const unknownHouse = characterChecklist({ ...profile, ownsHouse: null }, w('A', 'Open PvP'), w('B', 'Optional PvP'), NOW)
    expect(finalTransferStatus(route, unknownHouse)).toBe('unverified')
  })
  it('transferencia regular reciente exige Express', () => {
    const c = characterChecklist({ ...profile, lastTransferAt: '2026-10-01' }, w('A', 'Open PvP'), w('B', 'Optional PvP'), NOW)
    expect(c.find((i) => i.key === 'six-months')!.result).toBe('fail')
  })
  it('Hardcore → Hardcore pregunta por Calva/Calvera', () => {
    const c = characterChecklist(profile, w('A', 'Hardcore PvP'), w('B', 'Hardcore PvP'), NOW)
    expect(c.find((i) => i.key === 'calva')!.result).toBe('unknown')
  })
})

describe('alertas', () => {
  it('genera claves de deduplicación estables', () => {
    const hits = evaluateAlerts(
      [
        { id: 1, kind: 'roi_above', params: { minRoi: 10 } },
        { id: 2, kind: 'stale_data', params: { world: 'Antica', maxAgeHours: 24 } },
        { id: 3, kind: 'route_invalid', params: { originWorld: 'A', destinationWorld: 'B' } },
      ],
      {
        now: NOW,
        opportunities: [{ origin: 'A', destination: 'B', itemId: 7, itemName: 'X', roi: 12, netProfit: 100, observedAt: '2026-11-02T10:00:00Z' }],
        bestSellPrices: [],
        tcSpreads: [],
        lastObservedByWorld: { Antica: '2026-10-30T00:00:00Z' },
        routeStatuses: [{ origin: 'A', destination: 'B', status: 'unknown' }],
      },
    )
    expect(hits.map((h) => h.dedupeKey)).toEqual(['A>B:7:2026-11-02', 'Antica:2026-10-30T00:00:00Z', 'A>B:unknown'])
  })
})
