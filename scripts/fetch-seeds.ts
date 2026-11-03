// Regenera los seeds de catálogo desde fuentes públicas.
// Uso: node scripts/fetch-seeds.ts   (Node >= 23.6, type stripping nativo)
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UA = 'TibiaTools/2.0 (personal desktop app; seed script)'
const SEED_DIR = join(import.meta.dirname, '..', 'seed')
const fetchedAt = new Date().toISOString()

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

function write(name: string, data: unknown): void {
  writeFileSync(join(SEED_DIR, name), JSON.stringify(data, null, 1) + '\n', 'utf8')
  console.log(`seed/${name} escrito`)
}

interface TmNpc { name: string; location: string; price: number; currency_object_type_id: number }
interface TmItem { id: number; category: string; tier: number; name: string; wiki_name: string | null; npc_buy: TmNpc[]; npc_sell: TmNpc[] }

async function items(): Promise<void> {
  const raw = (await getJson('https://api.tibiamarket.top/item_metadata')) as TmItem[]
  const npc = (list: TmNpc[]) => list.map((n) => ({ name: n.name, location: n.location, price: n.price, currencyId: n.currency_object_type_id }))
  write('items.json', {
    source: 'https://api.tibiamarket.top/item_metadata',
    fetchedAt,
    items: raw.map((i) => ({
      id: i.id,
      name: i.name,
      wikiName: i.wiki_name,
      category: i.category,
      tier: i.tier,
      npcBuy: npc(i.npc_buy),
      npcSell: npc(i.npc_sell),
    })),
  })
}

async function worlds(): Promise<void> {
  const td = (await getJson('https://api.tibiadata.com/v4/worlds')) as { worlds: { regular_worlds: Record<string, unknown>[] } }
  const tm = (await getJson('https://api.tibiamarket.top/world_data')) as { name: string; last_update: string }[]
  write('worlds.json', {
    sources: ['https://api.tibiadata.com/v4/worlds', 'https://api.tibiamarket.top/world_data'],
    fetchedAt,
    tibiadata: td.worlds.regular_worlds.map((w) => ({
      name: w.name,
      location: w.location,
      pvpType: w.pvp_type,
      battleyeProtected: w.battleye_protected,
      battleyeDate: w.battleye_date,
      transferType: w.transfer_type,
      gameWorldType: w.game_world_type,
      premiumOnly: w.premium_only,
    })),
    tibiamarketOnly: tm.map((w) => w.name).filter((n) => !td.worlds.regular_worlds.some((w) => w.name === n)),
  })
}

await items()
await worlds()
