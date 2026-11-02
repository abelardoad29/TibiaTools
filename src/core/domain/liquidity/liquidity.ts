// Liquidez. Se distinguen dos fuentes y nunca se suman sin etiquetar:
//  - official: transacciones de la vista Details del Market (o de terceros que las copian), 30 días.
//  - inferred: ejecuciones posibles deducidas de desapariciones entre snapshots propios.
// Ninguna de las dos se llama "ventas por semana".

export interface OfficialStats {
  /** Transacciones en la ventana (normalmente 30 días). */
  transactions: number | null
  windowDays: number
  source: 'own_capture' | 'third_party'
  observedAt: string
}

export interface LiquidityEstimate {
  officialTransactionsPerDay: number | null
  officialSource: OfficialStats['source'] | null
  estimatedPossibleFillsPerDay: number | null
  inferredVolume: number | null
  liquidityConfidence: 'official' | 'inferred' | 'none'
  /** 0–100, escala logarítmica: 1 tx/día ≈ 15, 10/día ≈ 52, 100/día = 100. */
  score: number
}

export function logScore(perDay: number): number {
  return Math.round(Math.min(100, (100 * Math.log10(1 + Math.max(0, perDay))) / Math.log10(101)))
}

export function estimateLiquidity(
  official: OfficialStats | null,
  inferred: { possiblyFilledQuantity: number; observedDays: number } | null,
): LiquidityEstimate {
  const officialPerDay = official?.transactions != null && official.windowDays > 0 ? official.transactions / official.windowDays : null
  const inferredPerDay = inferred && inferred.observedDays > 0 ? inferred.possiblyFilledQuantity / inferred.observedDays : null
  const basis = officialPerDay ?? inferredPerDay
  return {
    officialTransactionsPerDay: officialPerDay,
    officialSource: official?.source ?? null,
    estimatedPossibleFillsPerDay: inferredPerDay,
    inferredVolume: inferred?.possiblyFilledQuantity ?? null,
    liquidityConfidence: officialPerDay !== null ? 'official' : inferredPerDay !== null ? 'inferred' : 'none',
    // Lo inferido pesa la mitad: una desaparición no es una venta.
    score: basis === null ? 0 : officialPerDay !== null ? logScore(officialPerDay) : Math.round(logScore(inferredPerDay!) / 2),
  }
}
