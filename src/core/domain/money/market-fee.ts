import { applyBps, assertGp, mulGp, type Gp, type Rounding } from './gp'

/**
 * Regla de comisión del Market. Versionada en `economic_rule_versions` (clave `market_fee`).
 * El manual oficial dice "2.5 % of the price of the offer", sin aclarar si es el precio unitario o el
 * total (precio × cantidad); por eso la base es configurable y queda marcada como no verificada.
 */
export interface MarketFeeRule {
  rateBps: number
  minGp: Gp
  maxGp: Gp
  basis: 'unit' | 'total'
  rounding: Rounding
  basisVerified: boolean
  roundingVerified: boolean
}

export interface FeeResult {
  fee: Gp
  warnings: string[]
}

/** Comisión por PUBLICAR una oferta (compra o venta). Aceptar una oferta existente no paga comisión. */
export function postingFee(rule: MarketFeeRule, unitPrice: Gp, amount: number): FeeResult {
  assertGp(unitPrice, 'precio')
  if (amount <= 0) throw new RangeError('cantidad debe ser > 0')
  const base = rule.basis === 'total' ? mulGp(unitPrice, amount) : unitPrice
  const raw = applyBps(base, rule.rateBps, rule.rounding)
  const fee = Math.min(rule.maxGp, Math.max(rule.minGp, raw))
  const warnings: string[] = []
  if (!rule.basisVerified) warnings.push('Base de la comisión (unitaria vs total) sin verificar en el cliente')
  if (!rule.roundingVerified) warnings.push('Redondeo de la comisión sin verificar en el cliente')
  return { fee, warnings }
}
