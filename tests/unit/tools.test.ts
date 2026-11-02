import { describe, expect, it } from 'vitest'
import { rashidLocation, serverWeekday } from '@core/domain/tools/rashid'
import { canShare, shareRange } from '@core/domain/tools/share-exp'
import { parsePartySession, splitLoot } from '@core/domain/tools/split-loot'
import { imbuementCost, type ImbuementDef, type TierDef } from '@core/domain/tools/imbuements'
import { detectCharacterEvents } from '@core/domain/tools/characters'
import { matchScore, normalizeName } from '@core/domain/catalog/names'

describe('rashid', () => {
  it('usa el día de servidor: antes de las 10:00 CET sigue el día anterior', () => {
    // Lunes 2026-11-02 08:30 UTC = 09:30 CET → aún domingo de servidor (Carlin)
    expect(serverWeekday(new Date('2026-11-02T08:30:00Z'))).toBe('Sunday')
    expect(rashidLocation(new Date('2026-11-02T08:30:00Z')).city).toBe('Carlin')
    // 09:00 UTC = 10:00 CET → lunes (Svargrond)
    expect(rashidLocation(new Date('2026-11-02T09:00:00Z')).city).toBe('Svargrond')
  })
  it('respeta el horario de verano (CEST = UTC+2)', () => {
    // Martes 2026-07-07 07:59 UTC = 09:59 CEST → lunes de servidor
    expect(serverWeekday(new Date('2026-07-07T07:59:00Z'))).toBe('Monday')
    expect(serverWeekday(new Date('2026-07-07T08:00:00Z'))).toBe('Tuesday')
  })
})

describe('share exp', () => {
  it('corrige el off-by-one de la v1', () => {
    expect(shareRange(100)).toEqual({ level: 100, min: 67, max: 150 })
    expect(shareRange(101)).toEqual({ level: 101, min: 68, max: 151 })
    expect(shareRange(3)).toEqual({ level: 3, min: 2, max: 4 })
  })
  it('valida grupos', () => {
    expect(canShare([100, 150])).toBe(true)
    expect(canShare([100, 151])).toBe(false)
    expect(canShare([67, 100])).toBe(true)
    expect(canShare([66, 100])).toBe(false)
  })
  it('rechaza niveles inválidos', () => {
    expect(() => shareRange(0)).toThrow()
    expect(() => shareRange(1.5)).toThrow()
  })
})

const SESSION = `Session data: From 2026-11-01, 20:00:00 to 2026-11-01, 21:00:00
Session: 01:00h
Loot Type: Leader
Loot: 3,000,000
Supplies: 600,000
Balance: 2,400,001
Knight One (Leader)
\tLoot: 2,000,000
\tSupplies: 150,000
\tBalance: 1,850,000
\tDamage: 1,200,000
\tHealing: 300,000
Druid Two
\tLoot: 500,000
\tSupplies: 250,000
\tBalance: 250,000
\tDamage: 400,000
\tHealing: 900,000
Paladin Three
\tLoot: 500,000
\tSupplies: 199,999
\tBalance: 300,001
\tDamage: 2,000,000
\tHealing: 10,000`

describe('split loot', () => {
  it('parsea el Party Hunt Analyzer', () => {
    const s = parsePartySession(SESSION)
    expect(s.totalBalance).toBe(2_400_001)
    expect(s.members.map((m) => m.name)).toEqual(['Knight One', 'Druid Two', 'Paladin Three'])
    expect(s.members[0]!.leader).toBe(true)
    expect(s.members[2]!.supplies).toBe(199_999)
  })
  it('reparte en partes enteras y conserva el total', () => {
    const r = splitLoot(parsePartySession(SESSION))
    expect(r.sharePerMember).toBe(800_000)
    expect(r.remainder).toBe(1)
    expect(r.transfers).toEqual([
      { from: 'Knight One', to: 'Druid Two', amount: 550_000, command: 'transfer 550000 to Druid Two' },
      { from: 'Knight One', to: 'Paladin Three', amount: 499_999, command: 'transfer 499999 to Paladin Three' },
    ])
  })
  it('acepta balances negativos', () => {
    const r = splitLoot(parsePartySession(`Balance: -100\nA\nLoot: 0\nSupplies: 150\nBalance: -150\nB\nLoot: 100\nSupplies: 50\nBalance: 50`))
    expect(r.sharePerMember).toBe(-50)
    expect(r.transfers).toEqual([{ from: 'B', to: 'A', amount: 100, command: 'transfer 100 to A' }])
  })
  it('falla con texto sin jugadores', () => {
    expect(() => parsePartySession('Loot: 1')).toThrow()
  })
})

