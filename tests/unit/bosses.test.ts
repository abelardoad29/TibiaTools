import { describe, expect, it } from 'vitest'
import { BOSSES } from '../../src/core/domain/bosses/list'
import { bossesByRace, bossOutlook, currentStatsDay, mergeSameSpawn, sightingsFromEntries, type BossSpawnStats } from '../../src/core/domain/bosses/spawn'

// Boss de prueba: nunca aparece antes de 3 días; el día 3 aparece la mitad, el 4 el 50 % de lo que queda…
const stats: BossSpawnStats = {
  name: 'Test Boss',
  race: 'Test Boss',
  group: 'Otros',
  appearances: 100,
  intervals: { n: 90, min: 3, p10: 3, p50: 4, p90: 6, max: 9 },
  hazard: [0, 0, 0.5, 0.5, 0.5, 0.5],
  tailHazard: 0.5,
}

describe('boss hunter', () => {
  it('une dos días seguidos si el primero solo mató jugadores (mismo boss)', () => {
    const merged = mergeSameSpawn([
      { day: '2026-10-02', killed: 0, playersKilled: 3 },
      { day: '2026-10-03', killed: 1, playersKilled: 1 },
      { day: '2026-10-04', killed: 1, playersKilled: 0 },
    ])
    expect(merged).toEqual([
      { day: '2026-10-02', killed: 1, playersKilled: 4 },
      { day: '2026-10-04', killed: 1, playersKilled: 0 },
    ])
  })

  it('reconoce los nombres de la estadística (las criaturas raras van en plural)', () => {
    const s = sightingsFromEntries(
      [
        { race: 'yetis', last_day_killed: 1, last_day_players_killed: 0 },
        { race: 'Arthom The Hunter', last_day_killed: 1, last_day_players_killed: 0 },
        { race: 'Ferumbras', last_day_killed: 0, last_day_players_killed: 0 },
        { race: 'dragons', last_day_killed: 500, last_day_players_killed: 2 },
      ],
      '2026-11-02',
      bossesByRace(BOSSES),
    )
    expect(s).toEqual([
      { boss: 'Yeti', day: '2026-11-02', killed: 1, playersKilled: 0 },
      { boss: 'Arthom the Hunter', day: '2026-11-02', killed: 1, playersKilled: 0 },
    ])
  })

  it('sin chance antes del intervalo mínimo; ventana abierta después', () => {
    const before = bossOutlook(stats, [{ day: '2026-11-01', killed: 1, playersKilled: 0 }], '2026-11-03', '2026-01-01')
    expect(before).toMatchObject({ daysSince: 2, chance: 0, tier: 'none', windowOpensIn: 1, expectedIn: 1, overdue: false, maybeAlive: false })
    const open = bossOutlook(stats, [{ day: '2026-11-01', killed: 1, playersKilled: 0 }], '2026-11-04', '2026-01-01')
    expect(open).toMatchObject({ daysSince: 3, chance: 0.5, tier: 'high', windowOpensIn: 0, expectedIn: 0 })
  })

  it('marca atrasado pasado el percentil 90 y "¿vivo?" si solo mató jugadores', () => {
    const late = bossOutlook(stats, [{ day: '2026-10-20', killed: 0, playersKilled: 2 }], '2026-11-04', '2026-01-01')
    expect(late).toMatchObject({ overdue: true, maybeAlive: true, chance: 0.5 })
  })

  it('sin registro (mundo nuevo): no inventa una probabilidad', () => {
    const none = bossOutlook(stats, [], '2026-11-04', '2026-11-01')
    expect(none).toMatchObject({ lastSeen: null, noRecord: true, daysSince: 3, chance: null, tier: 'unknown', windowOpensIn: null })
  })

  it('día de estadística: se actualiza ~3 a. m. de Berlín', () => {
    expect(currentStatsDay(new Date('2026-11-02T01:30:00Z'))).toBe('2026-11-01') // 02:30 en Berlín
    expect(currentStatsDay(new Date('2026-11-02T03:30:00Z'))).toBe('2026-11-02') // 04:30 en Berlín
    expect(currentStatsDay(new Date('2026-11-02T23:30:00Z'))).toBe('2026-11-02') // 00:30 del 3 en Berlín
  })
})
