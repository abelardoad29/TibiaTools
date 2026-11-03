import { z } from 'zod'
import type { CharacterSnapshot } from '@core/domain/tools/characters'
import { ExternalError, type HttpClient, type HttpResult } from './http'

// TibiaData (https://docs.tibiadata.com): solo metadatos públicos. No tiene datos de Market.
const BASE = 'https://api.tibiadata.com/v4'

const worldsSchema = z.object({
  worlds: z.object({
    players_online: z.number().int().nullable().optional(),
    record_players: z.number().int().nullable().optional(),
    record_date: z.string().nullable().optional(),
    regular_worlds: z.array(
      z.object({
        name: z.string(),
        status: z.string().optional(),
        players_online: z.number().int().nullable().optional(),
        location: z.string(),
        pvp_type: z.string(),
        premium_only: z.boolean(),
        transfer_type: z.string(),
        battleye_protected: z.boolean(),
        battleye_date: z.string(),
        game_world_type: z.string(),
      }),
    ),
  }),
})

const boostedSchema = z.object({ name: z.string(), image_url: z.string().optional() })

const characterSchema = z.object({
  character: z
    .object({
      character: z.object({ name: z.string(), world: z.string(), level: z.number().int(), vocation: z.string() }),
      deaths: z.array(z.object({ time: z.string(), level: z.number().int(), reason: z.string() })).optional(),
    })
    .optional(),
})

const worldDetailSchema = z.object({
  world: z.object({
    name: z.string(),
    status: z.string().nullable().optional(),
    players_online: z.number().int().nullable().optional(),
    record_players: z.number().int().nullable().optional(),
    record_date: z.string().nullable().optional(),
    creation_date: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    pvp_type: z.string().nullable().optional(),
    premium_only: z.boolean().nullable().optional(),
    transfer_type: z.string().nullable().optional(),
    world_quest_titles: z.array(z.string()).nullable().optional(),
    battleye_protected: z.boolean().nullable().optional(),
    battleye_date: z.string().nullable().optional(),
    game_world_type: z.string().nullable().optional(),
    online_players: z.array(z.object({ name: z.string(), level: z.number().int(), vocation: z.string() })).nullable().optional(),
  }),
})

const killStatsEntry = z.object({ race: z.string(), last_day_killed: z.number().int(), last_day_players_killed: z.number().int() })
const killStatsSchema = z.object({
  killstatistics: z.object({ world: z.string(), entries: z.array(killStatsEntry).nullable().optional() }),
  information: z.object({ timestamp: z.string() }).partial().optional(),
})
export type KillStatsEntry = z.infer<typeof killStatsEntry>

const worldOnlineSchema = z.object({
  world: z.object({
    name: z.string(),
    online_players: z.array(z.object({ name: z.string(), level: z.number().int(), vocation: z.string() })).nullable().optional(),
  }),
  information: z.object({ timestamp: z.string() }).partial().optional(),
})

const guildSchema = z.object({
  guild: z.object({
    name: z.string(),
    world: z.string(),
    members: z.array(z.object({ name: z.string(), rank: z.string().optional(), level: z.number().int(), vocation: z.string() })).nullable().optional(),
  }),
})

export type TibiaDataWorld = z.infer<typeof worldsSchema>['worlds']['regular_worlds'][number]
export type TibiaDataWorlds = z.infer<typeof worldsSchema>['worlds']
export type TibiaDataWorldDetail = z.infer<typeof worldDetailSchema>['world']