describe('imbuements', () => {
  const vamp: ImbuementDef = {
    name: 'Vampirism',
    effect: 'Roubo de Vida',
    materials: [
      { qty: 25, item: 'Vampire Teeth' },
      { qty: 15, item: 'Bloody Pincers' },
      { qty: 5, item: 'Piece of Dead Brain' },
    ],
  }
  const powerful: TierDef = { tier: 'Powerful', materials: 3, shrineFeeGp: 250_000 }
  it('suma materiales + santuario', () => {
    const c = imbuementCost(vamp, powerful, { 'Vampire Teeth': 1_000, 'Bloody Pincers': 2_000, 'Piece of Dead Brain': 5_000 })
    expect(c.materialsTotal).toBe(25_000 + 30_000 + 25_000)
    expect(c.total).toBe(80_000 + 250_000)
  })
  it('no asume 0 si falta un precio', () => {
    const c = imbuementCost(vamp, powerful, { 'Vampire Teeth': 1_000 })
    expect(c.total).toBeNull()
    expect(c.missingPrices).toEqual(['Bloody Pincers', 'Piece of Dead Brain'])
  })
  it('compara con Gold Tokens solo si hay datos', () => {
    const c = imbuementCost(vamp, powerful, { 'Vampire Teeth': 1_000, 'Bloody Pincers': 2_000, 'Piece of Dead Brain': 5_000 }, { tokensForTier: 6, goldTokenPrice: 10_000, tradeable: true })
    expect(c.tokenAlternative).toEqual({ tokens: 6, tokenPrice: 10_000, total: 310_000, cheaper: 'tokens' })
    expect(imbuementCost(vamp, powerful, {}, { tokensForTier: null, goldTokenPrice: 1, tradeable: true }).tokenAlternative).toBeNull()
  })
})

describe('characters', () => {
  const snap = { name: 'Abe', world: 'Antica', level: 120, vocation: 'Knight', deaths: [{ time: '2026-11-01T10:00:00Z', level: 119, reason: 'a dragon' }] }
  it('la primera consulta no notifica muertes viejas', () => {
    expect(detectCharacterEvents({ level: null, knownDeathKeys: [] }, snap)).toEqual([])
  })
  it('detecta level up y muertes nuevas una sola vez', () => {
    const ev = detectCharacterEvents({ level: 119, knownDeathKeys: [] }, snap)
    expect(ev.map((e) => e.type)).toEqual(['level_up', 'death'])
    expect(detectCharacterEvents({ level: 120, knownDeathKeys: ['death:2026-11-01T10:00:00Z:119'] }, snap)).toEqual([])
  })
})

describe('nombres', () => {
  it('normaliza y puntúa', () => {
    expect(normalizeName("  Mooh’Tah  Shell ")).toBe("mooh'tah shell")
    expect(matchScore('vampire teeth', 'Vampire Teeth')).toBe(100)
    expect(matchScore('gmp', 'great mana potion')).toBeGreaterThan(0)
    expect(matchScore('mana', 'great mana potion')).toBeGreaterThan(matchScore('mna', 'great mana potion'))
    expect(matchScore('xyz', 'great mana potion')).toBe(0)
  })
})
