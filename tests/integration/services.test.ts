import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { all, get, openDatabase, schemaVersion, type Db } from '../../src/main/db/database'
import { loadSeeds } from '../../src/main/db/seed'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { makePaths, type AppContext } from '../../src/main/context'
import { createLogger } from '../../src/main/logging'
import { createHttpClient, USER_AGENT } from '../../src/main/external/http'
import { itemsByName, searchItems, requireWorld, itemByTibiaId } from '../../src/main/services/catalog'
import { addCharacter } from '../../src/main/services/tools'
import { createTibiaFolderWatcher, parseTibiaScreenshot } from '../../src/main/services/tibia-folder'
import { setSettings, getSettings } from '../../src/main/services/settings'
import { imageSize, saveEvidence } from '../../src/main/services/evidence'
import { confirmScan, saveProfile, listProfiles } from '../../src/main/services/scans'
import { bookView, history, importThirdParty } from '../../src/main/services/market'
import { runAnalysis, transferCost, addRule, routeEvaluation, buildCarts, exportRun } from '../../src/main/services/analysis'
import { createBackup, validateBackup } from '../../src/main/services/backup'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

// PNG mínimo válido de 2×3 (solo la cabecera importa para imageSize; el resto es evidencia opaca).
function fakePng(seed: number, w = 2, h = 3): Uint8Array {
  const b = new Uint8Array(40)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  b[39] = seed
  return b
}

