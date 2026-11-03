import type { CheckResult, RouteEvaluation, WorldTransferInfo } from './rules'

// Requisitos personales del personaje (manual oficial, sección Character World Transfer).
// La app no consulta el personaje: el usuario los confirma. null = no confirmado → "unknown".

export interface TransferProfile {
  name: string
  currentWorld: string | null
  lastTransferAt: string | null
  hasRedOrBlackSkull: boolean | null
  isGuildLeader: boolean | null
  ownsHouse: boolean | null
  hasOpenTcMarketOffers: boolean | null
  isOnMainContinent: boolean | null
  visitedCalvaOrCalvera: boolean | null
  transferType: 'regular' | 'express'
  availableEligibleTc: number | null
}

export interface ChecklistItem {
  key: string
  label: string
  result: CheckResult
  detail: string
}

const SIX_MONTHS_MS = 182 * 86_400_000

function tri(value: boolean | null, okWhen: boolean): CheckResult {
  return value === null ? 'unknown' : value === okWhen ? 'pass' : 'fail'
}

export function characterChecklist(profile: TransferProfile, origin: WorldTransferInfo, dest: WorldTransferInfo, now: Date): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { key: 'skull', label: 'Sin red/black skull', result: tri(profile.hasRedOrBlackSkull, false), detail: 'No se puede transferir con red o black skull' },
    { key: 'guild', label: 'No es líder de guild', result: tri(profile.isGuildLeader, false), detail: 'Los líderes de guild no pueden transferirse' },
    { key: 'house', label: 'Sin casa alquilada', result: tri(profile.ownsHouse, false), detail: 'Debe entregar la casa antes de transferir' },
    { key: 'tc-offers', label: 'Sin ofertas de Market con Tibia Coins', result: tri(profile.hasOpenTcMarketOffers, false), detail: 'Las ofertas abiertas que incluyen TC bloquean la transferencia' },
    { key: 'continent', label: 'En el continente principal', result: tri(profile.isOnMainContinent, true), detail: 'Personajes en Rookgaard/Newhaven no pueden comprar transferencias' },
  ]

  if (profile.transferType === 'regular') {
    if (profile.lastTransferAt === null) items.push({ key: 'six-months', label: 'Sin transferencias en 6 meses', result: 'unknown', detail: 'Indica la fecha de la última transferencia (o que nunca se transfirió)' })
    else {
      const recent = now.getTime() - new Date(profile.lastTransferAt).getTime() < SIX_MONTHS_MS
      items.push({ key: 'six-months', label: 'Sin transferencias en 6 meses', result: recent ? 'fail' : 'pass', detail: recent ? 'Transferido hace menos de 6 meses: requiere Express' : 'La transferencia regular aplica' })
    }
  } else {
    items.push({ key: 'six-months', label: 'Transferencia Express', result: 'pass', detail: 'Express permite transferir aunque se haya transferido en los últimos 6 meses' })
  }

  const hardcore = (w: WorldTransferInfo) => w.pvpType === 'Hardcore PvP'
  if (hardcore(origin) && hardcore(dest)) {
    items.push({ key: 'calva', label: 'Nunca visitó Calva/Calvera', result: tri(profile.visitedCalvaOrCalvera, false), detail: 'Hardcore → Hardcore no se permite si visitó Calva o Calvera' })
  }
  if (profile.currentWorld !== null && profile.currentWorld !== origin.name) {
    items.push({ key: 'origin', label: 'El personaje está en el mundo origen', result: 'fail', detail: `El perfil indica ${profile.currentWorld}` })
  }
  return items
}

export type FinalStatus = 'eligible' | 'blocked' | 'unverified'

/** Solo "eligible" si la ruta está permitida y todo el checklist está confirmado. */
export function finalTransferStatus(route: RouteEvaluation, checklist: readonly ChecklistItem[]): FinalStatus {
  if (route.status === 'blocked' || checklist.some((c) => c.result === 'fail')) return 'blocked'
  if (route.status === 'unknown' || checklist.some((c) => c.result === 'unknown')) return 'unverified'
  return 'eligible'
}
