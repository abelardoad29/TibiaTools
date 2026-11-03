import { describe, expect, it } from 'vitest'
import { identifyItem, nameDistance, nameScore } from '@core/ocr/match'

const CATALOG = ['gold token', 'silver token', 'silver raid token', 'gold tooth', 'Tibia Coins', 'moonsilver trail hood', 'great health potion', 'strong health potion', 'bold token'].map((name, id) => ({ id, name }))

describe('identificación del item por nombre leído', () => {
  it("'?' es comodín de una letra (o de dos pegadas) y no distingue mayúsculas", () => {
    expect(nameDistance('sil?er token', 'silver token')).toBe(0.25)
    expect(nameDistance('sil?r token', 'silver token')).toBe(0.5)
    expect(nameDistance('tibia coins', 'Tibia Coins')).toBe(0)
    // Un comodín no se come un espacio entre palabras.
    expect(nameDistance('gold?oken', 'gold token')).toBeGreaterThanOrEqual(1)
    expect(nameScore('gold token', 'gold token')).toBe(1)
  })

  it('identifica con letras desconocidas o confundidas cuando el mejor está claro', () => {
    expect(identifyItem('sil?e? token', CATALOG)).toMatchObject({ confident: true, best: { name: 'silver token' } })
    expect(identifyItem('?ihia ?oins', CATALOG)).toMatchObject({ confident: true, best: { name: 'Tibia Coins' } })
    expect(identifyItem('moonsil?er trail hood', CATALOG)).toMatchObject({ confident: true, best: { name: 'moonsilver trail hood' } })
  })

  it('no adivina si dos nombres empatan o si nada se parece', () => {
    // «?old token» encaja igual con gold token y bold token.
    const tie = identifyItem('?old token', CATALOG)
    expect(tie.confident).toBe(false)
    expect(tie.candidates.slice(0, 2).map((c) => c.name).sort()).toEqual(['bold token', 'gold token'])
    expect(identifyItem('dragon scale mail', CATALOG).confident).toBe(false)
    expect(identifyItem('   ', CATALOG)).toEqual({ best: null, candidates: [], confident: false })
  })
})
