// Calibra el perfil OCR por defecto del Market (1920×1080, interfaz al 100 %) a partir de capturas reales
// transcritas a mano, y mide la exactitud de forma honesta: cada captura se lee con glifos aprendidos
// solo de las OTRAS capturas (leave-one-out). Al final escribe el perfil con los glifos de todas.
//
//   npm run ocr:calibrate                     → evalúa y escribe seed/ocr-profiles/market-offers-1920x1080.json
//   npm run ocr:calibrate -- --dataset <dir>  → otra carpeta de capturas anotadas
//
// Dataset: por cada `nombre.png` un `nombre.json` con
//   { "items": ["moonsilver trail hood", "silver token"], "selectedItem": 1,
//     "rows": [{ "side": "sell", "amount": 1, "unitPrice": 62786, "totalPrice": 62786, "endsAt": "2026-11-28, 17:53:56" }] }
// Las capturas reales (tests/ocr/fixtures/private) no se versionan: muestran nombres de otros jugadores.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { learnFromCell, learnFromItemEntry } from '../src/core/ocr/calibrate'
import { mergeAtlas } from '../src/core/ocr/glyphs'
import { binarize, crop, toGray, type Gray } from '../src/core/ocr/image'
import { runOcr } from '../src/core/ocr/pipeline'
import type { Glyph, OcrAnchor, OcrProfile, Preprocess } from '../src/core/ocr/types'
import { decodePng } from './lib/png'

const args = process.argv.slice(2)
const datasetArg = args.indexOf('--dataset')
const DATASET = resolve(datasetArg >= 0 ? args[datasetArg + 1]! : 'tests/ocr/fixtures/private')
const OUT = resolve('seed/ocr-profiles/market-offers-1920x1080.json')

// Geometría medida sobre las capturas (coordenadas absolutas con la ventana del Market en su posición inicial).
const ROW_H = 16
const ROWS = 11
const COLUMNS: OcrProfile['tables'][number]['columns'] = [
  { key: 'amount', x: 891, w: 128 },
  { key: 'unitPrice', x: 1021, w: 128 },
  { key: 'totalPrice', x: 1151, w: 128 },
  { key: 'endsAt', x: 1281, w: 150 },
]
const TABLES: OcrProfile['tables'] = [
  { side: 'sell', rect: { x: 647, y: 288, w: 784, h: ROW_H * ROWS }, columns: COLUMNS, rowHeight: ROW_H },
  { side: 'buy', rect: { x: 647, y: 519, w: 784, h: ROW_H * ROWS }, columns: COLUMNS, rowHeight: ROW_H },
]
const ITEM_LIST = { rect: { x: 477, y: 508, w: 145, h: 36 * 7 }, entryHeight: 36, iconWidth: 37, spaceGap: 3 }
const ANCHOR_RECT = { x: 645, y: 250, w: 76, h: 13 }
const ANCHOR_THRESHOLD = 140
const PREPROCESS: Preprocess = { threshold: 'auto', delta: 20, darkText: false, spaceGap: 4 }

interface Truth {
  items: string[]
  selectedItem: number
  rows: { side: 'buy' | 'sell'; amount: number; unitPrice: number; totalPrice: number; endsAt: string }[]
}
interface Sample {
  name: string
  gray: Gray
  rgba: ReturnType<typeof decodePng>
  truth: Truth
}

const fmt = (n: number) => n.toLocaleString('en-US')
const samples: Sample[] = readdirSync(DATASET)
  .filter((f) => f.toLowerCase().endsWith('.png'))
  .flatMap((f) => {
    let truth: Truth
    try {
      truth = JSON.parse(readFileSync(join(DATASET, f.replace(/\.png$/i, '.json')), 'utf8')) as Truth
    } catch {
      console.warn(`Sin anotación para ${f}, se omite`)
      return []
    }
    const rgba = decodePng(readFileSync(join(DATASET, f)))
    return [{ name: f, rgba, gray: toGray(rgba), truth }]
  })
if (samples.length < 2) throw new Error(`Se necesitan al menos 2 capturas anotadas en ${DATASET}`)

/** Glifos de tablas y de la lista de items aprendidos de un conjunto de capturas. */
function learn(set: Sample[]): { table: Glyph[]; letters: Glyph[]; errors: string[] } {
  const table: Glyph[] = []
  const letters: Glyph[] = []
  const errors: string[] = []
  const take = (r: ReturnType<typeof learnFromCell>, into: Glyph[], where: string) => {
    if ('error' in r) errors.push(`${where}: ${r.error}`)
    else into.push(...r.glyphs)
  }
  for (const s of set) {
    for (const t of TABLES) {
      s.truth.rows
        .filter((r) => r.side === t.side)
        .forEach((r, i) => {
          const y = t.rect.y + i * ROW_H
          const cell = (key: string) => {
            const c = COLUMNS.find((x) => x.key === key)!
            return { x: c.x, y, w: c.w, h: ROW_H }
          }
          take(learnFromCell(s.gray, cell('amount'), PREPROCESS, fmt(r.amount)), table, `${s.name} ${t.side}#${i} cantidad`)
          take(learnFromCell(s.gray, cell('unitPrice'), PREPROCESS, fmt(r.unitPrice)), table, `${s.name} ${t.side}#${i} precio`)
          take(learnFromCell(s.gray, cell('totalPrice'), PREPROCESS, fmt(r.totalPrice)), table, `${s.name} ${t.side}#${i} total`)
          take(learnFromCell(s.gray, cell('endsAt'), PREPROCESS, r.endsAt), table, `${s.name} ${t.side}#${i} fecha`)
        })
    }
    s.truth.items.forEach((name, i) => {
      const rect = { x: ITEM_LIST.rect.x + ITEM_LIST.iconWidth, y: ITEM_LIST.rect.y + i * ITEM_LIST.entryHeight, w: ITEM_LIST.rect.w - ITEM_LIST.iconWidth, h: ITEM_LIST.entryHeight }
      take(learnFromItemEntry(s.gray, rect, PREPROCESS, name), letters, `${s.name} item «${name}»`)
    })
  }
  return { table, letters, errors }
}

