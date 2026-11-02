import { useCallback, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { ItemSummary } from '@shared/api'
import { groupNpcTrades, TRAVELLING_NPCS } from '@core/domain/catalog/npcs'
import { rashidLocation } from '@core/domain/tools/rashid'
import { platform } from '../../platform'
import { useApi, useApiMutation, useEvent } from '../../lib/api'
import { formatDateTime, parseIntOrNull } from '../../lib/format'
import { Gp, ItemIcon, RouteBadge } from '../../components/data'
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Modal, Page, Select, Spinner, Tabs, TriState } from '../../components/ui'

export function CatalogPage() {
  const [tab, setTab] = useState<'items' | 'worlds'>('items')
  return (
    <Page title="Catálogo" subtitle="Items (IDs del cliente, categorías, precios NPC e iconos) y mundos.">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'items', label: 'Items' },
          { id: 'worlds', label: 'Mundos' },
        ]}
      />
      {tab === 'items' ? <Items /> : <Worlds />}
    </Page>
  )
}

function Items() {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [selected, setSelected] = useState<ItemSummary | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const cats = useApi('catalog.items.categories', undefined)
  const items = useApi('catalog.items.search', { q, category, limit: 300 }, { placeholderData: (prev) => prev })
  const desktop = platform.kind === 'electron'
  const stats = useApi('catalog.icons.stats', undefined, { enabled: desktop, refetchInterval: progress && progress.done < progress.total ? 3_000 : false })
  const prefetch = useApiMutation('catalog.icons.prefetch')
  useEvent(
    'icons.progress',
    useCallback((p: { done: number; total: number }) => setProgress(p), []),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Buscar">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="nombre, iniciales (gmp)…" className="w-72" />
        </Field>
        <Field label="Categoría">
          <Select
            value={category ?? ''}
            onChange={(e) => setCategory(e.target.value || null)}
            options={[{ value: '', label: 'Todas' }, ...(cats.data ?? []).map((c) => ({ value: c.category, label: `${c.category} (${c.count})` }))]}
          />
        </Field>
        {desktop && stats.data && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted">
            Iconos en caché {stats.data.cached}/{stats.data.total} · sin icono {stats.data.failed}
            {progress && progress.done < progress.total && ` · descargando ${progress.done}/${progress.total}`}
            <Button onClick={() => prefetch.mutate({ category })} busy={prefetch.isPending} title="Descarga los iconos que faltan (TibiaWiki BR) a la caché local">
              <Download className="size-4" /> Precargar {category ? 'categoría' : 'todos'}
            </Button>
          </div>
        )}
      </div>
      {items.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          {(items.data ?? []).map((i) => (
            <button key={i.id} onClick={() => setSelected(i)} className="flex items-center gap-2 rounded-lg border border-line bg-panel p-2 text-left hover:border-accent">
              <ItemIcon item={i} />
              <div className="min-w-0">
                <div className="truncate text-sm">{i.name}</div>
                <div className="truncate text-[11px] text-muted">{i.category}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {items.data?.length === 300 && <p className="text-xs text-muted">Mostrando los primeros 300; afina la búsqueda.</p>}
      {selected && <ItemDetail id={selected.id} onClose={() => setSelected(null)} />}
    </div>
  )
}

function ItemDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: item } = useApi('catalog.items.get', { id })
  const update = useApiMutation('catalog.items.update', ['catalog.items.get'])
  const [weight, setWeight] = useState<string | null>(null)
  const [stack, setStack] = useState<string | null>(null)
  if (!item) return null
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center gap-3">
          <ItemIcon item={item} size={64} />
          <div>
            <div>
              ID de cliente <span className="num">{item.tibiaItemId ?? '—'}</span> · {item.category} {item.tier !== null && item.tier >= 0 && `· tier ${item.tier}`}
            </div>
            <div className="text-xs text-muted">Wiki: {item.wikiName ?? 'sin nombre de wiki'} · icono: {item.iconStatus}</div>
            <div className="text-xs text-muted">Fuente: {item.source}</div>
          </div>
        </div>
        {/* npcBuy = NPCs que compran el item (le vendes tú); npcSell = NPCs que lo venden (se lo compras). */}
        {(
          [
            ['NPCs que lo compran (le vendes)', item.npcBuy, 'buy'],
            ['NPCs que lo venden (le compras)', item.npcSell, 'sell'],
          ] as const
        ).map(([label, list, side]) =>
          list.length ? (
            <div key={label}>
              <div className="mb-1 text-xs font-medium text-muted">{label}</div>
              <ul className="flex flex-col gap-0.5">
                {groupNpcTrades(list, side).map((n) => (
                  <li key={`${n.name}-${n.price}-${n.currencyId}`} className="flex justify-between gap-2">
                    <span>
                      {n.name}{' '}
                      <span className="text-xs text-muted" title={n.locations.join(' · ')}>
                        {TRAVELLING_NPCS.has(n.name)
                          ? `hoy en ${rashidLocation(new Date()).city} (cambia de ciudad cada día)`
                          : n.locations.length > 2
                            ? `${n.locations.length} lugares`
                            : n.locations.join(' · ')}
                      </span>
                    </span>
                    <span>
                      <Gp value={n.price} /> {n.currencyId ? <Badge>moneda #{n.currencyId}</Badge> : 'gp'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        {platform.kind === 'electron' && (
          <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
            <Field label="Peso (oz)" hint="Requiere fuente: tibiawiki-sql o el cliente.">
              <Input value={weight ?? item.weightOz ?? ''} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Tamaño de stack">
              <Input value={stack ?? item.stackSize ?? ''} onChange={(e) => setStack(e.target.value)} inputMode="numeric" />
            </Field>
            <Button
              variant="primary"
              className="col-span-2"
              busy={update.isPending}
              onClick={() => {
                const w = weight ?? String(item.weightOz ?? '')
                const st = stack ?? String(item.stackSize ?? '')
                const wv = w.trim() === '' ? null : Number(w.replace(',', '.'))
                update.mutate({ id: item.id, weightOz: wv !== null && Number.isFinite(wv) && wv > 0 ? wv : null, stackSize: parseIntOrNull(st), iconOverrideUrl: null })
              }}
            >
              Guardar
            </Button>
            <ErrorBox error={update.error} />
          </div>
        )}
      </div>
    </Modal>
  )
}

function Worlds() {
  const desktop = platform.kind === 'electron'
  const worlds = useApi('catalog.worlds.list', { activeOnly: false })
  const sync = useApiMutation('catalog.worlds.sync', ['catalog.worlds.list'])
  const update = useApiMutation('catalog.worlds.update', ['catalog.worlds.list'])
  return (
    <Card
      title={`Mundos (${worlds.data?.filter((w) => w.isActive).length ?? 0} activos)`}
      actions={
        desktop && (
          <Button onClick={() => sync.mutate(undefined)} busy={sync.isPending}>
            <RefreshCw className="size-4" /> Sincronizar con TibiaData
          </Button>
        )
      }
    >
      <ErrorBox error={sync.error ?? worlds.error} />
      {sync.data && <p className="mb-2 text-xs text-good">Actualizados {sync.data.updated} mundos ({formatDateTime(sync.data.fetchedAt)}).</p>}
      <DataTable
        rows={worlds.data ?? []}
        rowKey={(w) => w.id}
        pageSize={100}
        initialSort={{ key: 'name', dir: 'asc' }}
        columns={[
          { key: 'name', header: 'Mundo', cell: (w) => (w.isActive ? w.name : <span className="text-muted">{w.name} (inactivo)</span>), sort: (w) => w.name },
          { key: 'region', header: 'Región', cell: (w) => w.region ?? '—', sort: (w) => w.region },
          { key: 'pvp', header: 'PvP', cell: (w) => w.pvpType ?? '—', sort: (w) => w.pvpType },
          { key: 'be', header: 'BattlEye', cell: (w) => (w.battleyeDate === 'release' ? 'desde el lanzamiento' : w.battleyeDate ?? '—'), sort: (w) => w.battleyeDate },
          { key: 'tt', header: 'Transferencia', cell: (w) => (w.transferType === 'blocked' ? <RouteBadge status="blocked" /> : w.transferType ?? '—'), sort: (w) => w.transferType },
          { key: 'type', header: 'Tipo', cell: (w) => w.gameWorldType ?? '—' },
          {
            key: 'looser',
            header: '"Looser conditions"',
            cell: (w) =>
              desktop ? <TriState label="" value={w.looserTransferConditions} onChange={(v) => update.mutate({ name: w.name, looserTransferConditions: v })} /> : String(w.looserTransferConditions ?? '?'),
          },
          { key: 'src', header: 'Fuente', cell: (w) => <span className="text-xs text-muted">{w.source} · {formatDateTime(w.verifiedAt)}</span> },
        ]}
      />
    </Card>
  )
}
