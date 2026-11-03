import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { identifyItem } from '@core/ocr/match'
import { runOcr } from '@core/ocr/pipeline'
import type { OcrProfile } from '@core/ocr/types'
import itemsSeed from '@seed/items.json'
import defaultProfile from '@seed/ocr-profiles/market-offers-1920x1080.json'
import { decodePng } from '../../src/main/lib/png'

// Regresión con capturas reales del Market y el perfil por defecto. Las capturas no se versionan (muestran
// nombres de otros jugadores): sin ellas la prueba se salta. El perfil se calibró con estas mismas capturas,
// así que esto NO mide exactitud; la medición honesta (leave-one-out) la imprime `npm run ocr:calibrate`.

const DIR = resolve('tests/ocr/fixtures/private')
const samples = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.png') && existsSync(join(DIR, f.replace(/\.png$/, '.json')))) : []
const catalog = (itemsSeed as { items: { id: number; name: string }[] }).items

interface Truth {
  items: string[]
  selectedItem: number
  rows: { side: 'buy' | 'sell'; amount: number; unitPrice: number; totalPrice: number; endsAt: string }[]
}

describe.skipIf(samples.length === 0)('OCR con capturas reales del Market (perfil por defecto)', () => {
  it.each(samples)('%s: ventana, item y todas las ofertas', (file) => {
    const truth = JSON.parse(readFileSync(join(DIR, file.replace(/\.png$/, '.json')), 'utf8')) as Truth
    const r = runOcr(decodePng(readFileSync(join(DIR, file))), defaultProfile as OcrProfile)
    expect(r.marketFound).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.rows.map((x) => ({ side: x.side, amount: x.amount.value, unitPrice: x.unitPrice.value, totalPrice: x.totalPrice?.value, endsAt: x.endsAt?.raw }))).toEqual(truth.rows)
    expect(r.rows.every((x) => x.issues.length === 0)).toBe(true)
    expect(r.item?.selected?.index).toBe(truth.selectedItem)
    const id = identifyItem(r.item!.selected!.raw, catalog)
    expect(id).toMatchObject({ confident: true, best: { name: truth.items[truth.selectedItem] } })
  })
})
