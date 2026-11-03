// CLI de OCR (entregable de la Fase 0) y medición de exactitud contra un dataset anotado.
//
//   npm run ocr:eval -- --image captura.png --profile perfil.json        → imprime el OcrResult en JSON
//   npm run ocr:eval -- --dataset tests/ocr/fixtures/private             → exactitud por campo
//
// Dataset: por cada `nombre.png` un `nombre.json` con
//   { "profile": "ruta/al/perfil.json", "rows": [{ "side": "sell", "amount": 25, "unitPrice": 1000, "totalPrice": 25000 }],
//     "details": [{ "side": "sell", "field": "transactions", "value": 300 }] }
// El perfil es el JSON exportado desde la app (Revisión OCR → Editar → exportar). No se declara
// ninguna precisión sin este dataset.
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { runOcr } from '../src/core/ocr/pipeline'
import type { OcrProfile } from '../src/core/ocr/types'
import { decodePng } from './lib/png'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const loadProfile = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as OcrProfile

interface Expected {
  profile: string
  rows?: { side: 'buy' | 'sell'; amount: number; unitPrice: number; totalPrice?: number }[]
  details?: { side: 'buy' | 'sell'; field: string; value: number }[]
}

const image = arg('image')
const dataset = arg('dataset')

if (image) {
  const profilePath = arg('profile')
  if (!profilePath) throw new Error('Falta --profile')
  const result = runOcr(decodePng(readFileSync(image)), loadProfile(profilePath))
  console.log(JSON.stringify(result, null, 2))
} else if (dataset) {
  const dir = resolve(dataset)
  const counts: Record<string, { ok: number; total: number }> = {}
  const misses: string[] = []
  const hit = (field: string, ok: boolean, detail: string) => {
    counts[field] ??= { ok: 0, total: 0 }
    counts[field].total++
    if (ok) counts[field].ok++
    else misses.push(detail)
  }
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'))
  for (const f of files) {
    const expPath = join(dir, f.replace(/\.png$/i, '.json'))
    let exp: Expected
    try {
      exp = JSON.parse(readFileSync(expPath, 'utf8')) as Expected
    } catch {
      console.warn(`Sin anotación para ${f}, se omite`)
      continue
    }
    const result = runOcr(decodePng(readFileSync(join(dir, f))), loadProfile(resolve(dirname(expPath), exp.profile)))
    const rows = result.rows
    ;(exp.rows ?? []).forEach((e, i) => {
      const got = rows.filter((r) => r.side === e.side)[(exp.rows ?? []).filter((x, j) => x.side === e.side && j < i).length]
      hit('amount', got?.amount.value === e.amount, `${basename(f)} ${e.side}#${i} amount: esperado ${e.amount}, leído ${got?.amount.raw ?? '—'}`)
      hit('unitPrice', got?.unitPrice.value === e.unitPrice, `${basename(f)} ${e.side}#${i} precio: esperado ${e.unitPrice}, leído ${got?.unitPrice.raw ?? '—'}`)
      if (e.totalPrice !== undefined) hit('totalPrice', got?.totalPrice?.value === e.totalPrice, `${basename(f)} ${e.side}#${i} total: esperado ${e.totalPrice}, leído ${got?.totalPrice?.raw ?? '—'}`)
    })
    const extra = rows.length - (exp.rows ?? []).length
    if (extra > 0) misses.push(`${basename(f)}: ${extra} filas de más detectadas`)
    for (const d of exp.details ?? []) {
      const got = result.details.find((x) => x.side === d.side && x.field === d.field)
      hit(`details.${d.field}`, got?.value.value === d.value, `${basename(f)} ${d.side}.${d.field}: esperado ${d.value}, leído ${got?.value.raw ?? '—'}`)
    }
  }
  console.log(`Imágenes: ${files.length}`)
  for (const [field, c] of Object.entries(counts)) console.log(`${field.padEnd(22)} ${c.ok}/${c.total}  (${((100 * c.ok) / c.total).toFixed(2)} % exacto)`)
  if (misses.length) console.log('\nFallos:\n' + misses.map((m) => `  - ${m}`).join('\n'))
} else {
  console.log('Uso: npm run ocr:eval -- --image <png> --profile <perfil.json>  |  --dataset <carpeta>')
}
