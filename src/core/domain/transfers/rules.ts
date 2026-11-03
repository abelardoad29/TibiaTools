// Compatibilidad general origen → destino según atributos del mundo y las reglas oficiales
// (seed/transfer_rules.json, versionadas). Cualquier dato desconocido o regla vencida da "unknown";
// nunca se asume "sí" por región.

export type CheckResult = 'pass' | 'fail' | 'unknown'
export type RouteStatus = 'allowed' | 'blocked' | 'unknown'

export interface WorldTransferInfo {
  name: string
  pvpType: string | null
  /** "release" = protegido por BattlEye desde su lanzamiento; una fecha = protegido después; null = desconocido. */
  battleyeDate: string | null
  battleyeProtected: boolean | null
  transferType: 'regular' | 'blocked' | 'locked' | string | null
  gameWorldType: string | null
  /** El manual menciona mundos con "looser transfer conditions"; TibiaData no lo expone. */
  looserTransferConditions: boolean | null
}

export interface TransferRuleSet {
  version: string
  sourceUrl: string
  verifiedAt: string
  /** Días tras los cuales la regla se considera vencida y todo pasa a "unknown". */
  validityDays: number
  /** Destinos PvP permitidos para cada tipo de origen. */
  pvpAllowedDestinations: Record<string, string[]>
}

export interface RouteCheck {
  rule: string
  result: CheckResult
  reason: string
}

export interface RouteEvaluation {
  origin: string
  destination: string
  status: RouteStatus
  checks: RouteCheck[]
}

/** Override manual verificado por el usuario (tabla transfer_rules). */
export interface ManualRouteRule {
  status: RouteStatus
  reason: string
  sourceUrl: string | null
  verifiedAt: string
  validUntil: string | null
}

export function evaluateRoute(
  origin: WorldTransferInfo,
  dest: WorldTransferInfo,
  rules: TransferRuleSet,
  now: Date,
  manual?: ManualRouteRule | null,
): RouteEvaluation {
  const checks: RouteCheck[] = []
  const add = (rule: string, result: CheckResult, reason: string) => checks.push({ rule, result, reason })

  if (origin.name === dest.name) add('mismo-mundo', 'fail', 'Origen y destino son el mismo mundo')

  const ageDays = (now.getTime() - new Date(rules.verifiedAt).getTime()) / 86_400_000
  if (ageDays > rules.validityDays) add('vigencia', 'unknown', `Reglas verificadas hace ${Math.floor(ageDays)} días; revísalas en ${rules.sourceUrl}`)

  // Mundos bloqueados / bloqueados para salida
  if (dest.transferType === null || origin.transferType === null) add('tipo-transferencia', 'unknown', 'Tipo de transferencia desconocido')
  else {
    if (dest.transferType === 'blocked') add('destino-blocked', 'fail', `${dest.name} está marcado "blocked": no admite transferencias entrantes`)
    if (origin.transferType === 'locked' && dest.transferType !== 'locked') add('origen-locked', 'fail', `${origin.name} es "locked": solo puede ir a otros mundos locked`)
  }

  const toLocked = dest.transferType === 'locked'
  if (toLocked) {
    add('destino-locked', 'pass', 'Cualquier mundo puede transferirse a un mundo "locked"')
  } else {
    // PvP
    if (!origin.pvpType || !dest.pvpType) add('pvp', 'unknown', 'Tipo PvP desconocido')
    else {
      const allowed = rules.pvpAllowedDestinations[origin.pvpType]
      if (!allowed) add('pvp', 'unknown', `Sin regla para origen ${origin.pvpType}`)
      else if (allowed.includes(dest.pvpType)) add('pvp', 'pass', `${origin.pvpType} → ${dest.pvpType} permitido`)
      else if (dest.looserTransferConditions === true && origin.transferType !== 'locked') add('pvp', 'pass', 'Destino con "looser transfer conditions"')
      else if (dest.looserTransferConditions === null) add('pvp', 'unknown', `${origin.pvpType} → ${dest.pvpType} no permitido salvo que el destino tenga "looser transfer conditions" (no confirmado)`)
      else add('pvp', 'fail', `${origin.pvpType} → ${dest.pvpType}: el destino debe tener reglas PvP iguales o más limitadas`)
    }
    // BattlEye: a un mundo protegido desde el lanzamiento solo se llega desde otro protegido desde el lanzamiento.
    if (dest.gameWorldType === 'experimental') add('battleye', 'pass', 'Los mundos experimentales son excepción a la regla BattlEye')
    else if (dest.battleyeDate === null) add('battleye', 'unknown', 'Estado BattlEye del destino desconocido')
    else if (dest.battleyeDate !== 'release') add('battleye', 'pass', 'Destino no protegido desde el lanzamiento')
    else if (origin.battleyeDate === null) add('battleye', 'unknown', 'Estado BattlEye del origen desconocido')
    else if (origin.battleyeDate === 'release') add('battleye', 'pass', 'Ambos protegidos desde el lanzamiento')
    else add('battleye', 'fail', `${dest.name} está protegido desde el lanzamiento y ${origin.name} no`)
  }

  if (manual) {
    const expired = manual.validUntil !== null && manual.validUntil < now.toISOString()
    add('manual', expired ? 'unknown' : manual.status === 'allowed' ? 'pass' : manual.status === 'blocked' ? 'fail' : 'unknown', `Regla manual (${manual.verifiedAt}): ${manual.reason}${expired ? ' — vencida' : ''}`)
  }

  const status: RouteStatus = checks.some((c) => c.result === 'fail') ? 'blocked' : checks.some((c) => c.result === 'unknown') ? 'unknown' : 'allowed'
  return { origin: origin.name, destination: dest.name, status, checks }
}
