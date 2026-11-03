import { useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApi } from '../../lib/api'
import { formatDateTime, formatGp, formatGpShort, formatPct } from '../../lib/format'
import { Freshness, Gp, ProvenanceBadge, useMyWorlds } from '../../components/data'
import { Card, DataTable, Empty, Page, Toggle, Warnings } from '../../components/ui'

export function TcMarketPage() {
  const [thirdParty, setThirdParty] = useState(true)
  const [world, setWorld] = useState<string | null>(null)
  const mine = useMyWorlds()
  // Por defecto, solo mis mundos (si ya elegí alguno); null = seguir ese defecto.
  const [onlyMineState, setOnlyMine] = useState<boolean | null>(null)
  const onlyMine = onlyMineState ?? mine.length > 0
  const quotes = useApi('tc.quotes', { includeThirdParty: thirdParty })
  const rows = (quotes.data ?? []).filter((q) => !onlyMine || mine.includes(q.world))
  const hist = useApi('tc.history', { world: world ?? '', days: 90, includeThirdParty: thirdParty }, { enabled: !!world })
  const points = (hist.data ?? []).map((p) => ({ t: new Date(p.observedAt).getTime(), bestBuy: p.bestBuy, bestSell: p.bestSell }))

  return (
    <Page
      title="Tibia Coins"
      subtitle="Precio de las Tibia Coins en cada mundo: para comprar (sell offers) y para vender (buy offers)."
      actions={
        <div className="flex flex-wrap items-center gap-4">
          {mine.length > 0 && <Toggle checked={onlyMine} onChange={setOnlyMine} label="Solo mis mundos" />}
          <Toggle checked={thirdParty} onChange={setThirdParty} label="Incluir terceros" />
        </div>
      }
    >
      <Warnings items={['No todas las TC son iguales: confirma en la Store que las TC compradas en el Market sirven para pagar la transferencia antes de contar con ellas.']} />
      <Card title="Cotizaciones">
        <DataTable
          rows={rows}
          rowKey={(q) => q.world}
          onRowClick={(q) => setWorld(q.world)}
          initialSort={{ key: 'sell', dir: 'asc' }}
          empty="Sin datos de TC. Captura el Market de Tibia Coins (item «Tibia Coins») o importa el order book de terceros."
          columns={[
            { key: 'w', header: 'Mundo', cell: (q) => (mine.includes(q.world) ? <span title="Mi mundo">★ {q.world}</span> : q.world), sort: (q) => q.world },
            { key: 'sell', header: 'Comprar TC (mejor sell offer)', cell: (q) => <Gp value={q.bestSellOffer} />, sort: (q) => q.bestSellOffer, align: 'right' },
            { key: 'buy', header: 'Vender TC (mejor buy offer)', cell: (q) => <Gp value={q.bestBuyOffer} />, sort: (q) => q.bestBuyOffer, align: 'right' },
            { key: 'spread', header: 'Spread', cell: (q) => (q.spread === null ? '—' : `${formatGp(q.spread)} (${formatPct(q.spreadPct)})`), sort: (q) => q.spreadPct, align: 'right' },
            { key: 'depth', header: 'Profundidad sell / buy', cell: (q) => (q.sellDepth || q.buyDepth ? `${q.sellDepth.toLocaleString('en-US')} / ${q.buyDepth.toLocaleString('en-US')}` : 'sin profundidad'), align: 'right' },
            { key: 'src', header: 'Fuente', cell: (q) => (q.source ? <ProvenanceBadge kind={q.source} /> : '—') },
            { key: 'at', header: 'Dato', cell: (q) => <Freshness at={q.observedAt} />, sort: (q) => q.observedAt },
          ]}
        />
      </Card>
      <Card title={world ? `Histórico de TC en ${world} (90 días)` : 'Histórico'}>
        {!world ? (
          <Empty>Haz clic en un mundo de la tabla.</Empty>
        ) : points.length === 0 ? (
          <Empty>Sin histórico.</Empty>
        ) : (
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={points}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="t" type="number" scale="time" domain={['auto', 'auto']} tickFormatter={(t: number) => new Date(t).toLocaleDateString('es')} stroke="var(--muted)" fontSize={11} />
                <YAxis tickFormatter={(v: number) => formatGpShort(v)} stroke="var(--muted)" fontSize={11} width={60} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)' }} labelFormatter={(t) => formatDateTime(new Date(Number(t)).toISOString())} formatter={(v) => (typeof v === 'number' ? `${formatGp(v)} gp` : String(v))} />
                <Legend />
                <Line name="Comprar (sell offer)" dataKey="bestSell" stroke="var(--bad)" connectNulls />
                <Line name="Vender (buy offer)" dataKey="bestBuy" stroke="var(--good)" connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </Page>
  )
}
