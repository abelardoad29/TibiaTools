import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { get, openDatabase, type Db } from '../../src/main/db/database'
import { loadSeeds } from '../../src/main/db/seed'
import { makePaths, type AppContext } from '../../src/main/context'
import { createLogger } from '../../src/main/logging'
import { createHttpClient } from '../../src/main/external/http'
import { addWatchEntry, createWatcher, listWatchEntries, listWatchEvents, listWatchLists, listWatchOnline, saveWatchList } from '../../src/main/services/watch'
import { setSettings } from '../../src/main/services/settings'

// TibiaData simulado: el mundo "Antica" devuelve la lista de conectados que fije cada prueba.
let online: { name: string; level: number; vocation: string }[] = []
const characters: Record<string, { name: string; world: string; level: number; vocation: string }> = {
  'enemigo uno': { name: 'Enemigo Uno', world: 'Antica', level: 500, vocation: 'Elite Knight' },
}
const fakeFetch = (async (url: string | URL | Request) => {
  const u = decodeURIComponent(String(url))
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  if (u.includes('/world/Antica')) return json({ world: { name: 'Antica', online_players: online }, information: { timestamp: new Date().toISOString() } })
  if (u.includes('/character/')) {
    const ch = characters[u.split('/character/')[1]!.toLowerCase()]
    return ch ? json({ character: { character: ch, deaths: [] } }) : new Response('error code: 502', { status: 502 })
  }
  if (u.includes('/guild/Los Malos')) {
    return json({ guild: { name: 'Los Malos', world: 'Antica', members: ['Malo A', 'Malo B', 'Malo C', 'Malo D', 'Malo E'].map((name) => ({ name, rank: 'Member', level: 300, vocation: 'Druid' })) } })
  }
  if (u.includes('/guild/')) return new Response('error code: 502', { status: 502 })
  return new Response('{}', { status: 404 })
}) as typeof fetch

let dir: string
let db: Db
let ctx: AppContext

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-watch-'))
  db = openDatabase(':memory:')
  loadSeeds(db)
  ctx = { db, paths: makePaths(dir), http: createHttpClient(db, createLogger(null), fakeFetch), log: createLogger(null), version: 'test', now: () => new Date() }
})
afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const p = (name: string, level = 300) => ({ name, level, vocation: 'Druid' })

describe('vigilancia (hunted list)', () => {
  it('la migración crea la lista Hunted con aviso de ráfaga 5 en 60 s', () => {
    expect(listWatchLists(db)[0]).toMatchObject({ name: 'Hunted', notifyLogin: true, burstThreshold: 5, burstWindowSec: 60 })
  })

  it('valida personajes y guilds contra TibiaData', async () => {
    const hunted = listWatchLists(db)[0]!.id
    const e = await addWatchEntry(ctx, { listId: hunted, kind: 'character', name: 'enemigo uno', note: 'PK' })
    expect(e).toMatchObject({ name: 'Enemigo Uno', world: 'Antica', kind: 'character' })
    const g = await addWatchEntry(ctx, { listId: hunted, kind: 'guild', name: 'Los Malos', note: null })
    expect(g.members).toBe(5)
    await expect(addWatchEntry(ctx, { listId: hunted, kind: 'character', name: 'Zzqx', note: null })).rejects.toThrow(/No existe un personaje/)
    await expect(addWatchEntry(ctx, { listId: hunted, kind: 'guild', name: 'Zzqx', note: null })).rejects.toThrow(/No existe una guild/)
  })

  it('conexiones, nivel, desconexiones y ráfaga de 5 en la misma lectura', async () => {
    setSettings(db, { watch: { enabled: false, intervalSec: 60, sound: false } })
    const w = createWatcher(ctx, () => undefined)

    // 1ª lectura: Enemigo Uno ya estaba conectado → sin evento de conexión.
    online = [p('Enemigo Uno', 500), p('Ajeno')]
    const first = await w.scan()
    expect(first.logins).toBe(0)
    expect(listWatchOnline(db).map((o) => o.name)).toEqual(['Enemigo Uno'])
    expect(listWatchOnline(db)[0]!.lastLoginAt).toBeNull()

    // 2ª lectura: entran los 5 de la guild de golpe y Enemigo Uno sube de nivel.
    online = [p('Enemigo Uno', 501), p('Ajeno'), p('Malo A'), p('Malo B'), p('Malo C'), p('Malo D'), p('Malo E')]
    const second = await w.scan()
    expect(second.logins).toBe(5)
    expect(second.bursts).toBe(1)
    expect(second.notifications[0]!.title).toMatch(/5 de Hunted conectados de golpe/)
    expect(second.messages.some((m) => m.includes('pasó de nivel 500 a 501'))).toBe(true)
    expect(listWatchEntries(db, null).find((e) => e.kind === 'guild')!.online).toBe(5)

    // 3ª lectura: se van todos menos uno; no hay nueva ráfaga.
    online = [p('Malo A')]
    const third = await w.scan()
    expect(third.logouts).toBe(5)
    expect(third.bursts).toBe(0)
    expect(listWatchOnline(db).map((o) => o.name)).toEqual(['Malo A'])

    const kinds = listWatchEvents(db, 100).map((e) => e.kind)
    expect(kinds.filter((k) => k === 'login')).toHaveLength(5)
    expect(kinds).toContain('burst')
    expect(kinds).toContain('level')
    expect(w.status()).toMatchObject({ worlds: ['Antica'], watched: 6 })
  })

  it('una lista sin aviso de ráfaga no la dispara', async () => {
    const amigos = saveWatchList(db, { id: null, name: 'Amigos', notifyLogin: false, burstThreshold: null, burstWindowSec: 60 })
    expect(amigos.burstThreshold).toBeNull()
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM watch_lists')!.n).toBe(2)
  })
})
