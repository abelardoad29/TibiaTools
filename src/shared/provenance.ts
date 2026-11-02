// Procedencia de cada dato mostrado. La UI la muestra con texto + icono (nunca solo color).

export const PROVENANCES = ['own_capture', 'official_stats', 'third_party', 'manual', 'inferred', 'estimated', 'unknown'] as const
export type Provenance = (typeof PROVENANCES)[number]

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  own_capture: 'Propio',
  official_stats: 'Oficial',
  third_party: 'Terceros',
  manual: 'Manual',
  inferred: 'Inferido',
  estimated: 'Estimado',
  unknown: 'Desconocido',
}

export const PROVENANCE_HELP: Record<Provenance, string> = {
  own_capture: 'Observado en una captura propia revisada',
  official_stats: 'Estadística oficial de la vista Details del Market (capturada)',
  third_party: 'Dato de tibiamarket.top: no verificado por ti, puede estar desactualizado',
  manual: 'Introducido a mano',
  inferred: 'Deducido de cambios entre snapshots (no es una venta confirmada)',
  estimated: 'Cálculo con supuestos (escenarios, percentiles)',
  unknown: 'Sin datos suficientes',
}

export type DataSource = 'own_capture' | 'third_party' | 'manual'
