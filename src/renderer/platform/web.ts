import type { Channel, In, ItemSummary, Out, World } from '@shared/api'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings'
import { matchScore, normalizeName, wikiFileName } from '@core/domain/catalog/names'
import { PlatformError, type PlatformApi } from './types'

// Implementación para la PWA companion: herramientas, catálogo (desde seeds) y TibiaData directo.
// Collector, base de datos de Market y análisis viven solo en la app de escritorio.

interface SeedItem {
  id: number
  name: string
  wikiName: string | null
  category: string
  tier: number
  npcBuy: { name: string; location: string; price: number; currencyId: number }[]
  npcSell: { name: string; location: string; price: number; currencyId: number }[]
}

let itemsCache: SeedItem[] | null = null
async function seedItems(): Promise<SeedItem[]> {
  if (!itemsCache) itemsCache = ((await import('@seed/items.json')).default as { items: SeedItem[] }).items
  return itemsCache
}

const wikiIcon = (i: SeedItem) => `https://www.tibiawiki.com.br/wiki/Special:FilePath/${encodeURIComponent(wikiFileName(i.wikiName ?? i.name))}.gif`
const summary = (i: SeedItem): ItemSummary => ({ id: i.id, tibiaItemId: i.id, name: i.name, category: i.category, tier: i.tier, iconUrl: wikiIcon(i) })

const SETTINGS_KEY = 'tibia-tools.settings'
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? mergeSettings(DEFAULT_SETTINGS, JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

async function tibiaData<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.tibiadata.com/v4${path}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new PlatformError('external', `TibiaData respondió ${res.status}`)
  return res.json() as Promise<T>
}

type WebHandlers = { [C in Channel]?: (input: In<C>) => Promise<Out<C>> }

const handlers: WebHandlers = {
  'app.info': async () => ({
    version: __APP_VERSION__,
    platform: 'web',
    dataDir: 'navegador',
    dbPath: '—',
    schemaVersion: 0,
    counts: { worlds: 0, items: (await seedItems()).length, scans: 0, screenshots: 0, ownScans: 0, thirdPartyScans: 0 },
    seeds: { items: null, worlds: null, imbuements: null },
  }),
  'app.settings.get': async () => loadSettings(),
  'app.settings.set': async (patch) => {
    const next = mergeSettings(loadSettings(), patch)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // almacenamiento no disponible: se usa solo en memoria
    }
    return next
  },
  'catalog.items.search': async ({ q, category, limit }) => {
    const rows = (await seedItems()).filter((i) => !category || i.category === category)
    if (!q.trim()) return rows.slice(0, limit).map(summary)
    return rows
      .map((i) => ({ i, s: matchScore(q, i.name) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => summary(x.i))
  },
  'catalog.items.get': async ({ id }) => {
    const i = (await seedItems()).find((x) => x.id === id)
    return i ? { ...summary(i), wikiName: i.wikiName, weightOz: null, stackSize: null, npcBuy: i.npcBuy, npcSell: i.npcSell, iconStatus: 'remote', source: 'seed' } : null
  },
  'catalog.items.byName': async ({ names }) => {
    const wanted = new Set(names.map(normalizeName))
    const seen = new Set<string>()
    return (await seedItems()).filter((i) => wanted.has(normalizeName(i.name)) && !seen.has(normalizeName(i.name)) && seen.add(normalizeName(i.name))).map(summary)
  },
  'catalog.items.categories': async () => {
    const counts = new Map<string, number>()
    for (const i of await seedItems()) counts.set(i.category, (counts.get(i.category) ?? 0) + 1)
    return [...counts].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category))
  },
  'catalog.worlds.list': async () => {
    const seed = (await import('@seed/worlds.json')).default as { fetchedAt: string; tibiadata: { name: string; location: string; pvpType: string; battleyeProtected: boolean; battleyeDate: string; transferType: string; gameWorldType: string; premiumOnly: boolean }[] }
    return seed.tibiadata.map(
      (w, i): World => ({
        id: i + 1,
        name: w.name,
        region: w.location,
        pvpType: w.pvpType,
        battleyeProtected: w.battleyeProtected,
        battleyeDate: w.battleyeDate,
        transferType: w.transferType,
        gameWorldType: w.gameWorldType,
        premiumOnly: w.premiumOnly,
        isActive: true,
        looserTransferConditions: null,
        source: 'seed',
        verifiedAt: seed.fetchedAt,
        updatedAt: seed.fetchedAt,
      }),
    )
  },
  'tools.boosted': async () => {
    try {
      const [c, b] = await Promise.all([
        tibiaData<{ creatures?: { boosted?: { name: string; image_url?: string } } }>('/creatures'),
        tibiaData<{ boostable_bosses?: { boosted?: { name: string; image_url?: string } } }>('/boostablebosses'),
      ])
      const pick = (x?: { name: string; image_url?: string }) => (x ? { name: x.name, imageUrl: x.image_url ?? null } : null)
      return { creature: pick(c.creatures?.boosted), boss: pick(b.boostable_bosses?.boosted), fetchedAt: new Date().toISOString(), source: 'TibiaData', error: null }
    } catch (e) {
      return { creature: null, boss: null, fetchedAt: null, source: 'TibiaData', error: e instanceof Error ? e.message : String(e) }
    }
  },
  'tools.character': async ({ name }) => {
    const d = await tibiaData<{ character?: { character?: { name: string; world: string; level: number; vocation: string }; deaths?: { time: string; level: number; reason: string }[] } }>(`/character/${encodeURIComponent(name)}`)
    const ch = d.character?.character
    return ch ? { ...ch, deaths: d.character?.deaths ?? [] } : null
  },
  'tools.imbuements': async () => {
    const s = (await import('@seed/imbuements.json')).default as unknown as Out<'tools.imbuements'>
    return { tiers: s.tiers, imbuements: s.imbuements, tokenTradeable: s.tokenTradeable, tokensPerTier: s.tokensPerTier, durationHours: s.durationHours, source: s.source, notes: s.notes }
  },
  'tools.imbuements.prices': async ({ items }) => Object.fromEntries(items.map((n) => [n, null])),
  'tools.imbuable': async () => {
    const s = (await import('@seed/imbuable_items.json')).default as { source: string; fetchedAt: string; slotTypes: Record<string, string[]>; items: { tibiaItemId: number; slots: number; type: string | null; vocations: string | null }[] }
    const byId = new Map((await seedItems()).map((i) => [i.id, i]))
    const items = s.items.flatMap((i) => {
      const it = byId.get(i.tibiaItemId)
      return it ? [{ ...summary(it), slots: i.slots, type: i.type, vocations: i.vocations }] : []
    })
    return { source: s.source, fetchedAt: s.fetchedAt, slotTypes: s.slotTypes, items }
  },
}

export function createWebPlatform(): PlatformApi {
  return {
    kind: 'web',
    async call(channel, input) {
      const h = handlers[channel] as ((i: unknown) => Promise<unknown>) | undefined
      if (!h) throw new PlatformError('unavailable', 'Disponible solo en la app de escritorio')
      return (await h(input)) as never
    },
    on: () => () => undefined,
    capabilities: { collector: false, thirdPartyImport: false, localDatabase: false },
  }
}
