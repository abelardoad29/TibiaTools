import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { RefreshCw } from 'lucide-react'
import creatureGifs from '@seed/creature_gifs.json'
import { rashidLocation } from '@core/domain/tools/rashid'
import { platform } from '../../platform'
import { useApi } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Freshness, ProvenanceBadge } from '../../components/data'
import { Button, Card, DataTable, Empty, ErrorBox, Page, Spinner, Stat } from '../../components/ui'

// Fallback de imágenes heredado de la v1: GIFs de TibiaWiki BR por nombre de criatura.
const GIFS = creatureGifs as Record<string, string>

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

export function OverviewPage() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const rashid = rashidLocation(now)
  const boosted = useApi('tools.boosted', { refresh: false })
  const desktop = platform.kind === 'electron'
  const info = useApi('app.info', undefined)
  const coverage = useApi('market.coverage', undefined, { enabled: desktop })
  const runs = useApi('analysis.runs.list', { limit: 5 }, { enabled: desktop })
  const events = useApi('characters.events', { limit: 8 }, { enabled: desktop })

  return (
    <Page title="Inicio" subtitle="Resumen del día y estado de tus datos.">
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

        <Card title="Estado de los datos">
          {info.isLoading ? (
            <Spinner />
          ) : info.error ? (
            <ErrorBox error={info.error} />
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <Stat label="Mundos activos" value={info.data!.counts.worlds} />
              <Stat label="Items en catálogo" value={info.data!.counts.items.toLocaleString('es')} />
              <Stat label="Capturas" value={info.data!.counts.screenshots} />
              <Stat label="Scans propios" value={info.data!.counts.ownScans} />
              <Stat label="Scans de terceros" value={info.data!.counts.thirdPartyScans} />
              <Stat label="Esquema DB" value={`v${info.data!.schemaVersion}`} hint={info.data!.platform === 'web' ? 'companion web' : undefined} />
            </div>
          )}
        </Card>
      </div>

      {desktop && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Cobertura del Market" actions={<Link className="text-xs text-accent" to="/collector">Capturar →</Link>}>
            <DataTable
              rows={coverage.data ?? []}
              rowKey={(r) => r.world}
              pageSize={8}
              empty="Todavía no hay datos de Market. Captura una pantalla en Collector o importa datos de terceros en Market."
              columns={[
                { key: 'world', header: 'Mundo', cell: (r) => r.world, sort: (r) => r.world },
                { key: 'items', header: 'Items', cell: (r) => r.items, sort: (r) => r.items, align: 'right' },
                { key: 'own', header: 'Propios', cell: (r) => r.ownScans, sort: (r) => r.ownScans, align: 'right' },
                { key: 'tp', header: 'Terceros', cell: (r) => r.thirdPartyScans, sort: (r) => r.thirdPartyScans, align: 'right' },
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
