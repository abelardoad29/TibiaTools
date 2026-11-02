import { useState } from 'react'
import { Link } from 'react-router'
import { CloudDownload } from 'lucide-react'
import type { BookView, ItemSummary, StatsRow } from '@shared/api'
import { useApi, useApiMutation } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Confidence, Freshness, Gp, ItemIcon, ItemPicker, ProvenanceBadge, WorldPicker } from '../../components/data'
import { Button, Card, DataTable, Empty, ErrorBox, Field, Page, Toggle } from '../../components/ui'

function Book({ title, book }: { title: string; book: BookView | null }) {
  return (
    <Card
      title={title}
      actions={
        book && (
          <span className="flex items-center gap-2">
            <ProvenanceBadge kind={book.source} /> <Freshness at={book.observedAt} />
          </span>
        )
      }
    >
      {!book ? (
        <Empty>Sin snapshot de este lado.</Empty>
      ) : (
        <DataTable
          rows={book.offers}
          rowKey={(o) => `${o.unitPrice}-${o.amount}-${o.expiresAt}`}
          pageSize={25}
          empty="El snapshot no tenía ofertas de este lado (libro vacío observado)."
          columns={[
            { key: 'p', header: 'Precio', cell: (o) => <Gp value={o.unitPrice} />, align: 'right' },
            { key: 'a', header: 'Cantidad', cell: (o) => o.amount.toLocaleString('en-US'), align: 'right' },
            { key: 't', header: 'Total', cell: (o) => <Gp value={o.totalPrice ?? o.unitPrice * o.amount} short />, align: 'right' },
            { key: 'e', header: 'Vence', cell: (o) => (o.expiresAt ? formatDateTime(o.expiresAt) : '—') },
            { key: 'c', header: 'Confianza', cell: (o) => <Confidence value={o.priceConfidence !== null && o.amountConfidence !== null ? Math.min(o.priceConfidence, o.amountConfidence) : null} /> },
          ]}
        />
      )}
      {book && <div className="mt-2 text-xs text-muted">Observado {formatDateTime(book.observedAt)} · scan {book.scanId.slice(0, 8)}</div>}
    </Card>
  )
}

export function StatsTable({ rows }: { rows: StatsRow[] }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(s) => `${s.source}-${s.window}-${s.side}-${s.observedAt}`}
      empty="Sin estadísticas. Captura la vista Details del Market para tener transacciones oficiales de 30 días."
      columns={[
        { key: 'src', header: 'Fuente', cell: (s) => <ProvenanceBadge kind={s.source === 'own_capture' ? 'official_stats' : s.source} /> },
        { key: 'w', header: 'Ventana', cell: (s) => s.window },
        { key: 's', header: 'Lado', cell: (s) => (s.side === 'sell' ? 'Sell offers' : 'Buy offers') },
        { key: 'tx', header: 'Transacciones', cell: (s) => s.transactions?.toLocaleString('en-US') ?? '—', align: 'right' },
        { key: 'avg', header: 'Promedio', cell: (s) => <Gp value={s.avgPrice} />, align: 'right' },
        { key: 'min', header: 'Mínimo', cell: (s) => <Gp value={s.minPrice} />, align: 'right' },
        { key: 'max', header: 'Máximo', cell: (s) => <Gp value={s.maxPrice} />, align: 'right' },
        { key: 'at', header: 'Dato', cell: (s) => <Freshness at={s.observedAt} /> },
      ]}
    />
  )
}

