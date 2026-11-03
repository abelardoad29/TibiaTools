import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import bossSeed from '../../seed/boss_spawns.json'
import { addDays } from '../../src/core/domain/bosses/spawn'
import { get, openDatabase, type Db } from '../../src/main/db/database'
import { loadSeeds } from '../../src/main/db/seed'
import { makePaths, type AppContext } from '../../src/main/context'
import { createLogger } from '../../src/main/logging'
import { createHttpClient } from '../../src/main/external/http'
import { bossesOutlook, bossHistory } from '../../src/main/services/bosses'

// El seed llega hasta `through` para Antica; la prueba corre tres días después.
const through = (bossSeed as unknown as { worlds: Record<string, { through: string }> }).worlds.Antica!.through
const day1 = addDays(through, 1)
const day2 = addDays(through, 2)
const today = addDays(through, 3)
const calls: string[] = []

const entries = (race: string, killed: number, players: number) => ({ killstatistics: { world: 'Antica', entries: [{ race, last_day_killed: killed, last_day_players_killed: players, last_week_killed: killed, last_week_players_killed: players }] } })
const fakeFetch = (async (url: string | URL | Request) => {
  const u = String(url)
  calls.push(u)
  if (u.includes(`/antica/${day1}.json`)) return new Response(JSON.stringify(entries('Ferumbras', 1, 4)))
  if (u.includes(`/antica/${day2}.json`)) return new Response(JSON.stringify({ killstatistics: { world: 'Antica', entries: [] } }))
  if (u.includes('/killstatistics/Antica')) return new Response(JSON.stringify({ ...entries('yetis', 2, 0), information: { timestamp: `${today}T10:00:00Z` } }))
  return new Response('{}', { status: 404 })
}) as typeof fetch

let dir: string
let db: Db
let ctx: AppContext

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-bosses-'))
  db = openDatabase(':memory:')
  loadSeeds(db)
  const log = createLogger(null)
  ctx = { db, paths: makePaths(dir), http: createHttpClient(db, log, fakeFetch), log, version: 'test', now: () => new Date(`${today}T15:00:00Z`) }
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('boss hunter', () => {
  it('completa los días que faltan desde el seed y calcula la probabilidad de hoy', async () => {
    const o = await bossesOutlook(ctx, 'Antica')
    expect(o.syncError).toBeNull()
    expect(o.statsDay).toBe(today)
    // Días pasados desde tibiamaps, el de hoy desde TibiaData.
    expect(calls.filter((c) => c.includes('raw.githubusercontent.com'))).toHaveLength(2)
    expect(calls.filter((c) => c.includes('/killstatistics/'))).toHaveLength(1)
    expect(o.through).toBe(today)
    const fer = o.rows.find((r) => r.name === 'Ferumbras')!
    expect(fer.lastSeen).toEqual({ day: day1, killed: 1, playersKilled: 4 })
    expect(fer.daysSince).toBe(3)
    // Ferumbras no vuelve en 3 días.
    expect(fer.tier).toBe('none')
    expect(o.rows.find((r) => r.name === 'Yeti')!.lastSeen?.day).toBe(today)
    expect(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM boss_sightings WHERE source = 'seed'`)!.n).toBeGreaterThan(100)
  })

  it('no vuelve a bajar lo que ya tiene', async () => {
    const before = calls.length
    await bossesOutlook(ctx, 'Antica')
    expect(calls.length).toBe(before)
  })

  it('historial del boss en el mundo, más reciente primero', () => {
    const h = bossHistory(ctx, 'Antica', 'Ferumbras')
    expect(h.sightings[0]!.day).toBe(day1)
    expect(h.hazard.length).toBeGreaterThan(0)
  })
})
