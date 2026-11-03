import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Bell, Crosshair, RefreshCw, ScanText } from 'lucide-react'
import creatureGifs from '@seed/creature_gifs.json'
import { rashidLocation } from '@core/domain/tools/rashid'
import { platform } from '../../platform'
import { useApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Freshness, ProvenanceBadge, useMyWorlds } from '../../components/data'
import { Badge, Button, Card, DataTable, Empty, Page, Spinner } from '../../components/ui'

// Fallback de imágenes heredado de la v1: GIFs de TibiaWiki BR por nombre de criatura.
const GIFS = creatureGifs as Record<string, string>
const nf = new Intl.NumberFormat('es-MX')

function Creature({ title, name, imageUrl }: { title: string; name: string | null; imageUrl: string | null }) {
  const [src, setSrc] = useState(imageUrl ?? (name ? GIFS[name] : null) ?? null)
  useEffect(() => setSrc(imageUrl ?? (name ? GIFS[name] : null) ?? null), [imageUrl, name])
  const fallback = () => setSrc((cur) => (name && GIFS[name] && cur !== GIFS[name] ? GIFS[name] : null))
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-panel-2 p-3 text-center">
      <div className="text-xs text-muted">{title}</div>
      {src ? <img src={src} alt={name ?? ''} className="pixel h-20 w-20 object-contain" onError={fallback} /> : <div className="h-20 w-20" />}
      <div className="font-semibold">{name ?? '—'}</div>
    </div>
  )
}

/** Atajo con contador: lleva a la sección donde hay algo pendiente. */
function Pending({ to, icon: Icon, label, count, tone }: { to: string; icon: typeof Bell; label: string; count: number | null; tone: 'bad' | 'accent' }) {
  const active = (count ?? 0) > 0
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2 hover:border-accent">
      <Icon className={`size-5 ${active ? (tone === 'bad' ? 'text-bad' : 'text-accent') : 'text-muted'}`} aria-hidden />
      <span className="text-sm">{label}</span>
      <span className={`num ml-auto text-lg font-semibold ${active ? '' : 'text-muted'}`}>{count ?? '—'}</span>
    </Link>
  )
}

/** Un mundo propio: conectados ahora y los bosses con más chance hoy. */
function MyWorld({ world, online }: { world: string; online: number | null }) {
  const bosses = useApi('bosses.outlook', { world }, { refetchInterval: 15 * 60_000 })
  const top = (bosses.data?.rows ?? []).filter((r) => r.tier === 'high' || r.tier === 'medium').sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0)).slice(0, 3)
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{world}</span>
        <span className="text-xs text-muted">{online !== null ? `${nf.format(online)} online` : ''}</span>
      </div>
      {bosses.isLoading ? (
        <Spinner />
      ) : top.length ? (
        <ul className="flex flex-col gap-0.5 text-sm">
          {top.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-2">
              <span className="truncate">{r.name}</span>
              <Badge tone={r.tier === 'high' ? 'good' : 'warn'}>{Math.round((r.chance ?? 0) * 100)} %</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-muted">Ningún boss con chance alta o media hoy.</span>
      )}
      <Link to="/bosses" className="mt-auto text-xs text-accent">
        Todos los bosses →
      </Link>
    </div>
  )
}

