import { formatGp, formatGpShort } from '@core/domain/money/gp'

export { formatGp, formatGpShort }

export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'sin datos'
  const ms = now - new Date(iso).getTime()
  if (ms < 0) return 'en el futuro'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'hace segundos'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

export function ageHours(iso: string | null | undefined): number {
  return iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : Infinity
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)} %`
}

export function parseIntOrNull(s: string): number | null {
  const t = s.replace(/[,\s]/g, '')
  if (!/^-?\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isSafeInteger(n) ? n : null
}
