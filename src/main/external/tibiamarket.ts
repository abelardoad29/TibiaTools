import { z } from 'zod'
import type { HttpClient } from './http'

// API pública de tibiamarket.top (OpenAPI en https://api.tibiamarket.top/openapi.json).
// Sus datos son de terceros y pueden tener semanas: se guardan como source = 'third_party' con la hora
// del dato (no la de importación) y nunca se presentan como capturas propias.
// Límite: 1 consulta cada 5 s (lo aplica el cliente HTTP). /market_values sin item_ids devuelve todos los
// items del mundo en una sola respuesta (~5.000 items, ~200 KB comprimidos).
const BASE = 'https://api.tibiamarket.top'
const PAGE = 10_000

const n = z.number().nullable().optional()
const marketValuesSchema = z.array(
  z.object({
    id: z.number().int(),
    time: z.number(),
    buy_offer: n,
    sell_offer: n,
    month_average_sell: n,
    month_average_buy: n,
    month_sold: n,
    month_bought: n,
    /** Cantidad de ofertas activas de cada lado al momento del escaneo. */
    buy_offers: n,
    sell_offers: n,
    month_highest_sell: n,
    month_lowest_sell: n,
    month_highest_buy: n,
    month_lowest_buy: n,
    day_average_sell: n,
    day_average_buy: n,
    day_sold: n,
    day_bought: n,
    day_highest_sell: n,
    day_lowest_sell: n,
    day_highest_buy: n,
    day_lowest_buy: n,
  }),
)

const traderSchema = z.object({ amount: z.number().int(), price: z.number().int(), time: z.number() })
const boardSchema = z.object({ id: z.number().int(), sellers: z.array(traderSchema), buyers: z.array(traderSchema), update_time: z.number() })
const worldDataSchema = z.array(z.object({ name: z.string(), last_update: z.string() }))

export type MarketValues = z.infer<typeof marketValuesSchema>[number]
export type MarketBoard = z.infer<typeof boardSchema>

export const unixToIso = (t: number) => new Date(Math.round(t * 1_000)).toISOString()

export function tibiaMarket(http: HttpClient) {
  return {
    async worlds(cacheSeconds = 1_800) {
      const r = await http.getJson<unknown>(`${BASE}/world_data`, { cacheSeconds, retries: 3 })
      // last_update viene sin zona horaria; se asume UTC.
      return worldDataSchema.parse(r.data).map((w) => ({ world: w.name, lastUpdate: w.last_update.endsWith('Z') ? w.last_update : `${w.last_update}Z` }))
    },
    async marketValues(world: string, itemIds: number[] | null) {
      const out: MarketValues[] = []
      const ids = itemIds ?? null
      // Sin ids: todo el mundo en una página (se sigue paginando solo si viniera llena). Sin caché HTTP:
      // son ~3 MB por mundo y el control de "ya importado" lo lleva third_party_sync.
      if (ids === null) {
        for (let skip = 0; skip < 50_000; skip += PAGE) {
          const r = await http.getJson<unknown>(`${BASE}/market_values?server=${encodeURIComponent(world)}&skip=${skip}&limit=${PAGE}`, { timeoutMs: 60_000, retries: 3 })
          const page = marketValuesSchema.parse(r.data)
          out.push(...page)
          if (page.length < PAGE) break
        }
        return out
      }
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100).join(',')
        const r = await http.getJson<unknown>(`${BASE}/market_values?server=${encodeURIComponent(world)}&item_ids=${chunk}&limit=100`, { cacheSeconds: 1_800, retries: 3 })
        out.push(...marketValuesSchema.parse(r.data))
      }
      return out
    },
    async board(world: string, itemId: number): Promise<MarketBoard> {
      const r = await http.getJson<unknown>(`${BASE}/market_board?server=${encodeURIComponent(world)}&item_id=${itemId}`, { cacheSeconds: 1_800, retries: 3 })
      return boardSchema.parse(r.data)
    },
  }
}
