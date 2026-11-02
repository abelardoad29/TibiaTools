import type { ItemDetail, ItemSummary, NpcTrade, World } from '@shared/api'
import { matchScore, normalizeName } from '@core/domain/catalog/names'
import type { WorldTransferInfo } from '@core/domain/transfers/rules'
import { all, bool, get, nowIso, parseJson, run, tx, type Db } from '../db/database'
import { upsertTibiaDataWorld } from '../db/seed'
import { tibiaData } from '../external/tibiadata'
import type { AppContext } from '../context'

interface WorldRow {
  id: number
  name: string
  region: string | null
  pvp_type: string | null
  battleye_protected: number | null
  battleye_date: string | null
  transfer_type: string | null
  game_world_type: string | null
  premium_only: number | null
  is_active: number
  looser_transfer_conditions: number | null
  source: string | null
  verified_at: string | null
  updated_at: string
}

const toWorld = (r: WorldRow): World => ({
  id: r.id,
  name: r.name,
  region: r.region,
  pvpType: r.pvp_type,
  battleyeProtected: bool(r.battleye_protected),
  battleyeDate: r.battleye_date,
  transferType: r.transfer_type,
  gameWorldType: r.game_world_type,
  premiumOnly: bool(r.premium_only),
  isActive: r.is_active === 1,
  looserTransferConditions: bool(r.looser_transfer_conditions),
  source: r.source,
  verifiedAt: r.verified_at,
  updatedAt: r.updated_at,
})

export function listWorlds(db: Db, activeOnly: boolean): World[] {
  return all<WorldRow>(db, `SELECT * FROM worlds ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY name`).map(toWorld)
}

export function worldByName(db: Db, name: string): World | null {
  const r = get<WorldRow>(db, 'SELECT * FROM worlds WHERE name = ? COLLATE NOCASE', [name])
  return r ? toWorld(r) : null
}

export function requireWorld(db: Db, name: string): World {
  const w = worldByName(db, name)
  if (!w) throw new Error(`Mundo desconocido: ${name}`)
  return w
}

export function worldTransferInfo(w: World): WorldTransferInfo {
  return {
    name: w.name,
    pvpType: w.pvpType,
    battleyeDate: w.battleyeDate,
    battleyeProtected: w.battleyeProtected,
    transferType: w.transferType,
    gameWorldType: w.gameWorldType,
    looserTransferConditions: w.looserTransferConditions,
  }
}

export async function syncWorlds(ctx: AppContext): Promise<{ updated: number; fetchedAt: string }> {
  const r = await tibiaData(ctx.http).worlds()
  tx(ctx.db, () => {
    for (const w of r.data) {
      upsertTibiaDataWorld(
        ctx.db,
        {
          name: w.name,
          location: w.location,
          pvpType: w.pvp_type,
          battleyeProtected: w.battleye_protected,
          battleyeDate: w.battleye_date,
          transferType: w.transfer_type,
          gameWorldType: w.game_world_type,
          premiumOnly: w.premium_only,
          isOnline: w.status === 'online',
        },
        'tibiadata',
        r.fetchedAt,
      )
    }
    // Los mundos que TibiaData ya no lista quedan inactivos (fusionados o cerrados), no se borran.
    const names = r.data.map((w) => w.name)
    run(ctx.db, `UPDATE worlds SET is_active = 0, updated_at = ? WHERE name NOT IN (${names.map(() => '?').join(',')})`, [nowIso(), ...names])
  })
  return { updated: r.data.length, fetchedAt: r.fetchedAt }
}

export function setLooserConditions(db: Db, name: string, value: boolean | null): World {
  run(db, 'UPDATE worlds SET looser_transfer_conditions = ?, updated_at = ? WHERE name = ?', [value, nowIso(), name])
  return requireWorld(db, name)
}

// ---------- Items ----------

interface ItemRow {
  id: number
  tibia_item_id: number | null
  name: string
  normalized_name: string
  wiki_name: string | null
  category: string | null
  tier: number | null
  icon_status: string
  weight_oz: number | null
  stack_size: number | null
  npc_buy_json: string | null
  npc_sell_json: string | null
  source: string | null
}

export const iconUrl = (id: number) => `tt-img://item/${id}`

const toSummary = (r: ItemRow): ItemSummary => ({ id: r.id, tibiaItemId: r.tibia_item_id, name: r.name, category: r.category, tier: r.tier, iconUrl: iconUrl(r.id) })

let index: { db: Db; rows: ItemRow[] } | null = null
function itemIndex(db: Db): ItemRow[] {
  if (!index || index.db !== db) index = { db, rows: all<ItemRow>(db, 'SELECT * FROM items ORDER BY normalized_name, tibia_item_id') }
  return index.rows
}
export function invalidateItemIndex(): void {
  index = null
}

export function searchItems(db: Db, q: string, category: string | null, limit: number): ItemSummary[] {
  const rows = itemIndex(db).filter((r) => !category || r.category === category)
  if (!q.trim()) return rows.slice(0, limit).map(toSummary)
  return rows
    .map((r) => ({ r, s: Math.max(matchScore(q, r.name), r.wiki_name ? matchScore(q, r.wiki_name) - 5 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name))
    .slice(0, limit)
    .map((x) => toSummary(x.r))
}

export function getItem(db: Db, id: number): ItemDetail | null {
  const r = get<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', [id])
  if (!r) return null
  return {
    ...toSummary(r),
    wikiName: r.wiki_name,
    weightOz: r.weight_oz,
    stackSize: r.stack_size,
    npcBuy: parseJson<NpcTrade[]>(r.npc_buy_json, []),
    npcSell: parseJson<NpcTrade[]>(r.npc_sell_json, []),
    iconStatus: r.icon_status,
    source: r.source,
  }
}

export function itemsByName(db: Db, names: string[]): ItemSummary[] {
  const wanted = new Set(names.map(normalizeName))
  const seen = new Set<string>()
  // Ante nombres repetidos se prefiere el id más bajo (el item "base" del catálogo).
  return itemIndex(db)
    .filter((r) => wanted.has(r.normalized_name))
    .sort((a, b) => (a.tibia_item_id ?? 0) - (b.tibia_item_id ?? 0))
    .filter((r) => (seen.has(r.normalized_name) ? false : (seen.add(r.normalized_name), true)))
    .map(toSummary)
}

export function itemByTibiaId(db: Db, tibiaItemId: number): ItemSummary | null {
  const r = get<ItemRow>(db, 'SELECT * FROM items WHERE tibia_item_id = ?', [tibiaItemId])
  return r ? toSummary(r) : null
}

export function categories(db: Db): { category: string; count: number }[] {
  return all(db, `SELECT category, COUNT(*) AS count FROM items WHERE category IS NOT NULL GROUP BY category ORDER BY category`)
}

export function updateItem(db: Db, id: number, patch: { weightOz: number | null; stackSize: number | null; iconOverrideUrl: string | null }): ItemDetail {
  run(db, `UPDATE items SET weight_oz = ?, stack_size = ?, icon_override_url = ?, icon_status = CASE WHEN ? IS NOT NULL THEN 'override' ELSE icon_status END WHERE id = ?`, [
    patch.weightOz,
    patch.stackSize,
    patch.iconOverrideUrl,
    patch.iconOverrideUrl,
    id,
  ])
  invalidateItemIndex()
  const item = getItem(db, id)
  if (!item) throw new Error('Item no encontrado')
  return item
}

export const TIBIA_COINS_ID = 22118
