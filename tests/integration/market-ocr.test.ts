import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ScreenshotAnalysis } from '@shared/api'
import { all, get, nowIso, openDatabase, run, type Db } from '../../src/main/db/database'
import { loadSeeds } from '../../src/main/db/seed'
import { makePaths, type AppContext } from '../../src/main/context'
import { createLogger } from '../../src/main/logging'
import { createHttpClient } from '../../src/main/external/http'
import { encodePng } from '../../src/main/lib/png'
import { getScreenshot, saveEvidenceDetailed } from '../../src/main/services/evidence'
import { createMarketAnalyzer } from '../../src/main/services/market-ocr'
import { ensureDefaultProfiles, getProfile, saveProfile } from '../../src/main/services/scans'
import { anchoredProfile, blank, marketWindow, ROWS3 } from '../ocr/synthetic'

// Análisis automático de capturas del Market con imágenes sintéticas (la fuente de prueba solo tiene dígitos,
// así que el "item" del catálogo de prueba se llama «34»).

let dir: string
let db: Db
let ctx: AppContext
let profileId: number
const analyzed: ScreenshotAnalysis[] = []
let confirmedCallbacks = 0

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-mocr-'))
  db = openDatabase(':memory:')
  loadSeeds(db)
  ctx = { db, paths: makePaths(dir), http: createHttpClient(db, createLogger(null), (async () => new Response('{}', { status: 404 })) as typeof fetch), log: createLogger(null), version: 'test', now: () => new Date() }
  run(db, `INSERT INTO items (tibia_item_id, name, normalized_name, category, tier, npc_buy_json, npc_sell_json, is_market_tradeable, source, verified_at) VALUES (990001, '34', '34', 'Test', -1, '[]', '[]', 1, 'test', ?)`, [nowIso()])
  profileId = saveProfile(db, { ...anchoredProfile(), id: null, name: 'sintético con ancla' }).id!
})
afterAll(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const analyzer = () =>
  createMarketAnalyzer(ctx, {
    lookupWorld: async (character) => (character === 'Enemigo Uno' ? 'Antica' : null),
    onAnalyzed: (_id, a) => analyzed.push(a),
    onConfirmed: () => confirmedCallbacks++,
  })

let seq = 0
function importShot(img: ReturnType<typeof blank>, character: string | null): string {
  seq++
  const file = `2026-12-02_1551411${String(seq).padStart(2, '0')}_${character}_Hotkey.png`
  return saveEvidenceDetailed(ctx, encodePng(img), {
    mode: 'import',
    ext: '.png',
    region: null,
    screenType: null,
    worldId: null,
    itemId: null,
    maxPixels: 10_000_000,
    capturedAt: new Date(Date.UTC(2026, 11, 2, 15, 51, seq)),
    notes: character ? `Tibia: ${character} · Hotkey · ${file}` : undefined,
  }).shot.id
}

describe('análisis automático de capturas del Market', () => {
  it('guarda solo el snapshot cuando ventana, item, mundo y filas cuadran', async () => {
    const id = importShot(marketWindow(23, 9, ROWS3, [{ name: ['12'], bg: 64 }, { name: ['34'], bg: 88 }]), 'Enemigo Uno')
    expect(await analyzer().analyze([id])).toEqual({ analyzed: 1, confirmed: 1, review: 0, notMarket: 0 })
    const shot = getScreenshot(db, id)!
    expect(shot.status).toBe('confirmed')
    expect(shot.analysis).toMatchObject({ decision: 'confirmed', itemRead: '34', world: 'Antica', character: 'Enemigo Uno', rows: 3, offset: { dx: 23, dy: 9 }, reasons: [] })
    const scan = get<{ id: string; world: string; item: string; source: string }>(
      db,
      `SELECT s.id, w.name AS world, i.name AS item, s.source FROM market_scans s JOIN worlds w ON w.id = s.world_id JOIN items i ON i.id = s.item_id WHERE s.screenshot_id = ?`,
      [id],
    )!
    expect(scan).toMatchObject({ world: 'Antica', item: '34', source: 'own_capture' })
    expect(all<{ unit_price_gp: number }>(db, 'SELECT unit_price_gp FROM market_offers WHERE scan_id = ? ORDER BY row_index', [scan.id]).map((o) => o.unit_price_gp)).toEqual([1_000, 1_005, 1_010])
    expect(confirmedCallbacks).toBe(1)
  })

  it('deja para revisar, prellenada y con motivos, si el item no está en el catálogo o una fila no cuadra', async () => {
    const unknown = importShot(marketWindow(0, 0, ROWS3, [{ name: ['5,6'], bg: 64 }]), 'Enemigo Uno')
    const badRow = importShot(marketWindow(0, 0, [{ ...ROWS3[0]!, total: '25,001' }], [{ name: ['34'], bg: 64 }]), 'Enemigo Uno')
    const noWorld = importShot(marketWindow(0, 0, ROWS3, [{ name: ['34'], bg: 64 }]), 'Nadie Existe')
    expect(await analyzer().analyze([unknown, badRow, noWorld])).toMatchObject({ analyzed: 3, confirmed: 0, review: 3 })

    const a = getScreenshot(db, unknown)!
    expect(a.status).toBe('processed')
    expect(a.analysis?.reasons.join()).toMatch(/Item (dudoso|no reconocido)/)
    expect(a.worldId).toBe(get<{ id: number }>(db, `SELECT id FROM worlds WHERE name = 'Antica'`)!.id)

    const b = getScreenshot(db, badRow)!
    expect(b.analysis?.reasons.join()).toMatch(/fila\(s\) con errores: Total/)
    expect(b.itemId).toBe(b.analysis?.item?.id)

    expect(getScreenshot(db, noWorld)!.analysis?.reasons.join()).toMatch(/No se pudo saber el mundo de Nadie Existe/)
  })

  it('descarta los screenshots de Tibia que no muestran el Market', async () => {
    const id = importShot(blank(480, 170), 'Enemigo Uno')
    expect(await analyzer().analyze([id])).toMatchObject({ notMarket: 1 })
    expect(getScreenshot(db, id)).toMatchObject({ status: 'rejected', analysis: { decision: 'not_market' } })
  })

  it('aprende las letras que faltaban cuando el item se identifica sin dudas', async () => {
    const p = getProfile(db, profileId)!
    // El perfil "olvida" el 4: lee «3?» y aun así identifica «34» (única opción), lo guarda y aprende el 4.
    saveProfile(db, { ...p, itemList: { ...p.itemList!, atlas: { glyphs: p.itemList!.atlas.glyphs.filter((g) => g.ch !== '4') } } })
    const id = importShot(marketWindow(5, 5, [ROWS3[1]!], [{ name: ['34'], bg: 64 }]), 'Enemigo Uno')
    await analyzer().analyze([id])
    expect(getScreenshot(db, id)!.analysis).toMatchObject({ decision: 'confirmed', itemRead: '3?', item: { name: '34' } })
    expect(getProfile(db, profileId)!.itemList!.atlas.glyphs.some((g) => g.ch === '4')).toBe(true)
  })
})

// Capturas reales (no versionadas): el flujo completo de main con el perfil por defecto y el catálogo real.
const REAL = resolve('tests/ocr/fixtures/private')
const realShots = existsSync(REAL) ? readdirSync(REAL).filter((f) => f.endsWith('.png') && existsSync(join(REAL, f.replace(/\.png$/, '.json')))) : []

describe.skipIf(realShots.length === 0)('análisis automático con capturas reales del Market', () => {
  it.each(realShots)('%s se guarda solo con el item y las ofertas correctas', async (file) => {
    ensureDefaultProfiles(db)
    const truth = JSON.parse(readFileSync(join(REAL, file.replace(/\.png$/, '.json')), 'utf8')) as { items: string[]; selectedItem: number; rows: unknown[] }
    seq++
    const id = saveEvidenceDetailed(ctx, new Uint8Array(readFileSync(join(REAL, file))), {
      mode: 'import',
      ext: '.png',
      region: null,
      screenType: null,
      worldId: null,
      itemId: null,
      maxPixels: 10_000_000,
      capturedAt: new Date(Date.UTC(2026, 11, 2, 16, 0, seq)),
      notes: `Tibia: Enemigo Uno · Hotkey · 2026-12-02_160000000_Enemigo Uno_Hotkey.png`,
    }).shot.id
    // Con dos perfiles con ancla manda el de la app.
    expect(await analyzer().analyze([id])).toMatchObject({ confirmed: 1 })
    const shot = getScreenshot(db, id)!
    expect(shot.analysis).toMatchObject({ decision: 'confirmed', item: { name: truth.items[truth.selectedItem], confident: true }, world: 'Antica', rows: truth.rows.length })
    const offers = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM market_offers o JOIN market_scans s ON s.id = o.scan_id WHERE s.screenshot_id = ?`, [id])!.n
    expect(offers).toBe(truth.rows.length)
  })
})
