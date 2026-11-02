import { mulGp, sumGp, type Gp } from '../money/gp'

// Costo de imbuements. Datos verificados (02-11-2026):
//  - Tarifa del santuario 7,500 / 60,000 / 250,000 gp con 100 % de éxito (noticia oficial del 12-06-2025).
//  - Duración: 20 h; solo corre con el item equipado y fuera de zona de protección (las backpacks corren siempre).
//  - Yana vende el paquete de materiales de cada tier por 2 / 4 / 6 Gold Tokens, solo para Strike, Vampirism y Void.
// Comprar con tokens los tiers bajos y el resto en el Market puede ser lo más barato: se evalúan todas las mezclas.

export type ImbuementTier = 'Basic' | 'Intricate' | 'Powerful'
export const TIERS: ImbuementTier[] = ['Basic', 'Intricate', 'Powerful']
export const IMBUEMENT_DURATION_HOURS = 20

export interface ImbuementMaterial {
  qty: number
  item: string
}

export interface ImbuementDef {
  name: string
  effect: string
  materials: ImbuementMaterial[]
}

export interface TierDef {
  tier: ImbuementTier
  materials: number
  shrineFeeGp: Gp
}

export interface MaterialLine extends ImbuementMaterial {
  unitPrice: Gp | null
  subtotal: Gp | null
}

export interface ImbuementOption {
  kind: 'materials' | 'tokens' | 'scroll' | 'paid'
  label: string
  /** Gold Tokens usados (0 si no aplica). */
  tokens: number
  /** Materiales que se compran en el Market en esta opción. */
  marketMaterials: string[]
  total: Gp | null
  perHour: number | null
  missing: string[]
  note: string | null
}

export interface ImbuementCost {
  imbuement: string
  tier: ImbuementTier
  lines: MaterialLine[]
  shrineFee: Gp
  options: ImbuementOption[]
  /** Opción más barata entre las que tienen todos los precios. */
  best: ImbuementOption | null
  durationHours: number
}

export interface ImbuementPricing {
  /** Precio unitario por nombre de material; null/ausente = sin precio (nunca se asume 0). */
  prices: Record<string, Gp | null | undefined>
  goldTokenPrice: Gp | null
  /** Tokens por paquete de tier (Basic, Intricate, Powerful). */
  tokensPerTier: Record<ImbuementTier, number | null>
  tokenTradeable: boolean
  /** Precio de un scroll de este imbuement y tier en el Market, si existe. */
  scrollPrice: Gp | null
}

/** Basic usa el primer material, Intricate los dos primeros y Powerful los tres (acumulativo). */
export function materialsForTier(def: ImbuementDef, tier: TierDef): ImbuementMaterial[] {
  return def.materials.slice(0, tier.materials)
}

const perHour = (total: Gp | null) => (total === null ? null : total / IMBUEMENT_DURATION_HOURS)

