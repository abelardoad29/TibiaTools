// Agrupa las ofertas de NPC repetidas: el catálogo lista una fila por ciudad aunque sea el mismo NPC
// con el mismo precio (p. ej. Rashid aparece 7 veces, una por cada ciudad que visita en la semana).

export interface NpcTradeRow {
  name: string
  location: string
  price: number
  currencyId: number
}

export interface NpcTradeGroup {
  name: string
  price: number
  currencyId: number
  locations: string[]
}

/**
 * `side` = 'buy' (el NPC compra el item: primero quien paga más) o 'sell' (el NPC lo vende: primero el más barato).
 */
export function groupNpcTrades(rows: readonly NpcTradeRow[], side: 'buy' | 'sell'): NpcTradeGroup[] {
  const groups = new Map<string, NpcTradeGroup>()
  for (const r of rows) {
    const key = `${r.name}|${r.price}|${r.currencyId}`
    const g = groups.get(key) ?? { name: r.name, price: r.price, currencyId: r.currencyId, locations: [] }
    if (!g.locations.includes(r.location)) g.locations.push(r.location)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => (side === 'buy' ? b.price - a.price : a.price - b.price) || a.name.localeCompare(b.name))
}

/** NPCs que cambian de ciudad según el día (se muestra dónde están hoy en lugar de todas las ciudades). */
export const TRAVELLING_NPCS = new Set(['Rashid'])
