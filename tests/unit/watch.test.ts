import { describe, expect, it } from 'vitest'
import { diffOnline, trackBurst, watchKey, type BurstState, type OnlinePlayer } from '@core/domain/watch/online'

const p = (name: string, level = 100): OnlinePlayer => ({ name, level, vocation: 'Knight' })
const map = (...ps: OnlinePlayer[]) => new Map(ps.map((x) => [watchKey(x.name), x]))

describe('diffOnline', () => {
  const watched = new Set(['enemigo uno', 'enemigo dos', 'enemigo tres'])
  it('la primera lectura no genera conexiones', () => {
    expect(diffOnline(null, [p('Enemigo Uno')], watched)).toEqual({ logins: [], logouts: [], levelChanges: [] })
  })
  it('detecta conexiones, desconexiones y subidas de nivel solo de los vigilados', () => {
    const d = diffOnline(map(p('Enemigo Uno', 100), p('Enemigo Dos')), [p('Enemigo Uno', 101), p('Enemigo Tres'), p('Cualquiera')], watched)
    expect(d.logins.map((x) => x.name)).toEqual(['Enemigo Tres'])
    expect(d.logouts).toEqual(['Enemigo Dos'])
    expect(d.levelChanges).toEqual([{ name: 'Enemigo Uno', from: 100, to: 101 }])
  })
  it('alguien agregado a la lista mientras ya jugaba no cuenta como conexión', () => {
    const prevAll = map(p('Enemigo Tres'), p('Otro'))
    expect(diffOnline(prevAll, [p('Enemigo Tres'), p('Otro')], watched)).toEqual({ logins: [], logouts: [], levelChanges: [] })
    expect(diffOnline(prevAll, [p('Enemigo Tres')], watched).logouts).toEqual([])
  })
  it('no distingue mayúsculas', () => {
    expect(diffOnline(map(), [p('ENEMIGO UNO')], watched).logins).toHaveLength(1)
  })
})

describe('trackBurst', () => {
  const rule = { threshold: 5, windowMs: 60_000 }
  const empty: BurstState = { recent: [], lastAlertAt: null }
  const logins = (...names: string[]) => names.map((name) => ({ name }))

  it('avisa con 5 conexiones dentro de la ventana, aunque lleguen en lecturas distintas', () => {
    let r = trackBurst(empty, logins('a', 'b', 'c'), 0, rule)
    expect(r.fired).toBeNull()
    r = trackBurst(r.state, logins('d', 'e'), 50_000, rule)
    expect(r.fired).toEqual({ count: 5, names: ['a', 'b', 'c', 'd', 'e'] })
  })
  it('no cuenta conexiones fuera de la ventana', () => {
    const r1 = trackBurst(empty, logins('a', 'b', 'c'), 0, rule)
    expect(trackBurst(r1.state, logins('d', 'e'), 61_000, rule).fired).toBeNull()
  })
  it('una sola alerta por ráfaga', () => {
    const r1 = trackBurst(empty, logins('a', 'b', 'c', 'd', 'e'), 0, rule)
    expect(r1.fired?.count).toBe(5)
    expect(trackBurst(r1.state, logins('f'), 30_000, rule).fired).toBeNull()
    expect(trackBurst(r1.state, logins('f', 'g', 'h', 'i', 'j'), 120_000, rule).fired?.count).toBe(5)
  })
  it('el mismo personaje que reconecta no cuenta dos veces', () => {
    expect(trackBurst(empty, logins('a', 'a', 'a', 'a', 'b'), 0, rule).fired).toBeNull()
  })
})
