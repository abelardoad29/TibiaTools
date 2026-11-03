import itemsSeed from '@seed/items.json'
import worldsSeed from '@seed/worlds.json'
import economicSeed from '@seed/economic_rules.json'
import physicalSeed from '@seed/items_physical.json'
import { normalizeName } from '@core/domain/catalog/names'
import { all, get, nowIso, run, tx, type Db } from './database'

interface SeedItem {
  id: number
  name: string
  wikiName: string | null
  category: string
  tier: number
  npcBuy: unknown[]
  npcSell: unknown[]
}

function needsLoad(db: Db, name: string, fetchedAt: string): boolean {
  const row = get<{ fetched_at: string }>(db, 'SELECT fetched_at FROM seed_versions WHERE name = ?', [name])
  return row?.fetched_at !== fetchedAt
}

function markLoaded(db: Db, name: string, fetchedAt: string): void {
  run(db, 'INSERT INTO seed_versions(name, fetched_at, loaded_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET fetched_at = excluded.fetched_at, loaded_at = excluded.loaded_at', [name, fetchedAt, nowIso()])
}

/** Carga los seeds versionados. Solo actualiza metadatos de catálogo: nunca pisa ediciones del usuario. */
export function loadSeeds(db: Db): void {
  const items = itemsSeed as { source: string; fetchedAt: string; items: SeedItem[] }
  if (needsLoad(db, 'items', items.fetchedAt)) {
    tx(db, () => {
      const stmt = db.prepare(`
        INSERT INTO items (tibia_item_id, name, normalized_name, wiki_name, category, tier, npc_buy_json, npc_sell_json, is_market_tradeable, source, verified_at)
        VALUES (:id, :name, :norm, :wiki, :cat, :tier, :buy, :sell, 1, :source, :at)
        ON CONFLICT(tibia_item_id) DO UPDATE SET
          name = excluded.name, normalized_name = excluded.normalized_name, wiki_name = excluded.wiki_name,
          category = excluded.category, tier = excluded.tier, npc_buy_json = excluded.npc_buy_json,
          npc_sell_json = excluded.npc_sell_json, source = excluded.source, verified_at = excluded.verified_at`)
      for (const i of items.items) {
        stmt.run({
          id: i.id,
          name: i.name,
          norm: normalizeName(i.name),
          wiki: i.wikiName,
          cat: i.category,
          tier: i.tier,
          buy: JSON.stringify(i.npcBuy),
          sell: JSON.stringify(i.npcSell),
          source: items.source,
          at: items.fetchedAt,
        })
      }
      markLoaded(db, 'items', items.fetchedAt)
    })
  }

  const worlds = worldsSeed as {
    fetchedAt: string
    tibiadata: { name: string; location: string; pvpType: string; battleyeProtected: boolean; battleyeDate: string; transferType: string; gameWorldType: string; premiumOnly: boolean }[]
    tibiamarketOnly: string[]
  }
  if (needsLoad(db, 'worlds', worlds.fetchedAt)) {
    tx(db, () => {
      for (const w of worlds.tibiadata) upsertTibiaDataWorld(db, w, 'seed:tibiadata', worlds.fetchedAt)
      for (const name of worlds.tibiamarketOnly) {
        run(db, `INSERT INTO worlds (name, is_active, source, updated_at) VALUES (?, 0, 'seed:tibiamarket', ?) ON CONFLICT(name) DO NOTHING`, [name, nowIso()])
      }
      markLoaded(db, 'worlds', worlds.fetchedAt)
    })
  }

  // Peso y apilable desde tibiawiki-sql (scripts/seed-tibiawiki-sql.py). Solo completa valores vacíos:
  // nunca pisa lo que el usuario editó. En Tibia los items apilables llegan a 100 por stack.
  const physical = physicalSeed as { source: string | null; generatedAt: string | null; items: { name: string; weightOz: number | null; stackable: boolean | null }[] }
  if (physical.generatedAt && needsLoad(db, 'items_physical', physical.generatedAt)) {
    tx(db, () => {
      const stmt = db.prepare(`UPDATE items SET weight_oz = COALESCE(weight_oz, :w), stack_size = COALESCE(stack_size, :s) WHERE normalized_name = :n`)
      for (const i of physical.items) stmt.run({ w: i.weightOz, s: i.stackable === null ? null : i.stackable ? 100 : 1, n: normalizeName(i.name) })
      markLoaded(db, 'items_physical', physical.generatedAt!)
    })
  }

  for (const r of economicSeed.rules) {
    const exists = get(db, 'SELECT 1 FROM economic_rule_versions WHERE rule_key = ?', [r.key])
    if (!exists) {
      run(db, 'INSERT INTO economic_rule_versions (rule_key, value_json, source_url, effective_from, verified_at, notes, created_at) VALUES (?,?,?,?,?,?,?)', [
        r.key,
        JSON.stringify(r.value),
        r.sourceUrl,
        r.effectiveFrom,
        r.verifiedAt,
        r.notes,
        nowIso(),
      ])
    }
  }
}

export function upsertTibiaDataWorld(
  db: Db,
  w: { name: string; location: string; pvpType: string; battleyeProtected: boolean; battleyeDate: string; transferType: string; gameWorldType: string; premiumOnly: boolean; isOnline?: boolean },
  source: string,
  at: string,
): void {
  run(
    db,
    `INSERT INTO worlds (name, region, pvp_type, battleye_protected, battleye_date, transfer_type, game_world_type, premium_only, is_online, is_active, source, verified_at, last_seen_in_tibiadata_at, updated_at)
     VALUES (:name, :region, :pvp, :be, :bed, :tt, :gwt, :prem, :online, 1, :source, :at, :at, :now)
     ON CONFLICT(name) DO UPDATE SET region = excluded.region, pvp_type = excluded.pvp_type, battleye_protected = excluded.battleye_protected,
       battleye_date = excluded.battleye_date, transfer_type = excluded.transfer_type, game_world_type = excluded.game_world_type,
       premium_only = excluded.premium_only, is_online = COALESCE(excluded.is_online, worlds.is_online), is_active = 1,
       source = excluded.source, verified_at = excluded.verified_at, last_seen_in_tibiadata_at = excluded.last_seen_in_tibiadata_at, updated_at = excluded.updated_at`,
    {
      name: w.name,
      region: w.location,
      pvp: w.pvpType,
      be: w.battleyeProtected,
      bed: w.battleyeDate || null,
      tt: w.transferType,
      gwt: w.gameWorldType,
      prem: w.premiumOnly,
      online: w.isOnline ?? null,
      source,
      at,
      now: nowIso(),
    },
  )
}

export function seedInfo(db: Db): Record<string, string> {
  return Object.fromEntries(all<{ name: string; fetched_at: string }>(db, 'SELECT name, fetched_at FROM seed_versions').map((r) => [r.name, r.fetched_at]))
}