export function imbuementCost(def: ImbuementDef, tier: TierDef, tiers: readonly TierDef[], p: ImbuementPricing): ImbuementCost {
  const lines: MaterialLine[] = materialsForTier(def, tier).map((m) => {
    const unitPrice = p.prices[m.item] ?? null
    return { ...m, unitPrice, subtotal: unitPrice === null ? null : mulGp(unitPrice, m.qty) }
  })
  // Costo de los materiales i..n-1 en el Market (null si falta algún precio).
  const marketCost = (from: number) => {
    const part = lines.slice(from)
    const missing = part.filter((l) => l.subtotal === null).map((l) => l.item)
    return { total: missing.length ? null : sumGp(part.map((l) => l.subtotal!)), missing, names: part.map((l) => l.item) }
  }

  const options: ImbuementOption[] = []
  const all = marketCost(0)
  const matTotal = all.total === null ? null : all.total + tier.shrineFeeGp
  options.push({ kind: 'materials', label: 'Todos los materiales en el Market', tokens: 0, marketMaterials: all.names, total: matTotal, perHour: perHour(matTotal), missing: all.missing, note: null })

  if (p.tokenTradeable) {
    // Paquete k = materiales de los tiers 0..k comprados con tokens; el resto en el Market.
    for (let k = 0; k < lines.length; k++) {
      const tierK = tiers.find((t) => t.materials === k + 1)?.tier
      const tokens = tierK ? p.tokensPerTier[tierK] : null
      const rest = marketCost(k + 1)
      const missing = [...(p.goldTokenPrice === null ? ['Gold Token'] : []), ...(tokens === null ? [`tokens del paquete ${tierK ?? k + 1}`] : []), ...rest.missing]
      const total = missing.length ? null : mulGp(p.goldTokenPrice!, tokens!) + rest.total! + tier.shrineFeeGp
      options.push({
        kind: 'tokens',
        label: k === lines.length - 1 ? `Todo con ${tokens ?? '?'} Gold Tokens` : `Paquete ${tierK} con ${tokens ?? '?'} Gold Tokens + resto en el Market`,
        tokens: tokens ?? 0,
        marketMaterials: rest.names,
        total,
        perHour: perHour(total),
        missing,
        note: null,
      })
    }
  }

  if (p.scrollPrice !== null) {
    options.push({
      kind: 'scroll',
      label: `Scroll ${tier.tier.toLowerCase()} ${def.name.toLowerCase()} del Market`,
      tokens: 0,
      marketMaterials: [],
      total: p.scrollPrice,
      perHour: perHour(p.scrollPrice),
      missing: [],
      note: 'Precio del scroll ya inscrito; confirma en el juego si aplicarlo cobra algo más.',
    })
  }

  const priced = options.filter((o) => o.total !== null)
  const best = priced.length ? priced.reduce((a, b) => (b.total! < a.total! ? b : a)) : null
  return { imbuement: def.name, tier: tier.tier, lines, shrineFee: tier.shrineFeeGp, options, best, durationHours: IMBUEMENT_DURATION_HOURS }
}

/** Usa el precio que el usuario pagó de verdad (con santuario) en lugar de calcularlo. */
export function withPaidTotal(cost: ImbuementCost, paidTotal: Gp): ImbuementCost {
  const paid: ImbuementOption = {
    kind: 'paid',
    label: 'Precio que pagaste',
    tokens: 0,
    marketMaterials: [],
    total: paidTotal,
    perHour: perHour(paidTotal),
    missing: [],
    note: null,
  }
  return { ...cost, options: [paid, ...cost.options], best: paid }
}

export interface ImbuedItemCost {
  slots: (ImbuementCost | null)[]
  /** Costo de reimbuir todos los slots (un ciclo de 20 h). null si falta algún precio. */
  perCycle: Gp | null
  perHour: number | null
  missing: string[]
}

/** Costo de un item con varios slots imbuidos (cada slot dura 20 h de uso). */
export function imbuedItemCost(slots: (ImbuementCost | null)[]): ImbuedItemCost {
  const used = slots.filter((s): s is ImbuementCost => s !== null)
  const missing = used.filter((s) => !s.best).map((s) => `${s.tier} ${s.imbuement}`)
  const perCycle = used.length === 0 || missing.length ? null : sumGp(used.map((s) => s.best!.total!))
  return { slots, perCycle, perHour: perHour(perCycle), missing }
}

/** Costo de un conjunto de items para una hunt de `hours` horas (el tiempo corre solo con el item equipado). */
export function huntCost(items: readonly ImbuedItemCost[], hours: number): { perHour: number | null; perHunt: Gp | null } {
  if (items.some((i) => i.perHour === null) || items.length === 0) return { perHour: null, perHunt: null }
  const h = items.reduce((s, i) => s + i.perHour!, 0)
  return { perHour: h, perHunt: Math.ceil(h * hours) }
}
