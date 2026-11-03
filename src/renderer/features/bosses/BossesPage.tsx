import { useState } from 'react'
import { RefreshCw, Skull } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { BossOutlookRow } from '@shared/api'
import type { ChanceTier } from '@core/domain/bosses/spawn'
import { diffDays } from '@core/domain/bosses/spawn'
import { useApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { useMyWorlds, WorldPicker } from '../../components/data'
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Modal, Page, Select, Spinner, Toggle, Warnings, type Tone } from '../../components/ui'

const TIER: Record<ChanceTier, { label: string; tone: Tone }> = {
  high: { label: 'Alta', tone: 'good' },
  medium: { label: 'Media', tone: 'warn' },
  low: { label: 'Baja', tone: 'info' },
  none: { label: 'Sin chance', tone: 'neutral' },
  unknown: { label: 'Sin registro', tone: 'neutral' },
}
const TIER_ORDER: Record<ChanceTier, number> = { high: 0, medium: 1, low: 2, none: 3, unknown: 4 }

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`)
/** Fecha de la estadística de tibia.com (se publica ~3 a. m. CET con las muertes de las 24 h anteriores). */
const statsDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
const ago = (n: number) => (n === 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} d`)
const inDays = (n: number | null) => (n === null ? '—' : n === 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`)

function BossName({ row }: { row: Pick<BossOutlookRow, 'name' | 'imageUrl'> }) {
  return (
    <span className="inline-flex items-center gap-2">
      {row.imageUrl ? (
        <img src={row.imageUrl} alt="" className="size-8 object-contain [image-rendering:pixelated]" loading="lazy" />
      ) : (
        <span className="inline-flex size-8 items-center justify-center text-muted" aria-hidden>
          <Skull className="size-4" />
        </span>
      )}
      {row.name}
    </span>
  )
}

function Chance({ row }: { row: BossOutlookRow }) {
  const t = TIER[row.tier]
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={t.tone}>{t.label}</Badge>
      <span className="num text-sm">{pct(row.chance)}</span>
    </span>
  )
}

export function BossesPage() {
  const mine = useMyWorlds()
  const [world, setWorld] = useState<string | null>(null)
  const w = world ?? mine[0] ?? null
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('')
  const [hideNone, setHideNone] = useState(true)
  const [selected, setSelected] = useState<BossOutlookRow | null>(null)
  const outlook = useApi('bosses.outlook', { world: w ?? '' }, { enabled: !!w, refetchInterval: 15 * 60_000 })
  const o = outlook.data
  const groups = [...new Set((o?.rows ?? []).map((r) => r.group))]
  const matches = (o?.rows ?? []).filter((r) => (!group || r.group === group) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())))
  const rows = hideNone ? matches.filter((r) => r.tier !== 'none' && r.tier !== 'unknown') : matches
  const hidden = matches.length - rows.length

  return (
    <Page
      title="Bosses"
      subtitle="Qué tan probable es que cada boss salga hoy, según los días desde que lo mataron por última vez (Kill Statistics de tibia.com). Es una pista, no una garantía."
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mundo">
          <WorldPicker value={w} onChange={setWorld} />
        </Field>
        <Field label="Buscar">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del boss" className="w-48" />
        </Field>
        <Field label="Grupo">
          <Select value={group} onChange={(e) => setGroup(e.target.value)} options={[{ value: '', label: 'Todos' }, ...groups.map((g) => ({ value: g, label: g }))]} />
        </Field>
        <Toggle checked={hideNone} onChange={setHideNone} label="Ocultar los que no tienen chance" />
        {w && (
          <Button className="ml-auto" onClick={() => void outlook.refetch()} busy={outlook.isFetching} title="Baja la estadística más reciente de tibia.com">
            <RefreshCw className="size-4" /> Actualizar
          </Button>
        )}
      </div>
      {mine.length > 1 && <MyWorldsSummary worlds={mine} onPick={setWorld} />}
      <ErrorBox error={outlook.error} />
      {o?.syncError && <Warnings items={[`No se pudieron bajar los días recientes (${o.syncError}): la probabilidad usa el historial guardado hasta ${o.through ?? '—'}.`]} />}
      {!w ? (
        <Empty>Elige un mundo (o marca tus mundos con ★ en Mundos).</Empty>
      ) : outlook.isLoading ? (
        <Spinner />
      ) : (
        o && (
          <Card
            title={`${o.world}: ${rows.length} bosses${hidden ? ` (${hidden} ocultos)` : ''}`}
            actions={
              <span className="text-xs text-muted" title={`${o.seed.source}. Intervalos de todos los mundos hasta el ${o.seed.dataThrough ?? '—'}.`}>
                Datos al {statsDate(o.through ?? o.statsDay)}
                {o.through && o.through < o.statsDay ? ` (la estadística del ${statsDate(o.statsDay)} aún no está disponible)` : ''} · historial de {o.world} desde {o.historyFrom ? statsDate(o.historyFrom) : '—'}
              </span>
            }
          >
            <DataTable
              rows={rows}
              rowKey={(r) => r.name}
              pageSize={100}
              initialSort={{ key: 'chance', dir: 'asc' }}
              onRowClick={setSelected}
              empty="Ningún boss con chance hoy en este mundo."
              columns={[
                { key: 'name', header: 'Boss', cell: (r) => <BossName row={r} />, sort: (r) => r.name },
                { key: 'group', header: 'Grupo', cell: (r) => <span className="text-xs text-muted">{r.group}</span>, sort: (r) => r.group },
                { key: 'chance', header: 'Hoy', cell: (r) => <Chance row={r} />, sort: (r) => TIER_ORDER[r.tier] * 10 - (r.chance ?? 0) },
                {
                  key: 'last',
                  header: 'Última vez',
                  cell: (r) =>
                    r.lastSeen ? (
                      <span title="Fecha de la estadística de tibia.com que lo registró (muertes de las 24 h anteriores)">
                        {statsDate(r.lastSeen.day)} <span className="text-xs text-muted">· {ago(diffDays(r.lastSeen.day, o.statsDay))}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted">nunca desde el {o.historyFrom ? statsDate(o.historyFrom) : '—'}</span>
                    ),
                  sort: (r) => r.daysSince ?? 9_999,
                },
                { key: 'window', header: 'Intervalo típico', cell: (r) => (r.intervals ? `${r.intervals.p10}–${r.intervals.p90} días` : '—'), sort: (r) => r.intervals?.p50 ?? null },
                {
                  key: 'next',
                  header: 'Ventana',
                  cell: (r) => (r.windowOpensIn === null ? '—' : r.windowOpensIn === 0 ? <span className="text-good">abierta</span> : `abre ${inDays(r.windowOpensIn)}`),
                  sort: (r) => r.windowOpensIn,
                },
                {
                  key: 'notes',
                  header: '',
                  cell: (r) => (
                    <span className="flex flex-wrap gap-1">
                      {r.maybeAlive && <Badge tone="warn" title="La última vez solo mató jugadores: puede seguir vivo">¿vivo?</Badge>}
                      {r.overdue && <Badge tone="info" title="Pasó su intervalo habitual: pudo aparecer sin que nadie lo matara (no queda registrado)">atrasado</Badge>}
                    </span>
                  ),
                },
              ]}
            />
          </Card>
        )
      )}
      {selected && w && <BossDetail world={w} row={selected} onClose={() => setSelected(null)} />}
    </Page>
  )
}

/** Lo más probable de hoy en cada uno de mis mundos. */
function MyWorldsSummary({ worlds, onPick }: { worlds: string[]; onPick: (w: string) => void }) {
  return (
    <Card title="Hoy en mis mundos">
      <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
        {worlds.map((w) => (
          <WorldTop key={w} world={w} onPick={onPick} />
        ))}
      </div>
    </Card>
  )
}

function WorldTop({ world, onPick }: { world: string; onPick: (w: string) => void }) {
  const o = useApi('bosses.outlook', { world }, { refetchInterval: 15 * 60_000 })
  const top = (o.data?.rows ?? []).filter((r) => r.tier === 'high' || r.tier === 'medium').sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0)).slice(0, 5)
  return (
    <button type="button" onClick={() => onPick(world)} className="rounded-lg border border-line p-2 text-left hover:border-accent">
      <div className="mb-1 text-sm font-medium">{world}</div>
      {o.isLoading ? (
        <Spinner />
      ) : top.length ? (
        <ul className="flex flex-col gap-0.5 text-sm">
          {top.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-2">
              <span className="truncate">{r.name}</span>
              <Chance row={r} />
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-muted">Nada con chance alta o media hoy.</span>
      )}
    </button>
  )
}

function BossDetail({ world, row, onClose }: { world: string; row: BossOutlookRow; onClose: () => void }) {
  const h = useApi('bosses.history', { world, boss: row.name })
  // Sin una aparición registrada no hay un "hoy" en la curva.
  const d = row.noRecord ? null : row.daysSince
  const data = (h.data?.hazard ?? []).map((v, i) => ({ day: i + 1, pct: Math.round(v * 1000) / 10 }))
  return (
    <Modal title={row.name} onClose={onClose} wide>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <BossName row={row} />
          <Chance row={row} />
          <span className="text-muted">{row.group}</span>
          {row.expectedIn !== null && <span className="text-muted">50 % de probabilidad acumulada {inDays(row.expectedIn)}</span>}
        </div>
        <ErrorBox error={h.error} />
        {h.data && (
          <>
            <Card title="Probabilidad diaria según días sin aparecer (todos los mundos)">
              <div className="h-64 p-2">
                <ResponsiveContainer>
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="day" stroke="var(--muted)" fontSize={11} />
                    <YAxis unit=" %" stroke="var(--muted)" fontSize={11} width={48} />
                    <Tooltip formatter={(v) => [`${String(v)} %`, 'Probabilidad']} labelFormatter={(l) => `Día ${String(l)} sin aparecer`} />
                    <Bar dataKey="pct" fill="var(--accent)" isAnimationActive={false} />
                    {d !== null && d <= data.length && <ReferenceLine x={d} stroke="var(--good)" strokeWidth={2} label={{ value: 'hoy', fill: 'var(--good)', fontSize: 11, position: 'top' }} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="px-3 pb-3 text-xs text-muted">
                {h.data.intervals
                  ? `${h.data.intervals.n} intervalos registrados: mínimo ${h.data.intervals.min}, mediana ${h.data.intervals.p50}, 90 % antes de ${h.data.intervals.p90} días.`
                  : 'Sin intervalos registrados.'}{' '}
                Más allá del día {data.length}: {pct(h.data.tailHazard)} por día. Solo cuenta si alguien lo mató o murió contra él.
              </p>
            </Card>
            <Card title={`Apariciones registradas en ${world}`}>
              <DataTable
                rows={h.data.sightings}
                rowKey={(s) => s.day}
                pageSize={20}
                empty="Sin apariciones en el historial disponible."
                columns={[
                  { key: 'day', header: 'Estadística de tibia.com', cell: (s) => statsDate(s.day) },
                  { key: 'k', header: 'Muertes', cell: (s) => s.killed, align: 'right' },
                  { key: 'p', header: 'Jugadores que mató', cell: (s) => s.playersKilled, align: 'right' },
                ]}
              />
            </Card>
            <p className="text-xs text-muted">Actualizado {formatDateTime(new Date().toISOString())}. Fuente: Kill Statistics de tibia.com (vía TibiaData y el historial de tibiamaps).</p>
          </>
        )}
      </div>
    </Modal>
  )
}
