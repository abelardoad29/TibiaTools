import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ItemSummary } from '@shared/api'
import type { PriceStats } from '@core/domain/pricing/stats'
import { call, useApi } from '../../lib/api'
import { formatDateTime, formatGp, formatGpShort } from '../../lib/format'
import { Freshness, Gp, ItemPicker, ProvenanceBadge, WorldPicker } from '../../components/data'
import { Card, DataTable, Empty, Field, Page, Select, Stat, Toggle } from '../../components/ui'
import { StatsTable } from '../market-explorer/MarketExplorerPage'

function StatsGrid({ title, s }: { title: string; s: PriceStats }) {
  return (
    <Card title={title}>
      {s.count === 0 ? (
        <Empty>Sin observaciones.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Mínimo" value={<Gp value={s.min} />} />
          <Stat label="P25" value={<Gp value={s.p25} />} />
          <Stat label="Mediana" value={<Gp value={s.median} />} />
          <Stat label="P75" value={<Gp value={s.p75} />} />
          <Stat label="Máximo" value={<Gp value={s.max} />} />
          <Stat label="IQR" value={<Gp value={s.iqr} />} />
          <Stat label="Media ponderada por cantidad ofertada" value={<Gp value={s.amountWeightedMean} />} hint="ponderada por oferta, no por ventas" />
          <Stat label="Volatilidad (CV)" value={s.cv === null ? '—' : `${(s.cv * 100).toFixed(1)} %`} />
          <Stat label="Observaciones" value={s.count} hint={`${s.totalAmount.toLocaleString('en-US')} unidades ofertadas`} />
          <Stat label="Último dato" value={<Freshness at={s.lastAt} />} hint={formatDateTime(s.lastAt)} />
        </div>
      )}
    </Card>
  )
}

const EVENT_LABEL: Record<string, string> = {
  first_seen: 'Nivel nuevo',
  amount_reduced: 'Cantidad reducida',
  amount_increased: 'Cantidad aumentada',
  price_changed: 'Posible cambio de precio',
  possibly_filled: 'Posible ejecución',
  possibly_removed: 'Posible retiro',
  expired_unknown: 'Vencida',
}

export function PriceHistoryPage() {
  const [params] = useSearchParams()
  const settings = useApi('app.settings.get', undefined)
  const [world, setWorld] = useState<string | null>(params.get('world'))
  const [item, setItem] = useState<ItemSummary | null>(null)
  const [days, setDays] = useState(30)
  const [thirdParty, setThirdParty] = useState(true)
  useEffect(() => {
    const id = Number(params.get('item'))
    if (id) void call('catalog.items.get', { id }).then((i) => i && setItem(i))
  }, [params])
  const w = world ?? settings.data?.homeWorld ?? null
  const hist = useApi('market.history', { world: w ?? '', itemId: item?.id ?? 0, days, includeThirdParty: thirdParty }, { enabled: !!w && !!item })
  const points = (hist.data?.points ?? []).map((p) => ({ t: new Date(p.observedAt).getTime(), bestSell: p.bestSell, bestBuy: p.bestBuy, source: p.source }))

  return (
    <Page title="Histórico" subtitle="Cómo se movió el precio de un item en un mundo: tus capturas y, si quieres, los datos de terceros." actions={<Toggle checked={thirdParty} onChange={setThirdParty} label="Incluir terceros" />}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mundo">
          <WorldPicker value={w} onChange={setWorld} allowEmpty />
        </Field>
        <Field label="Item">
          <ItemPicker value={item} onChange={setItem} />
        </Field>
        <Field label="Ventana">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[7, 14, 30, 90, 365].map((d) => ({ value: String(d), label: `${d} días` }))} />
        </Field>
      </div>
      {!w || !item ? (
        <Empty>Elige mundo e item.</Empty>
      ) : (
        <>
          <Card title="Mejor sell / mejor buy por snapshot">
            {points.length === 0 ? (
              <Empty>Sin snapshots en la ventana.</Empty>
            ) : (
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={points}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="t" type="number" scale="time" domain={['auto', 'auto']} tickFormatter={(t: number) => new Date(t).toLocaleDateString('es')} stroke="var(--muted)" fontSize={11} />
                    <YAxis tickFormatter={(v: number) => formatGpShort(v)} stroke="var(--muted)" fontSize={11} width={60} />
                    <Tooltip
                      contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }}
                      labelFormatter={(t) => formatDateTime(new Date(Number(t)).toISOString())}
                      formatter={(v) => (typeof v === 'number' ? `${formatGp(v)} gp` : String(v))}
                    />
                    <Legend />
                    <Line name="Mejor sell offer" dataKey="bestSell" stroke="var(--bad)" dot connectNulls />
                    <Line name="Mejor buy offer" dataKey="bestBuy" stroke="var(--good)" dot connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
              Fuentes en el gráfico: {[...new Set(points.map((p) => p.source))].map((s) => <ProvenanceBadge key={s} kind={s} />)}
            </div>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <StatsGrid title="Sell offers observadas" s={hist.data?.sellStats ?? ({ count: 0 } as PriceStats)} />
            <StatsGrid title="Buy offers observadas" s={hist.data?.buyStats ?? ({ count: 0 } as PriceStats)} />
          </div>
          <Card title="Estadísticas oficiales / de terceros">
            <StatsTable rows={hist.data?.official ?? []} />
          </Card>
          <Card title="Eventos inferidos entre snapshots">
            <p className="mb-2 text-xs text-muted">
              <ProvenanceBadge kind="inferred" /> Una oferta que desaparece puede haberse vendido, retirado o vencido: nunca se registra como venta confirmada.
            </p>
            <DataTable
              rows={hist.data?.events ?? []}
              rowKey={(e) => e.id}
              empty="Sin eventos (hacen falta al menos dos capturas propias del mismo item y mundo)."
              columns={[
                { key: 't', header: 'Detectado', cell: (e) => formatDateTime(e.detectedAt), sort: (e) => e.detectedAt },
                { key: 'type', header: 'Evento', cell: (e) => EVENT_LABEL[e.type] ?? e.type },
                { key: 's', header: 'Lado', cell: (e) => e.side },
                { key: 'p', header: 'Precio', cell: (e) => <Gp value={e.price} />, align: 'right' },
                { key: 'q', header: 'Cantidad', cell: (e) => e.quantity ?? '—', align: 'right' },
                { key: 'c', header: 'Confianza', cell: (e) => `${Math.round(e.confidence * 100)} %`, align: 'right' },
                { key: 'n', header: 'Nota', cell: (e) => <span className="text-xs text-muted">{e.note}</span> },
              ]}
            />
          </Card>
        </>
      )}
    </Page>
  )
}