let dir: string
let db: Db
let ctx: AppContext
const calls: string[] = []

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-test-'))
  const paths = makePaths(dir)
  db = openDatabase(':memory:')
  loadSeeds(db)
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push(`${u} UA=${new Headers(init?.headers).get('User-Agent')}`)
    if (u.includes('/market_values')) {
      return new Response(JSON.stringify([{ id: 3031, time: 1_792_000_000, buy_offer: 1, sell_offer: 2, month_sold: 300, month_average_sell: 2, month_bought: -1 }]), { status: 200 })
    }
    if (u.includes('/character/')) return new Response('error code: 502', { status: 502 })
    if (u.includes('/market_board')) {
      return new Response(JSON.stringify({ id: 22118, update_time: 1_792_012_876, sellers: [{ name: 'Anonymous', amount: 150, price: 44_098, time: 1_794_604_679 }], buyers: [{ name: 'Anonymous', amount: 25, price: 42_821, time: 1_794_604_499 }] }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  ctx = { db, paths, http: createHttpClient(db, createLogger(null), fakeFetch, { 'api.tibiamarket.top': 0, 'api.tibiadata.com': 0 }), log: createLogger(null), version: 'test', now: () => new Date() }
})

afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('base de datos', () => {
  it('migra a la última versión con foreign keys activas', () => {
    expect(schemaVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(get<{ foreign_keys: number }>(db, 'PRAGMA foreign_keys')!.foreign_keys).toBe(1)
    const idx = all<{ name: string }>(db, `SELECT name FROM sqlite_master WHERE type = 'index'`).map((r) => r.name)
    for (const i of ['idx_scans_world_item', 'idx_offers_scan', 'idx_events_world_item', 'idx_tc_world', 'idx_opps_run', 'idx_transfer_rules']) expect(idx).toContain(i)
  })
  it('carga seeds sin duplicar y es idempotente', () => {
    const n = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM items')!.n
    expect(n).toBeGreaterThan(5_000)
    loadSeeds(db)
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM items')!.n).toBe(n)
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM worlds WHERE is_active = 1')!.n).toBe(90)
    expect(get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM economic_rule_versions WHERE rule_key = 'market_fee'`)!.n).toBe(1)
  })
  it('rechaza precios no positivos (CHECK)', () => {
    expect(() => db.exec(`INSERT INTO market_offers (scan_id, offer_type, unit_price_gp, amount, created_at) VALUES ('x','sell',0,1,'')`)).toThrow()
  })
})

describe('catálogo', () => {
  it('búsqueda difusa y nombres repetidos', () => {
    expect(searchItems(db, 'vampire teeth', null, 5)[0]!.name.toLowerCase()).toBe('vampire teeth')
    expect(itemsByName(db, ['Great Mana Potion'])).toHaveLength(1)
  })
})

describe('captura → OCR revisado → snapshot → eventos', () => {
  it('guarda evidencia con sha256 y no duplica', () => {
    expect(imageSize(fakePng(1, 1920, 1080))).toEqual({ width: 1920, height: 1080, format: 'png' })
    const a = saveEvidence(ctx, fakePng(1), { mode: 'manual', ext: '.png', region: null, screenType: 'offers', worldId: null, itemId: null, maxPixels: 1e8 })
    const b = saveEvidence(ctx, fakePng(1), { mode: 'manual', ext: '.png', region: null, screenType: 'offers', worldId: null, itemId: null, maxPixels: 1e8 })
    expect(b.id).toBe(a.id)
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(() => saveEvidence(ctx, fakePng(9, 10_000, 10_000), { mode: 'manual', ext: '.png', region: null, screenType: null, worldId: null, itemId: null, maxPixels: 1e6 })).toThrow(/grande/)
  })

  it('confirma dos snapshots y genera eventos inferidos, nunca ventas', () => {
    const antica = requireWorld(db, 'Antica')
    const item = itemsByName(db, ['Vampire Teeth'])[0]!
    const profile = saveProfile(db, {
      id: null,
      name: 'test',
      screenType: 'offers',
      refWidth: 2,
      refHeight: 3,
      tables: [
        { side: 'sell', rect: { x: 0, y: 0, w: 2, h: 1 }, columns: [], rowHeight: null },
        { side: 'buy', rect: { x: 0, y: 1, w: 2, h: 1 }, columns: [], rowHeight: null },
      ],
      detailsFields: [],
      preprocess: { threshold: 'otsu', darkText: false, spaceGap: 3 },
      atlas: { glyphs: [] },
      version: 0,
      updatedAt: null,
    })
    expect(listProfiles(db)[0]!.version).toBe(1)
    const offer = (side: 'buy' | 'sell', unitPrice: number, amount: number, rowIndex: number, corrected = false) => ({
      side,
      rowIndex,
      unitPrice,
      amount,
      totalPrice: unitPrice * amount,
      expirationText: null,
      rawPriceText: String(unitPrice),
      rawAmountText: String(amount),
      priceConfidence: 0.99,
      amountConfidence: 0.99,
      corrections: corrected ? [{ field: 'unitPrice', raw: '1,O00', ocrValue: '', corrected: String(unitPrice) }] : [],
    })
    const s1 = saveEvidence(ctx, fakePng(2), { mode: 'manual', ext: '.png', region: null, screenType: 'offers', worldId: antica.id, itemId: item.id, maxPixels: 1e8 })
    confirmScan(db, { screenshotId: s1.id, profileId: profile.id, worldId: antica.id, itemId: item.id, screenType: 'offers', ocrVersion: 't', parserVersion: 't', offers: [offer('sell', 1_000, 10, 0, true), offer('sell', 1_100, 5, 1), offer('buy', 900, 20, 0)], stats: [] }, ['sell', 'buy'])
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM ocr_field_reviews')!.n).toBe(1)
    expect(() => confirmScan(db, { screenshotId: s1.id, profileId: null, worldId: antica.id, itemId: item.id, screenType: 'offers', ocrVersion: 't', parserVersion: 't', offers: [], stats: [] }, ['sell'])).toThrow(/ya fue confirmada/)

    // El segundo snapshot debe ser posterior en el tiempo.
    ctx.now = () => new Date(Date.now() + 60_000)
    const s2 = saveEvidence(ctx, fakePng(3), { mode: 'manual', ext: '.png', region: null, screenType: 'offers', worldId: antica.id, itemId: item.id, maxPixels: 1e8 })
    const r = confirmScan(db, { screenshotId: s2.id, profileId: profile.id, worldId: antica.id, itemId: item.id, screenType: 'offers', ocrVersion: 't', parserVersion: 't', offers: [offer('sell', 1_000, 4, 0), offer('buy', 900, 20, 0)], stats: [] }, ['sell', 'buy'])
    expect(r.events).toBeGreaterThan(0)
    const types = all<{ event_type: string }>(db, 'SELECT event_type FROM market_events').map((e) => e.event_type)
    expect(types).toContain('possibly_filled')
    expect(types.some((t) => t.includes('sold'))).toBe(false)
    const book = bookView(db, 'Antica', item.id, false)
    expect(book.sell!.offers.map((o) => o.amount)).toEqual([4])
    expect(history(db, 'Antica', item.id, 30, false).points.length).toBe(2)
  })
})

describe('datos de terceros', () => {
  it('importa quotes, stats y order book con User-Agent propio', async () => {
    const r = await importThirdParty(ctx, 'Antica', [22118])
    expect(r.errors).toEqual([])
    expect(r.scans).toBe(1)
    expect(r.offers).toBe(2)
    expect(calls.every((c) => c.includes(`UA=${USER_AGENT}`))).toBe(true)
    const tc = itemByTibiaId(db, 22118)!
    const book = bookView(db, 'Antica', tc.id, true)
    expect(book.sell!.source).toBe('third_party')
    expect(book.sell!.offers[0]!.expiresAt).toBe(new Date(1_794_604_679_000).toISOString())
    expect(bookView(db, 'Antica', tc.id, false).sell).toBeNull()
    // Reimportar el mismo board no duplica
    const again = await importThirdParty(ctx, 'Antica', [22118])
    expect(again.scans).toBe(0)
  })
  it('valores -1 de la API se guardan como desconocidos', () => {
    const row = get<{ transactions: number | null }>(db, `SELECT transactions FROM market_stats WHERE side = 'buy' AND stat_window = '30d' AND source = 'third_party'`)
    expect(row === undefined || row.transactions === null).toBe(true)
  })
})

describe('análisis de punta a punta', () => {
  it('Instant entre dos mundos, con costo de transferencia por TC del origen', () => {
    const item = itemsByName(db, ['Vampire Teeth'])[0]!
    const dest = requireWorld(db, 'Bona')
    const shot = saveEvidence(ctx, fakePng(4), { mode: 'manual', ext: '.png', region: null, screenType: 'offers', worldId: dest.id, itemId: item.id, maxPixels: 1e8 })
    confirmScan(db, { screenshotId: shot.id, profileId: null, worldId: dest.id, itemId: item.id, screenType: 'offers', ocrVersion: 't', parserVersion: 't', offers: [{ side: 'buy', rowIndex: 0, unitPrice: 1_500, amount: 3, totalPrice: 4_500, expirationText: null, rawPriceText: '1,500', rawAmountText: '3', priceConfidence: 1, amountConfidence: 1, corrections: [] }], stats: [] }, ['buy'])

    const res = runAnalysis(ctx, { origin: 'Antica', destination: 'Bona', strategy: 'instant', budgetGp: null, maxQuantityPerItem: null, includeThirdParty: true, maxAgeHours: null }, DEFAULT_SETTINGS)
    const opp = res.opportunities.find((o) => o.itemId === item.id)!
    expect(opp.quantity).toBe(3)
    expect(opp.netProfit).toBe(3 * (1_500 - 1_000))
    expect(opp.marketFees).toBe(0) // aceptar ofertas no paga comisión
    expect(res.route.status).toBeDefined()
    expect(res.transferCost.gp).toBeNull() // precio en TC sin configurar
    expect(routeEvaluation(ctx, 'Antica', 'Antica').status).toBe('blocked')

    addRule(db, 'transfer_cost_tc', { regular: 100, express: 200 }, 'https://www.tibia.com', 'test', '2026-11-02')
    const cost = transferCost(ctx, 'Antica', 'regular', true)
    expect(cost.gp).toBe(100 * 44_098) // compra de 100 TC contra sell offers (150 a 44,098)
    expect(transferCost(ctx, 'Antica', 'regular', false).gp).toBeNull() // sin terceros no hay cotización

    const carts = buildCarts(ctx, res.runId, { budgetGp: 1_000_000, transferCostGp: 0, minRoi: 0, minConfidenceScore: 0, maxQuantityPerItem: null, capacityOz: null, slots: null })
    expect(carts[0]!.lines.find((l) => l.itemId === item.id)!.quantity).toBe(3)

    const csv = exportRun(ctx, res.runId, 'csv')
    expect(csv.endsWith('.csv')).toBe(true)
  })
})

describe('personajes', () => {
  it('un nombre inexistente (TibiaData responde 502) falla rápido, sin reintentos', async () => {
    const before = calls.filter((c) => c.includes('/character/')).length
    const t0 = Date.now()
    await expect(addCharacter(ctx, 'Zzqx Nadie')).rejects.toThrow(/No existe un personaje/)
    expect(Date.now() - t0).toBeLessThan(1_500)
    expect(calls.filter((c) => c.includes('/character/')).length - before).toBe(1)
  })
})

describe('carpeta de screenshots de Tibia', () => {
  it('lee el nombre de archivo del cliente', () => {
    const n = parseTibiaScreenshot('2026-11-02_094500772_Desperdicio de Barro_Hotkey.png')!
    expect(n.character).toBe('Desperdicio de Barro')
    expect(n.type).toBe('Hotkey')
    expect(n.takenAt.getTime()).toBe(new Date(2026, 10, 2, 9, 45, 0, 772).getTime())
    expect(parseTibiaScreenshot('captura.png')).toBeNull()
  })

  it('importa solo las de la tecla de screenshot, sin duplicar, y vigila archivos nuevos', async () => {
    const folder = join(dir, 'tibia-shots')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, '2026-11-02_094500772_Abe_Hotkey.png'), fakePng(41))
    writeFileSync(join(folder, '2026-11-02_094600000_Abe_LevelUp.png'), fakePng(42))
    writeFileSync(join(folder, 'otra.png'), fakePng(43))
    const c = getSettings(db).collector
    setSettings(db, { collector: { ...c, tibiaFolder: { enabled: true, path: folder, types: ['Hotkey'] } } })
    const seen: string[] = []
    const w = createTibiaFolderWatcher(ctx, (shots) => seen.push(...shots.map((s) => s.id)))
    expect(w.status()).toMatchObject({ exists: true, matchingFiles: 1 })
    const first = w.importExisting(null)
    expect(first.imported).toHaveLength(1)
    expect(first.imported[0]!.capturedAtUtc).toBe(new Date(2026, 10, 2, 9, 45, 0, 772).toISOString())
    expect(w.importExisting(null)).toMatchObject({ skipped: 1, imported: [] })

    w.restart()
    expect(w.status().watching).toBe(true)
    const before = seen.length
    writeFileSync(join(folder, '2026-11-02_100000000_Abe_Hotkey.png'), fakePng(44))
    for (let i = 0; i < 40 && seen.length === before; i++) await new Promise((r) => setTimeout(r, 100))
    w.stop()
    expect(seen.length).toBe(before + 1)
  })
})

describe('backup', () => {
  it('crea un respaldo consistente y valida su esquema', () => {
    const fileDb = openDatabase(join(dir, 'file.db'))
    loadSeeds(fileDb)
    const backup = createBackup(fileDb, makePaths(dir))
    expect(validateBackup(backup)).toBe(MIGRATIONS.at(-1)!.version)
    fileDb.close()
    const bogus = join(dir, 'bogus.db')
    writeFileSync(bogus, 'no soy sqlite')
    expect(() => validateBackup(bogus)).toThrow()
  })
})
