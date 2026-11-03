import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ThirdPartySyncStatus } from '../../src/shared/api'
import { all, get, openDatabase, type Db } from '../../src/main/db/database'
import { loadSeeds } from '../../src/main/db/seed'
import { makePaths, type AppContext } from '../../src/main/context'
import { createLogger } from '../../src/main/logging'
import { createHttpClient } from '../../src/main/external/http'
import type { MarketValues } from '../../src/main/external/tibiamarket'
import { requireWorld } from '../../src/main/services/catalog'
import { storeMarketValues } from '../../src/main/services/market'
import { createThirdPartySync, type ThirdPartySync } from '../../src/main/services/third-party-sync'

const T = 1_792_000_000
const VALUES: Partial<MarketValues>[] = [
  // Great mana potion (238): precios, nº de ofertas y solo estadística de 30 días con ventas.
  { id: 238, time: T, buy_offer: 1, sell_offer: 2, buy_offers: 10, sell_offers: 5, month_sold: 300, month_average_sell: 2, month_bought: -1, day_sold: 0, day_average_sell: 0 },
  // Vampire teeth (9685) sin ofertas ni ventas: no genera quote ni estadísticas.
  { id: 9685, time: T, buy_offer: -1, sell_offer: -1, month_sold: 0, month_average_sell: 0 },
  // Fuera del catálogo.
  { id: 999_999, time: T, buy_offer: 5, sell_offer: 6 },
]

let dir: string
let db: Db
let ctx: AppContext
let sync: ThirdPartySync
const calls: string[] = []
const progress: ThirdPartySyncStatus[] = []
let remoteUpdate = '2026-09-15T12:00:00'
let bonaFails = true

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-tp-'))
  db = openDatabase(':memory:')
  loadSeeds(db)
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('/world_data')) {
      return new Response(JSON.stringify([{ name: 'Antica', last_update: remoteUpdate }, { name: 'Bona', last_update: '2026-09-01T08:00:00' }, { name: 'Notaworld', last_update: '2026-09-01T08:00:00' }]))
    }
    if (u.includes('/market_values')) {
      if (u.includes('server=Bona') && bonaFails) return new Response('{"detail":"Not Found"}', { status: 404 })
      return new Response(JSON.stringify(VALUES))
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  ctx = { db, paths: makePaths(dir), http: createHttpClient(db, createLogger(null), fakeFetch, { 'api.tibiamarket.top': 0 }), log: createLogger(null), version: 'test', now: () => new Date() }
  sync = createThirdPartySync(ctx, (s) => progress.push(s))
})

afterAll(() => {
  sync.stop()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const marketCalls = () => calls.filter((c) => c.includes('/market_values'))
async function runSync(opts: { worlds: string[] | null; force: boolean }) {
  calls.length = 0
  sync.start(opts)
  await sync.idle()
  return sync.status()
}

describe('storeMarketValues', () => {
  it('guarda precios y nº de ofertas, ignora "sin dato" y no duplica al reimportar', () => {
    const w = requireWorld(db, 'Thyria')
    const first = storeMarketValues(db, w.id, VALUES as MarketValues[])
    expect(first).toEqual({ quotes: 1, stats: 1, skipped: 1, items: 2 })
    const q = get<{ best_buy_gp: number; best_sell_gp: number; buy_offers: number; sell_offers: number; source: string }>(db, 'SELECT * FROM market_quotes WHERE world_id = ?', [w.id])!
    expect(q).toMatchObject({ best_buy_gp: 1, best_sell_gp: 2, buy_offers: 10, sell_offers: 5, source: 'third_party' })
    const stats = all<{ stat_window: string; side: string; transactions: number }>(db, 'SELECT stat_window, side, transactions FROM market_stats WHERE world_id = ?', [w.id])
    expect(stats).toEqual([{ stat_window: '30d', side: 'sell', transactions: 300 }])
    // Mismo escaneo (misma hora del dato): nada nuevo.
    expect(storeMarketValues(db, w.id, VALUES as MarketValues[])).toMatchObject({ quotes: 0, stats: 0 })
  })
})

describe('sincronización de todos los mundos', () => {
  it('baja cada mundo seguido por tibiamarket en una consulta y registra los errores', async () => {
    const s = await runSync({ worlds: null, force: false })
    // Notaworld no está en el catálogo: solo Antica y Bona.
    expect(s).toMatchObject({ running: false, total: 2, done: 2, imported: 1, failed: 1, unchanged: 0 })
    expect(marketCalls()).toHaveLength(2)
    expect(marketCalls()[0]).toContain('limit=10000')
    const rows = Object.fromEntries(sync.worlds().map((r) => [r.world, r]))
    expect(rows.Antica).toMatchObject({ tracked: true, dataAt: '2026-09-15T12:00:00Z', items: 2, error: null })
    expect(rows.Bona!.error).toMatch(/404/)
    expect(rows.Bona!.dataAt).toBeNull()
    expect(progress.some((p) => p.running && p.current === 'Antica')).toBe(true)
  })

  it('se salta los mundos sin escaneo nuevo y reintenta los que fallaron', async () => {
    bonaFails = false
    const s = await runSync({ worlds: null, force: false })
    expect(s).toMatchObject({ total: 2, imported: 1, unchanged: 1, failed: 0, error: null })
    expect(marketCalls().map((c) => new URL(c).searchParams.get('server'))).toEqual(['Bona'])
  })

  it('vuelve a bajar un mundo cuando tibiamarket publica otro escaneo o se fuerza', async () => {
    remoteUpdate = '2026-10-14T21:39:40'
    expect(await runSync({ worlds: null, force: false })).toMatchObject({ imported: 1, unchanged: 1 })
    expect(await runSync({ worlds: ['Bona'], force: true })).toMatchObject({ total: 1, imported: 1 })
    expect(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM market_quotes WHERE world_id = ?`, [requireWorld(db, 'Bona').id])!.n).toBe(1)
  })

  it('avisa si se pide un mundo que tibiamarket no publica', async () => {
    const s = await runSync({ worlds: ['Thyria'], force: false })
    expect(s.total).toBe(0)
    expect(s.error).toMatch(/no sigue Thyria/)
  })

  it('programa la revisión automática según Ajustes', () => {
    expect(sync.status().nextAutoAt).not.toBeNull()
  })
})
