import { useMemo, useState } from 'react'
import { ExternalLink, ShieldCheck, Star } from 'lucide-react'
import type { World } from '@shared/api'
import { useApi, useApiMutation } from '../../lib/api'
import { formatAge, formatDateTime } from '../../lib/format'
import { RouteBadge, useMyWorlds } from '../../components/data'
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Modal, Page, Select, Spinner, Stat, Toggle } from '../../components/ui'

const nf = new Intl.NumberFormat('es-MX')
const tibiaUrl = (name: string) => `https://www.tibia.com/community/?subtopic=worlds&world=${encodeURIComponent(name)}`

/** Escudo de BattlEye como en tibia.com: verde = protegido desde el lanzamiento, amarillo = desde una fecha. */
function BattlEyeIcon({ date, isProtected }: { date: string | null; isProtected: boolean | null }) {
  if (!isProtected || !date) return <span className="text-muted" title="Sin protección de BattlEye">—</span>
  const initial = date === 'release'
  const label = initial ? 'Protegido por BattlEye desde el lanzamiento' : `Protegido por BattlEye desde ${date}`
  return (
    <span title={label} className="inline-flex">
      <ShieldCheck className={`size-5 ${initial ? 'text-good' : 'text-warn'}`} aria-label={label} />
    </span>
  )
}

/** Estrella para agregar o quitar el mundo de "Mis mundos" (Ajustes). */
function StarToggle({ world }: { world: string }) {
  const settings = useApi('app.settings.get', undefined)
  const set = useApiMutation('app.settings.set', ['app.settings.get'])
  const favs = settings.data?.favoriteWorlds ?? []
  const on = favs.includes(world)
  return (
    <button
      type="button"
      className={on ? 'text-warn' : 'text-muted hover:text-warn'}
      aria-pressed={on}
      aria-label={on ? `Quitar ${world} de mis mundos` : `Agregar ${world} a mis mundos`}
      title={on ? 'Quitar de mis mundos' : 'Agregar a mis mundos'}
      onClick={(e) => {
        e.stopPropagation()
        set.mutate({ favoriteWorlds: on ? favs.filter((w) => w !== world) : [...favs, world] })
      }}
    >
      <Star className="size-4" fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

interface Row extends World {
  online: number | null
  status: string | null
}

export function WorldsPage() {
  const worlds = useApi('catalog.worlds.list', { activeOnly: true })
  // TibiaData refresca la lista de tibia.com cada minuto aprox.
  const live = useApi('catalog.worlds.live', undefined, { refetchInterval: 60_000 })
  const mine = useMyWorlds()
  const [q, setQ] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [region, setRegion] = useState('')
  const [pvp, setPvp] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const byName = new Map((live.data?.worlds ?? []).map((w) => [w.name, w]))
    return (worlds.data ?? []).map((w) => ({ ...w, online: byName.get(w.name)?.playersOnline ?? null, status: byName.get(w.name)?.status ?? null }))
  }, [worlds.data, live.data])
  const filtered = rows.filter(
    (w) => (!onlyMine || mine.includes(w.name)) && (!region || w.region === region) && (!pvp || w.pvpType === pvp) && (!q.trim() || w.name.toLowerCase().includes(q.trim().toLowerCase())),
  )
  const maxOnline = Math.max(1, ...rows.map((w) => w.online ?? 0))
  const distinct = (k: 'region' | 'pvpType') => [...new Set(rows.map((w) => w[k]).filter((x): x is string => !!x))].sort()
  const mineOnline = rows.filter((w) => mine.includes(w.name)).reduce((s, w) => s + (w.online ?? 0), 0)

  return (
    <Page title="Mundos" subtitle="Conectados en vivo de tibia.com. Marca con ★ los mundos en los que juegas: salen primero en toda la app.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Jugadores online (todos los mundos)" value={live.data?.totalOnline != null ? nf.format(live.data.totalOnline) : '—'} hint={live.data ? `actualizado ${formatAge(live.data.fetchedAt)}` : undefined} />
        <Stat label="En mis mundos" value={mine.length ? nf.format(mineOnline) : '—'} hint={mine.length ? mine.join(', ') : 'Marca tus mundos con ★'} />
        <Stat label="Récord global" value={live.data?.record ? nf.format(live.data.record.players) : '—'} hint={live.data?.record ? formatDateTime(live.data.record.date) : undefined} />
        <Stat label="Mundos activos" value={rows.length || '—'} hint={`${rows.filter((w) => w.status === 'offline').length} offline ahora`} />
      </div>
      <ErrorBox error={live.error ?? worlds.error} />
      <Card>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="Buscar">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del mundo" className="w-48" />
          </Field>
          <Field label="Región">
            <Select value={region} onChange={(e) => setRegion(e.target.value)} options={[{ value: '', label: 'Todas' }, ...distinct('region').map((r) => ({ value: r, label: r }))]} />
          </Field>
          <Field label="PvP">
            <Select value={pvp} onChange={(e) => setPvp(e.target.value)} options={[{ value: '', label: 'Todos' }, ...distinct('pvpType').map((r) => ({ value: r, label: r }))]} />
          </Field>
          <Toggle checked={onlyMine} onChange={setOnlyMine} label="Solo mis mundos" />
          <span className="ml-auto flex items-center gap-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-4 text-good" aria-hidden /> BattlEye desde el lanzamiento
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-4 text-warn" aria-hidden /> desde una fecha
            </span>
          </span>
        </div>
        <DataTable
          rows={filtered}
          rowKey={(w) => w.id}
          pageSize={100}
          initialSort={{ key: 'online', dir: 'desc' }}
          onRowClick={(w) => setSelected(w.name)}
          empty={onlyMine ? 'Aún no marcas mundos: usa la estrella.' : 'Sin mundos.'}
          columns={[
            { key: 'star', header: '', cell: (w) => <StarToggle world={w.name} />, sort: (w) => (mine.includes(w.name) ? 0 : 1) },
            { key: 'name', header: 'Mundo', cell: (w) => <span className={w.status === 'offline' ? 'text-muted' : ''}>{w.name}</span>, sort: (w) => w.name },
            {
              key: 'online',
              header: 'Online',
              align: 'right',
              sort: (w) => w.online ?? -1,
              cell: (w) =>
                w.status === 'offline' ? (
                  <Badge tone="bad">offline</Badge>
                ) : w.online === null ? (
                  '—'
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-panel-2 md:inline-block" aria-hidden>
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((w.online / maxOnline) * 100)}%` }} />
                    </span>
                    <span className="num">{nf.format(w.online)}</span>
                  </span>
                ),
            },
            { key: 'region', header: 'Región', cell: (w) => w.region ?? '—', sort: (w) => w.region },
            { key: 'pvp', header: 'PvP', cell: (w) => w.pvpType ?? '—', sort: (w) => w.pvpType },
            {
              key: 'be',
              header: 'BattlEye',
              cell: (w) => <BattlEyeIcon date={w.battleyeDate} isProtected={w.battleyeProtected} />,
              // Primero los protegidos desde el lanzamiento, luego por fecha.
              sort: (w) => (w.battleyeDate === 'release' ? '0' : (w.battleyeDate ?? '9')),
              align: 'center',
            },
            { key: 'tt', header: 'Transferencia', cell: (w) => (w.transferType === 'blocked' ? <RouteBadge status="blocked" /> : (w.transferType ?? '—')), sort: (w) => w.transferType },
            { key: 'prem', header: 'Premium', cell: (w) => (w.premiumOnly ? <Badge tone="warn">solo premium</Badge> : '—'), sort: (w) => (w.premiumOnly ? 0 : 1) },
            { key: 'type', header: 'Tipo', cell: (w) => w.gameWorldType ?? '—', sort: (w) => w.gameWorldType },
          ]}
        />
      </Card>
      {selected && <WorldDetailModal name={selected} onClose={() => setSelected(null)} />}
    </Page>
  )
}

function Bars({ rows, total }: { rows: { label: string; count: number }[]; total: number }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[6rem_1fr_3.5rem] items-center gap-2">
          <span className="truncate text-muted">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-panel-2" aria-hidden>
            <span className="block h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((r.count / total) * 100) : 0}%` }} />
          </span>
          <span className="num text-right">{nf.format(r.count)}</span>
        </li>
      ))}
    </ul>
  )
}

