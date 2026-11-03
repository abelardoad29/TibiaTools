import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, CircleHelp, Clock, FileQuestion, Globe2, Package, PencilLine, Sigma, Sparkles, XCircle, type LucideIcon } from 'lucide-react'
import type { ItemSummary, World } from '@shared/api'
import { PROVENANCE_HELP, PROVENANCE_LABEL, type Provenance } from '@shared/provenance'
import type { RouteStatus } from '@core/domain/transfers/rules'
import { useApi } from '../lib/api'
import { ageHours, formatAge, formatDateTime, formatGp, formatGpShort } from '../lib/format'
import { Badge, Select, type Tone } from './ui'

export function Gp({ value, short, signed, className }: { value: number | null | undefined; short?: boolean; signed?: boolean; className?: string }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>
  const text = short ? formatGpShort(value) : formatGp(value)
  return (
    <span className={clsx('num', signed && value > 0 && 'text-good', signed && value < 0 && 'text-bad', className)} title={`${formatGp(value)} gp`}>
      {signed && value > 0 ? '+' : ''}
      {text}
    </span>
  )
}

const PROV_ICON: Record<Provenance, LucideIcon> = {
  own_capture: CheckCircle2,
  official_stats: Sigma,
  third_party: Globe2,
  manual: PencilLine,
  inferred: Sparkles,
  estimated: Sparkles,
  unknown: CircleHelp,
}
const PROV_TONE: Record<Provenance, Tone> = { own_capture: 'good', official_stats: 'info', third_party: 'warn', manual: 'neutral', inferred: 'accent', estimated: 'accent', unknown: 'neutral' }

/** Procedencia con texto + icono (el color nunca es el único indicador). */
export function ProvenanceBadge({ kind }: { kind: Provenance }) {
  const Icon = PROV_ICON[kind]
  return (
    <Badge tone={PROV_TONE[kind]} title={PROVENANCE_HELP[kind]} icon={<Icon className="size-3" aria-hidden />}>
      {PROVENANCE_LABEL[kind]}
    </Badge>
  )
}

/** Hora del dato + antigüedad; se marca si supera `staleHours`. */
export function Freshness({ at, staleHours = 48 }: { at: string | null | undefined; staleHours?: number }) {
  const stale = ageHours(at) > staleHours
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs', stale ? 'text-warn' : 'text-muted')} title={formatDateTime(at)}>
      <Clock className="size-3" aria-hidden />
      {formatAge(at)}
      {stale && at && ' (viejo)'}
    </span>
  )
}

const ROUTE: Record<RouteStatus, { tone: Tone; label: string; icon: LucideIcon }> = {
  allowed: { tone: 'good', label: 'Permitida', icon: CheckCircle2 },
  blocked: { tone: 'bad', label: 'Bloqueada', icon: XCircle },
  unknown: { tone: 'warn', label: 'No verificada', icon: FileQuestion },
}

export function RouteBadge({ status }: { status: RouteStatus }) {
  const r = ROUTE[status]
  return (
    <Badge tone={r.tone} icon={<r.icon className="size-3" aria-hidden />}>
      {r.label}
    </Badge>
  )
}

export function CheckBadge({ result }: { result: 'pass' | 'fail' | 'unknown' }) {
  return result === 'pass' ? (
    <Badge tone="good" icon={<CheckCircle2 className="size-3" />}>
      OK
    </Badge>
  ) : result === 'fail' ? (
    <Badge tone="bad" icon={<XCircle className="size-3" />}>
      No
    </Badge>
  ) : (
    <Badge tone="warn" icon={<CircleHelp className="size-3" />}>
      Sin confirmar
    </Badge>
  )
}

export function ItemIcon({ item, size = 32 }: { item: Pick<ItemSummary, 'iconUrl' | 'name'>; size?: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [item.iconUrl])
  if (failed) return <Package className="shrink-0 text-muted" style={{ width: size, height: size }} aria-label={item.name} />
  return <img src={item.iconUrl} alt={item.name} width={size} height={size} loading="lazy" className="pixel shrink-0 object-contain" onError={() => setFailed(true)} />
}

/** Buscador de items con iconos (búsqueda difusa en el catálogo local). */
export function ItemPicker({ value, onChange, placeholder = 'Buscar item…', autoFocus }: { value: ItemSummary | null; onChange: (item: ItemSummary | null) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const { data = [] } = useApi('catalog.items.search', { q, category: null, limit: 30 }, { enabled: open && q.length > 0 })
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const choose = (i: ItemSummary) => {
    onChange(i)
    setQ('')
    setOpen(false)
  }
  return (
    <div ref={ref} className="relative min-w-64">
      {value && !open ? (
        <button type="button" className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel-2 px-2 py-1 text-left text-sm hover:border-accent" onClick={() => setOpen(true)}>
          <ItemIcon item={value} size={24} />
          <span className="truncate">{value.name}</span>
          <span className="ml-auto text-xs text-muted">{value.category}</span>
        </button>
      ) : (
        <input
          autoFocus={autoFocus || open}
          value={q}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, data.length - 1))
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
            if (e.key === 'Enter' && data[active]) choose(data[active])
            if (e.key === 'Escape') setOpen(false)
          }}
          className="w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        />
      )}
      {open && q && (
        <ul className="absolute z-40 mt-1 max-h-80 w-full min-w-80 overflow-auto rounded-lg border border-line bg-panel shadow-xl" role="listbox">
          {data.length === 0 && <li className="px-3 py-2 text-sm text-muted">Sin resultados</li>}
          {data.map((i, idx) => (
            <li key={i.id}>
              <button type="button" onMouseDown={() => choose(i)} className={clsx('flex w-full items-center gap-2 px-2 py-1 text-left text-sm', idx === active ? 'bg-panel-2' : 'hover:bg-panel-2')}>
                <ItemIcon item={i} size={28} />
                <span className="truncate">{i.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted">{i.category}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Mis mundos (Ajustes): el principal primero y luego los marcados con estrella, en ese orden. */
export function useMyWorlds(): string[] {
  const { data } = useApi('app.settings.get', undefined)
  if (!data) return []
  return [...new Set([...(data.homeWorld ? [data.homeWorld] : []), ...data.favoriteWorlds])]
}

/** Selector de mundo: "Mis mundos" arriba y el resto debajo, para no buscar entre los 90 cada vez. */
export function WorldPicker({ value, onChange, allowEmpty, activeOnly = true, label = 'Mundo…' }: { value: string | null; onChange: (w: string | null) => void; allowEmpty?: boolean; activeOnly?: boolean; label?: string }) {
  const { data = [] } = useApi('catalog.worlds.list', { activeOnly })
  const mine = useMyWorlds()
  const byName = new Map(data.map((w: World) => [w.name, w]))
  const opt = (w: World, group?: string) => ({ value: w.name, label: `${w.name} · ${w.region ?? '?'} · ${w.pvpType ?? '?'}`, group })
  const mineWorlds = mine.map((n) => byName.get(n)).filter((w): w is World => !!w)
  const rest = data.filter((w: World) => !mine.includes(w.name))
  return (
    <Select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      options={[
        ...(allowEmpty || !value ? [{ value: '', label }] : []),
        ...mineWorlds.map((w) => opt(w, 'Mis mundos')),
        ...rest.map((w: World) => opt(w, mineWorlds.length ? 'Todos los mundos' : undefined)),
      ]}
    />
  )
}

export function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>
  const pct = Math.round(value * 100)
  return <span className={clsx('num text-xs', pct >= 98 ? 'text-good' : pct >= 90 ? 'text-warn' : 'text-bad')}>{pct} %</span>
}