export function OverviewPage() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const rashid = rashidLocation(now)
  const boosted = useApi('tools.boosted', { refresh: false })
  const desktop = platform.kind === 'electron'
  const mine = useMyWorlds()
  const live = useApi('catalog.worlds.live', undefined, { enabled: mine.length > 0, refetchInterval: 60_000 })
  const coverage = useApi('market.coverage', undefined, { enabled: desktop })
  const runs = useApi('analysis.runs.list', { limit: 5 }, { enabled: desktop })
  const events = useApi('characters.events', { limit: 8 }, { enabled: desktop })
  // Mismas consultas que el menú lateral: comparten caché.
  const online = useApi('watch.online', undefined, { enabled: desktop })
  const shots = useApi('collector.screenshots.list', { status: null, limit: 100 }, { enabled: desktop })
  const unread = useApi('alerts.events.list', { unreadOnly: true, limit: 50 }, { enabled: desktop })
  const onlineByWorld = new Map((live.data?.worlds ?? []).map((w) => [w.name, w.playersOnline]))

  return (
    <Page title="Inicio" subtitle="Lo de hoy en Tibia y en tus mundos.">
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Card
          title="Hoy en Tibia"
          actions={
            <Button variant="ghost" onClick={() => void boosted.refetch()} busy={boosted.isFetching} aria-label="Actualizar boosted">
              <RefreshCw className="size-4" />
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-panel-2 p-3 text-center">
              <div className="text-xs text-muted">¿Dónde está Rashid?</div>
              <img src="./Rashid.gif" alt="Rashid" className="pixel h-20 w-20 object-contain" />
              <div className="font-semibold">{rashid.city}</div>
              <div className="text-[11px] text-muted">Mañana (tras el server save): {rashid.nextCity}</div>
            </div>
            <Creature title="Boosted creature" name={boosted.data?.creature?.name ?? null} imageUrl={boosted.data?.creature?.imageUrl ?? null} />
            <Creature title="Boosted boss" name={boosted.data?.boss?.name ?? null} imageUrl={boosted.data?.boss?.imageUrl ?? null} />
          </div>
          <div className="mt-2 text-xs text-muted">
            Fuente: TibiaData · {boosted.data?.fetchedAt ? `consultado ${formatDateTime(boosted.data.fetchedAt)}` : 'sin consultar'}
            {boosted.data?.error && <span className="text-warn"> · {boosted.data.error}</span>}
          </div>
        </Card>

        {desktop ? (
          <Card title="Mis mundos hoy" actions={<Link className="text-xs text-accent" to="/worlds">Elegir mundos →</Link>}>
            {mine.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {mine.slice(0, 6).map((w) => (
                  <MyWorld key={w} world={w} online={onlineByWorld.get(w) ?? null} />
                ))}
              </div>
            ) : (
              <Empty>Marca con ★ en Mundos los mundos en los que juegas: aquí verás sus conectados y los bosses con chance de hoy.</Empty>
            )}
          </Card>
        ) : (
          <Card title="Mis mundos">
            <Empty>Los bosses y la vigilancia necesitan la app de escritorio.</Empty>
          </Card>
        )}
      </div>

      {desktop && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Pending to="/hunted" icon={Crosshair} label="Vigilados conectados" count={online.data?.length ?? null} tone="bad" />
          <Pending to="/ocr" icon={ScanText} label="Capturas por revisar" count={shots.data ? shots.data.filter((s) => s.status === 'new' || s.status === 'processed').length : null} tone="accent" />
          <Pending to="/alerts" icon={Bell} label="Alertas sin leer" count={unread.data?.length ?? null} tone="accent" />
        </div>
      )}

      {desktop && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Cobertura del Market" actions={<Link className="text-xs text-accent" to="/collector">Capturar →</Link>}>
            <DataTable
              rows={coverage.data ?? []}
              rowKey={(r) => r.world}
              pageSize={8}
              empty="Todavía no hay datos de Market. Toma screenshots del Market con la tecla de Tibia o baja los precios de terceros en Market."
              columns={[
                { key: 'world', header: 'Mundo', cell: (r) => (mine.includes(r.world) ? `★ ${r.world}` : r.world), sort: (r) => (mine.includes(r.world) ? `0${r.world}` : `1${r.world}`) },
                { key: 'items', header: 'Items', cell: (r) => nf.format(r.items), sort: (r) => r.items, align: 'right' },
                { key: 'own', header: 'Propios', cell: (r) => r.ownScans, sort: (r) => r.ownScans, align: 'right' },
                { key: 'tp', header: 'Terceros', cell: (r) => nf.format(r.thirdPartyScans), sort: (r) => r.thirdPartyScans, align: 'right' },
                { key: 'last', header: 'Último dato', cell: (r) => <Freshness at={r.lastObservedAt} />, sort: (r) => r.lastObservedAt },
              ]}
            />
          </Card>
          <div className="flex flex-col gap-4">
            <Card title="Análisis recientes" actions={<Link className="text-xs text-accent" to="/arbitrage">Arbitraje →</Link>}>
              {runs.data?.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {runs.data.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span>
                        {r.origin} → {r.destination} <span className="text-xs text-muted">({r.strategy})</span>
                      </span>
                      <span className="text-xs text-muted">
                        {r.opportunities} items · {formatDateTime(r.startedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Sin análisis todavía.</Empty>
              )}
            </Card>
            <Card title="Personajes seguidos" actions={<Link className="text-xs text-accent" to="/tools">Herramientas →</Link>}>
              {events.data?.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {events.data.map((e) => (
                    <li key={e.id} className="flex justify-between gap-2">
                      <span>{e.message}</span>
                      <span className="shrink-0 text-xs text-muted">{formatDateTime(e.detectedAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Sin eventos. Agrega personajes en Herramientas → Personajes.</Empty>
              )}
            </Card>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        Las cifras de Market se marcan siempre con su procedencia: <ProvenanceBadge kind="own_capture" /> <ProvenanceBadge kind="official_stats" /> <ProvenanceBadge kind="third_party" />{' '}
        <ProvenanceBadge kind="inferred" /> <ProvenanceBadge kind="estimated" />
      </p>
    </Page>
  )
}
