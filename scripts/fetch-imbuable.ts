// Genera seed/imbuable_items.json: items del catálogo que admiten imbuements, con su cantidad de slots,
// su tipo y vocación (para saber qué imbuements acepta), desde la API de TibiaWiki EN.
// Uso: node scripts/fetch-imbuable.ts   (lotes de 50 títulos, ≥ 0.7 s entre pedidos, User-Agent propio)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UA = 'TibiaTools/2.0 (personal desktop app; +https://github.com/abelardoad29/TibiaTools)'
const API = 'https://tibia.fandom.com/api.php'
const SEED = join(import.meta.dirname, '..', 'seed')
// Solo categorías de equipo del catálogo: el resto no puede tener slots de imbuement.
const EQUIPMENT = new Set(['Armors', 'Helmets Hats', 'Legs', 'Boots', 'Shields', 'Swords', 'Axes', 'Clubs', 'Distance Weapons', 'Wands Rods', 'Fist Weapons', 'Containers', 'Quiver', 'Amulets', 'Rings'])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Page {
  title: string
  missing?: string
  revisions?: { slots: { main: { '*': string } } }[]
}
interface QueryResponse {
  query?: { pages: Record<string, Page>; normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[] }
}

async function pages(titles: string[]): Promise<{ byTitle: Map<string, string>; alias: Map<string, string> }> {
  const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&titles=${encodeURIComponent(titles.join('|'))}`
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const data = (await res.json()) as QueryResponse
  const byTitle = new Map<string, string>()
  for (const p of Object.values(data.query?.pages ?? {})) if (p.revisions?.[0]) byTitle.set(p.title, p.revisions[0].slots.main['*'])
  // Título pedido → título final (normalización y redirecciones).
  const alias = new Map<string, string>()
  for (const t of titles) alias.set(t, t)
  for (const n of data.query?.normalized ?? []) for (const [k, v] of alias) if (v === n.from) alias.set(k, n.to)
  for (const r of data.query?.redirects ?? []) for (const [k, v] of alias) if (v === r.from) alias.set(k, r.to)
  return { byTitle, alias }
}

const fieldOf = (content: string, name: string) => new RegExp(`^\\|\\s*${name}\\s*=\\s*(.*)$`, 'm').exec(content)?.[1]?.trim() || null

const catalog = JSON.parse(readFileSync(join(SEED, 'items.json'), 'utf8')) as { items: { id: number; name: string; wikiName: string | null; category: string }[] }
const imbuements = JSON.parse(readFileSync(join(SEED, 'imbuements.json'), 'utf8')) as { imbuements: { name: string }[] }

// 1) Tipos de item que acepta cada imbuement (campo `slots` de "Powerful X").
const slotTypes: Record<string, string[]> = {}
const imbPages = await pages(imbuements.imbuements.map((i) => `Powerful ${i.name}`))
for (const i of imbuements.imbuements) {
  const content = imbPages.byTitle.get(imbPages.alias.get(`Powerful ${i.name}`) ?? '')
  const slots = content ? fieldOf(content, 'slots') : null
  if (!slots) throw new Error(`Sin "slots" para Powerful ${i.name}`)
  slotTypes[i.name] = slots.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
}

// 2) Fichas de los items de equipo del catálogo.
const equipment = catalog.items.filter((i) => EQUIPMENT.has(i.category))
const titles = [...new Set(equipment.map((i) => i.wikiName ?? i.name))]
const info = new Map<string, { slots: number; type: string | null; vocations: string | null; wikiTitle: string }>()
for (let k = 0; k < titles.length; k += 50) {
  await sleep(700)
  const batch = titles.slice(k, k + 50)
  const r = await pages(batch)
  for (const t of batch) {
    const final = r.alias.get(t) ?? t
    const content = r.byTitle.get(final)
    if (!content) continue
    const slots = Number(fieldOf(content, 'imbueslots') ?? 0)
    if (!slots) continue
    info.set(t, { slots, type: fieldOf(content, 'primarytype'), vocations: fieldOf(content, 'vocrequired'), wikiTitle: final })
  }
  process.stdout.write(`\r${Math.min(k + 50, titles.length)}/${titles.length} fichas`)
}

const items = equipment
  .map((i) => ({ i, d: info.get(i.wikiName ?? i.name) }))
  .filter((x) => x.d)
  .map(({ i, d }) => ({ tibiaItemId: i.id, name: i.name, wikiTitle: d!.wikiTitle, slots: d!.slots, type: d!.type, vocations: d!.vocations }))
  .sort((a, b) => a.name.localeCompare(b.name))

writeFileSync(
  join(SEED, 'imbuable_items.json'),
  JSON.stringify({ source: `${API} (TibiaWiki EN: imbueslots, primarytype, vocrequired; slots de cada imbuement)`, fetchedAt: new Date().toISOString(), slotTypes, items }, null, 1) + '\n',
  'utf8',
)
console.log(`\nseed/imbuable_items.json: ${items.length} items imbuibles de ${equipment.length} de equipo; tipos:`, [...new Set(items.map((i) => i.type))].join(', '))