function anchorFrom(s: Sample): OcrAnchor {
  const b = binarize(crop(s.gray, ANCHOR_RECT), ANCHOR_THRESHOLD, false)
  return { ...ANCHOR_RECT, threshold: ANCHOR_THRESHOLD, bits: [...b.data].join(''), label: 'Sell Offers:' }
}

function profileFrom(set: Sample[]): OcrProfile {
  const { table, letters, errors } = learn(set)
  if (errors.length) throw new Error(`No se pudieron aprender glifos:\n  ${errors.join('\n  ')}`)
  return {
    id: null,
    name: 'Market 1920×1080 (por defecto)',
    screenType: 'offers',
    refWidth: 1920,
    refHeight: 1080,
    tables: TABLES,
    detailsFields: [],
    preprocess: PREPROCESS,
    atlas: mergeAtlas({ glyphs: [] }, table),
    anchor: anchorFrom(set[0]!),
    itemList: { ...ITEM_LIST, atlas: mergeAtlas({ glyphs: [] }, letters) },
    version: 1,
    updatedAt: null,
  }
}

// ---------- Evaluación leave-one-out ----------
const counts: Record<string, { ok: number; total: number }> = {}
const misses: string[] = []
const hit = (field: string, ok: boolean, detail: string) => {
  counts[field] ??= { ok: 0, total: 0 }
  counts[field].total++
  if (ok) counts[field].ok++
  else misses.push(detail)
}
for (const s of samples) {
  const profile = profileFrom(samples.filter((x) => x !== s))
  const t0 = performance.now()
  const r = runOcr(s.rgba, profile)
  const ms = performance.now() - t0
  hit('ventana del Market', r.marketFound, `${s.name}: no se encontró la ventana`)
  for (const side of ['sell', 'buy'] as const) {
    const exp = s.truth.rows.filter((x) => x.side === side)
    const got = r.rows.filter((x) => x.side === side)
    hit('número de filas', got.length === exp.length, `${s.name} ${side}: ${got.length} filas leídas, ${exp.length} esperadas`)
    exp.forEach((e, i) => {
      const g = got[i]
      const where = `${s.name} ${side}#${i}`
      hit('cantidad', g?.amount.value === e.amount, `${where} cantidad: esperado ${fmt(e.amount)}, leído «${g?.amount.raw ?? '—'}»`)
      hit('precio', g?.unitPrice.value === e.unitPrice, `${where} precio: esperado ${fmt(e.unitPrice)}, leído «${g?.unitPrice.raw ?? '—'}»`)
      hit('total', g?.totalPrice?.value === e.totalPrice, `${where} total: esperado ${fmt(e.totalPrice)}, leído «${g?.totalPrice?.raw ?? '—'}»`)
      hit('fecha (Ends At)', g?.endsAt?.raw === e.endsAt, `${where} fecha: esperado ${e.endsAt}, leído «${g?.endsAt?.raw ?? '—'}»`)
      hit('fila validada (cant × precio = total)', !!g && g.issues.length === 0, `${where}: ${g?.issues.join('; ') ?? 'sin fila'}`)
    })
  }
  const sel = r.item?.selected
  hit('item seleccionado (cuál)', sel?.index === s.truth.selectedItem, `${s.name}: seleccionado ${sel?.index ?? '—'}, esperado ${s.truth.selectedItem}`)
  const expName = s.truth.items[s.truth.selectedItem]!
  hit('nombre del item exacto', sel?.raw === expName, `${s.name}: nombre leído «${sel?.raw ?? '—'}», esperado «${expName}»`)
  console.log(`${s.name}: ${ms.toFixed(0)} ms, desplazamiento ${r.offset.dx},${r.offset.dy}, item leído «${sel?.raw ?? '—'}»`)
}
console.log(`\nLeave-one-out sobre ${samples.length} capturas (cada una leída con glifos de las demás):`)
for (const [field, c] of Object.entries(counts)) console.log(`  ${field.padEnd(40)} ${String(c.ok).padStart(3)}/${String(c.total).padEnd(3)} (${((100 * c.ok) / c.total).toFixed(1)} %)`)
if (misses.length) console.log('\nFallos:\n' + misses.map((m) => `  - ${m}`).join('\n'))

// ---------- Perfil final con todas las capturas ----------
const final = profileFrom(samples)
mkdirSync(resolve('seed/ocr-profiles'), { recursive: true })
writeFileSync(OUT, JSON.stringify(final) + '\n')
console.log(`\nPerfil escrito en ${OUT}: ${final.atlas.glyphs.length} glifos de tabla (${new Set(final.atlas.glyphs.map((g) => g.ch)).size} caracteres), ${final.itemList!.atlas.glyphs.length} glifos de nombres (${[...new Set(final.itemList!.atlas.glyphs.map((g) => g.ch))].sort().join('')})`)
