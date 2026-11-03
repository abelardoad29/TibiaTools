import { describe, expect, it } from 'vitest'
import { baseVocation, summarizeOnline } from '../../src/core/domain/catalog/worlds'

describe('resumen de conectados de un mundo', () => {
  it('agrupa vocaciones promovidas con la base', () => {
    expect(baseVocation('Elite Knight')).toBe('Knight')
    expect(baseVocation('Exalted Monk')).toBe('Monk')
    expect(baseVocation('Druid')).toBe('Druid')
    expect(baseVocation('None')).toBe('None')
  })

  it('cuenta vocaciones, rangos de nivel, mediana y top', () => {
    const s = summarizeOnline(
      [
        { name: 'A', level: 8, vocation: 'None' },
        { name: 'B', level: 150, vocation: 'Elite Knight' },
        { name: 'C', level: 420, vocation: 'Knight' },
        { name: 'D', level: 1200, vocation: 'Master Sorcerer' },
      ],
      2,
    )
    expect(s.vocations).toEqual([
      { vocation: 'Knight', count: 2 },
      { vocation: 'None', count: 1 },
      { vocation: 'Sorcerer', count: 1 },
    ])
    expect(s.levels).toEqual({ min: 8, median: 285, max: 1200 })
    expect(s.buckets.map((b) => b.count)).toEqual([1, 1, 1, 0, 1])
    expect(s.top.map((p) => p.name)).toEqual(['D', 'C'])
  })

  it('mundo vacío', () => {
    expect(summarizeOnline([])).toMatchObject({ vocations: [], levels: null, top: [] })
  })
})