export function tibiaData(http: HttpClient) {
  /** Lista de mundos con conectados por mundo y el récord global. */
  async function worldsOverview(cacheSeconds = 60): Promise<HttpResult<TibiaDataWorlds>> {
    const r = await http.getJson<unknown>(`${BASE}/worlds`, { cacheSeconds })
    return { ...r, data: worldsSchema.parse(r.data).worlds }
  }
  return {
    async worlds(cacheSeconds = 3_600): Promise<HttpResult<TibiaDataWorld[]>> {
      const r = await worldsOverview(cacheSeconds)
      return { ...r, data: r.data.regular_worlds }
    },
    worldsOverview,
    /** Ficha de un mundo: récord, fecha de creación, títulos de world quests y lista de conectados. */
    async worldDetail(world: string): Promise<HttpResult<TibiaDataWorldDetail>> {
      const r = await http.getJson<unknown>(`${BASE}/world/${encodeURIComponent(world)}`, { cacheSeconds: 60, retries: 1 })
      return { ...r, data: worldDetailSchema.parse(r.data).world }
    },
    async boosted(refresh: boolean) {
      const opts = { cacheSeconds: refresh ? 0 : 1_800 }
      const [creatures, bosses] = await Promise.all([
        http.getJson<{ creatures?: { boosted?: unknown } }>(`${BASE}/creatures`, opts),
        http.getJson<{ boostable_bosses?: { boosted?: unknown } }>(`${BASE}/boostablebosses`, opts),
      ])
      const c = boostedSchema.safeParse(creatures.data.creatures?.boosted)
      const b = boostedSchema.safeParse(bosses.data.boostable_bosses?.boosted)
      return {
        creature: c.success ? { name: c.data.name, imageUrl: c.data.image_url ?? null } : null,
        boss: b.success ? { name: b.data.name, imageUrl: b.data.image_url ?? null } : null,
        fetchedAt: creatures.fetchedAt,
      }
    },
    /** Lista pública de conectados de un mundo. Sin caché local: TibiaData ya la guarda 60 s. */
    async worldOnline(world: string) {
      const r = await http.getJson<unknown>(`${BASE}/world/${encodeURIComponent(world)}`, { cacheSeconds: 0, staleOnError: false, retries: 1 })
      const d = worldOnlineSchema.parse(r.data)
      return { players: d.world.online_players ?? [], sourceTimestamp: d.information?.timestamp ?? r.fetchedAt, fetchedAt: r.fetchedAt }
    },
    /** Kill Statistics del mundo (último día y última semana); tibia.com las actualiza ~3 a. m. CET. */
    async killStatistics(world: string) {
      const r = await http.getJson<unknown>(`${BASE}/killstatistics/${encodeURIComponent(world)}`, { cacheSeconds: 900, retries: 1 })
      const d = killStatsSchema.parse(r.data)
      return { world: d.killstatistics.world, entries: d.killstatistics.entries ?? [], timestamp: d.information?.timestamp ?? r.fetchedAt }
    },
    /** null si la guild no existe (TibiaData responde 502). */
    async guild(name: string) {
      try {
        const r = await http.getJson<unknown>(`${BASE}/guild/${encodeURIComponent(name.trim())}`, { cacheSeconds: 600, staleOnError: false, retries: 0 })
        const g = guildSchema.safeParse(r.data)
        return g.success ? { name: g.data.guild.name, world: g.data.guild.world, members: g.data.guild.members ?? [] } : null
      } catch (e) {
        if (e instanceof ExternalError && (e.status === 502 || e.status === 404)) return null
        throw e
      }
    },
    /** null si el personaje no existe. TibiaData responde 502 (no 404) para nombres inexistentes: no se reintenta. */
    async character(name: string): Promise<CharacterSnapshot | null> {
      let r: HttpResult<unknown>
      try {
        r = await http.getJson<unknown>(`${BASE}/character/${encodeURIComponent(name.trim())}`, { cacheSeconds: 120, staleOnError: false, retries: 0 })
      } catch (e) {
        if (e instanceof ExternalError && (e.status === 502 || e.status === 404)) return null
        throw e
      }
      const parsed = characterSchema.safeParse(r.data)
      const ch = parsed.success ? parsed.data.character : undefined
      if (!ch) return null
      return { ...ch.character, deaths: ch.deaths ?? [] }
    },
  }
}
