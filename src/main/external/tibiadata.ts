import { z } from 'zod'
import type { CharacterSnapshot } from '@core/domain/tools/characters'
import { ExternalError, type HttpClient, type HttpResult } from './http'

// TibiaData (https://docs.tibiadata.com): solo metadatos públicos. No tiene datos de Market.
const BASE = 'https://api.tibiadata.com/v4'

const worldsSchema = z.object({
  worlds: z.object({
    regular_worlds: z.array(
      z.object({
        name: z.string(),
        status: z.string().optional(),
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

export function tibiaData(http: HttpClient) {
  return {
    async worlds(): Promise<HttpResult<TibiaDataWorld[]>> {
      const r = await http.getJson<unknown>(`${BASE}/worlds`, { cacheSeconds: 3_600 })
      return { ...r, data: worldsSchema.parse(r.data).worlds.regular_worlds }
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