export function MarketExplorerPage() {
  const settings = useApi('app.settings.get', undefined)
  const [world, setWorld] = useState<string | null>(null)
  const [item, setItem] = useState<ItemSummary | null>(null)
  const [thirdParty, setThirdParty] = useState(true)
  const w = world ?? settings.data?.homeWorld ?? null
  const book = useApi('market.book', { world: w ?? '', itemId: item?.id ?? 0, includeThirdParty: thirdParty }, { enabled: !!w && !!item })
  const withData = useApi('market.itemsWithData', { world: w ?? '' }, { enabled: !!w })
  const tpWorlds = useApi('market.thirdParty.worlds', undefined, { enabled: false })
  const importer = useApiMutation('market.thirdParty.import', ['market.book', 'market.itemsWithData', 'market.coverage', 'app.info'])

  return (
    <Page
      title="Market"
      subtitle="Snapshots por mundo e item. Cada lado muestra de dónde salió y su antigüedad."
      actions={<Toggle checked={thirdParty} onChange={setThirdParty} label="Incluir datos de terceros" />}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mundo">
          <WorldPicker value={w} onChange={setWorld} allowEmpty />
        </Field>
        <Field label="Item">
          <ItemPicker value={item} onChange={setItem} />
        </Field>
        <Button disabled={!w || !item} busy={importer.isPending} onClick={() => w && item?.tibiaItemId && importer.mutate({ world: w, itemIds: [item.tibiaItemId] })} title="Order book completo de este item (tibiamarket.top)">
          <CloudDownload className="size-4" /> Order book de terceros
        </Button>
        <Button disabled={!w} busy={importer.isPending} onClick={() => w && importer.mutate({ world: w, itemIds: null })} title="Mejores precios y estadísticas de todos los items del mundo (sin profundidad)">
          <CloudDownload className="size-4" /> Precios de terceros del mundo
        </Button>
      </div>
      <ErrorBox error={importer.error ?? book.error} />
      {importer.data && (
        <p className="text-sm text-muted">
          Terceros: {importer.data.scans} order books, {importer.data.offers} ofertas, {importer.data.stats} estadísticas; {importer.data.skipped} omitidos (repetidos o fuera del catálogo).
          {importer.data.errors.length > 0 && <span className="text-warn"> Errores: {importer.data.errors.join('; ')}</span>}
        </p>
      )}

      {w && item ? (
        <>
          <div className="flex items-center gap-3">
            <ItemIcon item={item} size={40} />
            <div>
              <div className="text-lg font-semibold">{item.name}</div>
              <div className="text-xs text-muted">
                {w} · <Link className="text-accent" to={`/history?world=${encodeURIComponent(w)}&item=${item.id}`}>ver histórico →</Link>
              </div>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Book title="Sell offers (para comprar)" book={book.data?.sell ?? null} />
            <Book title="Buy offers (para vender al instante)" book={book.data?.buy ?? null} />
          </div>
          <Card title="Estadísticas">
            <StatsTable rows={book.data?.stats ?? []} />
          </Card>
        </>
      ) : (
        <Empty>Elige mundo e item.</Empty>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {w && (
          <Card title={`Items con datos en ${w} (${withData.data?.length ?? 0})`}>
            <div className="flex max-h-72 flex-wrap gap-1.5 overflow-auto">
              {(withData.data ?? []).map((i) => (
                <button key={i.id} onClick={() => setItem(i)} className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs hover:border-accent" title={i.name}>
                  <ItemIcon item={i} size={20} /> {i.name}
                </button>
              ))}
              {withData.data?.length === 0 && <Empty>Sin datos en este mundo.</Empty>}
            </div>
          </Card>
        )}
        <Card
          title="Frescura de tibiamarket.top"
          actions={
            <Button onClick={() => void tpWorlds.refetch()} busy={tpWorlds.isFetching}>
              Consultar
            </Button>
          }
        >
          <p className="mb-2 text-xs text-muted">Último escaneo de terceros por mundo. Útil para decidir qué capturar tú.</p>
          <DataTable
            rows={tpWorlds.data ?? []}
            rowKey={(r) => r.world}
            pageSize={10}
            initialSort={{ key: 'at', dir: 'desc' }}
            empty="Pulsa Consultar."
            columns={[
              { key: 'w', header: 'Mundo', cell: (r) => r.world, sort: (r) => r.world },
              { key: 'at', header: 'Último escaneo', cell: (r) => <Freshness at={r.lastUpdate} staleHours={72} />, sort: (r) => r.lastUpdate },
            ]}
          />
        </Card>
      </div>
    </Page>
  )
}