function WorldDetailModal({ name, onClose }: { name: string; onClose: () => void }) {
  const d = useApi('catalog.worlds.detail', { name }, { refetchInterval: 60_000 })
  const w = d.data
  return (
    <Modal title={name} onClose={onClose} wide>
      <div className="flex flex-col gap-4 p-4">
        <ErrorBox error={d.error} />
        {!w ? (
          d.isLoading && <Spinner />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {w.status === 'online' ? <Badge tone="good">online</Badge> : <Badge tone="bad">{w.status ?? 'desconocido'}</Badge>}
              <span className="text-muted">
                {w.location ?? '?'} · {w.pvpType ?? '?'} · {w.gameWorldType ?? '?'}
                {w.premiumOnly ? ' · solo premium' : ''}
              </span>
              <BattlEyeIcon date={w.battleyeDate} isProtected={w.battleyeProtected} />
              <StarToggle world={w.name} />
              <a className="ml-auto inline-flex items-center gap-1 text-xs text-accent" href={tibiaUrl(w.name)} target="_blank" rel="noreferrer">
                Ver en tibia.com <ExternalLink className="size-3" />
              </a>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Online ahora" value={nf.format(w.playersOnline)} hint={`actualizado ${formatAge(w.fetchedAt)}`} />
              <Stat label="Récord" value={w.recordPlayers != null ? nf.format(w.recordPlayers) : '—'} hint={w.recordDate ? formatDateTime(w.recordDate) : undefined} />
              <Stat label="Creado" value={w.creationDate ?? '—'} />
              <Stat label="Nivel online (mediana / máx.)" value={w.summary.levels ? `${nf.format(w.summary.levels.median)} / ${nf.format(w.summary.levels.max)}` : '—'} />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card title="Vocaciones online">
                <div className="p-3">{w.summary.vocations.length ? <Bars rows={w.summary.vocations.map((v) => ({ label: v.vocation, count: v.count }))} total={w.playersOnline} /> : <Empty>Nadie online.</Empty>}</div>
              </Card>
              <Card title="Niveles online">
                <div className="p-3">
                  <Bars rows={w.summary.buckets} total={w.playersOnline} />
                </div>
              </Card>
              <Card title="Top niveles online">
                <ol className="flex flex-col gap-0.5 p-3 text-sm">
                  {w.summary.top.map((p, i) => (
                    <li key={p.name} className="flex justify-between gap-2">
                      <span className="truncate">
                        <span className="text-muted">{i + 1}.</span> {p.name} <span className="text-xs text-muted">{p.vocation}</span>
                      </span>
                      <span className="num">{nf.format(p.level)}</span>
                    </li>
                  ))}
                  {w.summary.top.length === 0 && <Empty>Nadie online.</Empty>}
                </ol>
              </Card>
            </div>
            <Card title="Títulos de world quests">
              <div className="flex flex-wrap gap-1.5 p-3">
                {w.questTitles.length ? w.questTitles.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-sm text-muted">Este mundo aún no completó world quests.</span>}
              </div>
            </Card>
            <div className="flex justify-end">
              <Button onClick={() => void d.refetch()} busy={d.isFetching}>
                Actualizar
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
