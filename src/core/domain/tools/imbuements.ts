import { mulGp, sumGp, type Gp } from '../money/gp'

export type ImbuementTier = 'Basic' | 'Intricate' | 'Powerful'

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

export interface ImbuementCost {
  imbuement: string
  tier: ImbuementTier
  lines: MaterialLine[]
  materialsTotal: Gp | null
  shrineFee: Gp
  total: Gp | null
  /** Materiales sin precio: el total queda en null en vez de asumir 0. */
  missingPrices: string[]
  tokenAlternative: { tokens: number; tokenPrice: Gp; total: Gp; cheaper: 'tokens' | 'materials' | null } | null
}

/** Basic usa el primer material, Intricate los dos primeros y Powerful los tres (acumulativo). */
export function materialsForTier(def: ImbuementDef, tier: TierDef): ImbuementMaterial[] {
  return def.materials.slice(0, tier.materials)
}

export function imbuementCost(
  def: ImbuementDef,
  tier: TierDef,
  prices: Record<string, Gp | null | undefined>,
  tokens?: { tokensForTier: number | null; goldTokenPrice: Gp | null; tradeable: boolean },
): ImbuementCost {
  const lines: MaterialLine[] = materialsForTier(def, tier).map((m) => {
    const unitPrice = prices[m.item] ?? null
    return { ...m, unitPrice, subtotal: unitPrice === null ? null : mulGp(unitPrice, m.qty) }
  })
  const missingPrices = lines.filter((l) => l.subtotal === null).map((l) => l.item)
  const materialsTotal = missingPrices.length ? null : sumGp(lines.map((l) => l.subtotal!))
  const total = materialsTotal === null ? null : materialsTotal + tier.shrineFeeGp

  let tokenAlternative: ImbuementCost['tokenAlternative'] = null
  if (tokens?.tradeable && tokens.tokensForTier && tokens.goldTokenPrice !== null) {
    const tokenTotal = mulGp(tokens.goldTokenPrice, tokens.tokensForTier) + tier.shrineFeeGp
    tokenAlternative = {
      tokens: tokens.tokensForTier,
      tokenPrice: tokens.goldTokenPrice,
      total: tokenTotal,
      cheaper: total === null ? null : tokenTotal < total ? 'tokens' : 'materials',
    }
  }
  return { imbuement: def.name, tier: tier.tier, lines, materialsTotal, shrineFee: tier.shrineFeeGp, total, missingPrices, tokenAlternative }
}
