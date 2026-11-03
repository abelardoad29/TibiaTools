import { CloudDownload, X } from 'lucide-react'
import { Link } from 'react-router'
import { useApi, useApiMutation } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Freshness } from '../../components/data'
import { Badge, Button, Card, DataTable, ErrorBox } from '../../components/ui'

/** Descarga masiva de precios de tibiamarket.top: todos los items de todos los mundos (o de uno). */
export function ThirdPartySyncCard({ world }: { world: string | null }) {
  const data = useApi('market.thirdParty.status', undefined)
  const sync = useApiMutation('market.thirdParty.sync', ['market.thirdParty.status'])
  const cancel = useApiMutation('market.thirdParty.cancel', ['market.thirdParty.status'])
  const s = data.data?.status
  const rows = data.data?.worlds ?? []
  const pct = s && s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
  const imported = rows.filter((r) => r.importedAt).length

  return (
    <Card
      title="Precios de terceros (tibiamarket.top)"
      actions={
        <span className="flex flex-wrap gap-2">
          {s?.running ? (
            <Button onClick={() => cancel.mutate(undefined)} busy={cancel.isPending}>
              <X className="size-4" /> Cancelar
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => sync.mutate({ worlds: null, force: false })} busy={sync.isPending} title="Baja todos los items de cada mundo; se salta los que no cambiaron">
                <CloudDownload className="size-4" /> Actualizar todos los mundos
              </Button>
              {world && (
                <Button onClick={() => sync.mutate({ worlds: [world], force: true })} busy={sync.isPending} title={`Vuelve a bajar todos los items de ${world}`}>
                  Solo {world}
                </Button>
              )}
            </>
          )}
        </span>
      }
    >
      <p className="mb-2 text-xs text-muted">
        Una consulta por mundo trae todos sus items. tibiamarket.top permite 1 consulta cada 5 s: la primera vez tarda ~9 min (~2 MB por mundo en disco), después solo se bajan los mundos con un escaneo nuevo. Sus
        datos pueden tener semanas; se marcan como «Terceros».
        {s?.nextAutoAt ? (
          <> Próxima revisión automática: {formatDateTime(s.nextAutoAt)}.</>
        ) : (
          <>
            {' '}
            Revisión automática desactivada (<Link className="text-accent" to="/settings">Ajustes</Link>).
          </>
        )}
      </p>
      <ErrorBox error={sync.error ?? data.error} />
      {s && (s.running || s.finishedAt) && (
        <div className="mb-3 flex flex-col gap-1 text-sm" aria-live="polite">
          <div className="h-2 overflow-hidden rounded bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent transition-[width]" style={{ width: `${s.running ? pct : 100}%` }} />
          </div>
          <div className="text-xs text-muted">
            {s.running ? (s.current ? `Descargando ${s.current} (${s.done + 1}/${s.total})…` : 'Consultando la lista de mundos…') : `Última corrida: ${formatDateTime(s.finishedAt)}`} · {s.imported} importados ·{' '}
            {s.unchanged} sin cambios{s.failed > 0 && ` · ${s.failed} con error`}
          </div>
          {s.error && <div className="text-xs text-warn">{s.error}</div>}
        </div>
      )}
      <DataTable
        rows={rows}
        rowKey={(r) => r.world}
        pageSize={15}
        initialSort={{ key: 'data', dir: 'desc' }}
        empty="Sin mundos."
        columns={[
          { key: 'w', header: `Mundo (${imported}/${rows.length} con datos)`, cell: (r) => r.world, sort: (r) => r.world },
          {
            key: 'data',
            header: 'Datos de',
            cell: (r) => (r.dataAt ? <Freshness at={r.dataAt} staleHours={24 * 14} /> : r.latestRemoteAt ? <span className="text-xs text-muted">sin importar</span> : '—'),
            sort: (r) => r.dataAt,
          },
          { key: 'imp', header: 'Importado', cell: (r) => formatDateTime(r.importedAt), sort: (r) => r.importedAt },
          { key: 'n', header: 'Items', cell: (r) => (r.items ? r.items.toLocaleString('en-US') : '—'), sort: (r) => r.items, align: 'right' },
          {
            key: 'st',
            header: 'Estado',
            cell: (r) =>
              r.error ? (
                <Badge tone="bad" title={r.error}>
                  Error
                </Badge>
              ) : r.tracked === false ? (
                <Badge title="tibiamarket.top no publica este mundo">No disponible</Badge>
              ) : r.latestRemoteAt && r.dataAt && r.latestRemoteAt !== r.dataAt ? (
                <Badge tone="warn">Hay datos nuevos</Badge>
              ) : r.dataAt ? (
                <Badge tone="good">Al día</Badge>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </Card>
  )
}
