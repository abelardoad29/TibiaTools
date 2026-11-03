import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { FileDown, FolderOpen, Play } from 'lucide-react'
import type { AnalysisRequest, AnalysisResult } from '@shared/api'
import { rankOpportunities, type Opportunity, type Ranking, type Strategy } from '@core/domain/arbitrage/opportunity'
import { call, useApi, useApiMutation } from '../../lib/api'
import { formatDateTime, formatPct, parseIntOrNull } from '../../lib/format'
import { CheckBadge, Freshness, Gp, ItemIcon, ProvenanceBadge, RouteBadge, useMyWorlds, WorldPicker } from '../../components/data'
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Modal, Page, Select, Stat, Tabs, Toggle, Warnings } from '../../components/ui'

const STRATEGY_LABEL: Record<Strategy, string> = { instant: 'Instant', historical: 'Historical', hybrid: 'Hybrid' }
const RANKINGS: { id: Ranking; label: string }[] = [
  { id: 'profit', label: 'Best Profit' },
  { id: 'roi', label: 'Best ROI' },
  { id: 'liquidity', label: 'Best Liquidity' },
  { id: 'risk_adjusted', label: 'Risk Adjusted' },
]

const oldest = (o: Opportunity) => o.evidence.map((e) => e.observedAt).sort()[0] ?? null

export function ArbitragePage() {
  const [tab, setTab] = useState<'run' | 'matrix'>('run')
  const [form, setReq] = useState<AnalysisRequest>({ origin: '', destination: '', strategy: 'hybrid', budgetGp: null, maxQuantityPerItem: null, includeThirdParty: true, maxAgeHours: null })
  // Mientras no elijas otro, el origen es tu mundo principal (o el primero de tus mundos).
  const mine = useMyWorlds()
  const req = form.origin ? form : { ...form, origin: mine[0] ?? '' }
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const run = useApiMutation('analysis.run', ['analysis.runs.list'])
  const runs = useApi('analysis.runs.list', { limit: 15 })

  return (
    <Page title="Arbitraje" subtitle="Compara comprar en un mundo y vender en otro. Las estimaciones nunca son transacciones confirmadas.">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'run', label: 'Análisis por ruta' },
          { id: 'matrix', label: 'Matriz de rutas' },
        ]}
      />
      {tab === 'matrix' ? (
        <Matrix
          onPick={(origin, destination) => {
            setReq({ ...req, origin, destination })
            setTab('run')
          }}
        />
      ) : (
        <>
          <Card title="Parámetros">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Origen (comprar)">
                <WorldPicker value={req.origin || null} onChange={(w) => setReq({ ...req, origin: w ?? '' })} allowEmpty activeOnly={false} />
              </Field>
              <Field label="Destino (vender)">
                <WorldPicker value={req.destination || null} onChange={(w) => setReq({ ...req, destination: w ?? '' })} allowEmpty activeOnly={false} />
              </Field>
              <Field label="Estrategia">
                <Select value={req.strategy} onChange={(e) => setReq({ ...req, strategy: e.target.value as Strategy })} options={(Object.keys(STRATEGY_LABEL) as Strategy[]).map((s) => ({ value: s, label: STRATEGY_LABEL[s] }))} />
              </Field>
              <Field label="Presupuesto GP por item">
                <Input inputMode="numeric" className="w-36" value={req.budgetGp ?? ''} onChange={(e) => setReq({ ...req, budgetGp: parseIntOrNull(e.target.value) })} placeholder="sin límite" />
              </Field>
              <Field label="Máx. unidades por item">
                <Input inputMode="numeric" className="w-28" value={req.maxQuantityPerItem ?? ''} onChange={(e) => setReq({ ...req, maxQuantityPerItem: parseIntOrNull(e.target.value) })} placeholder="sin límite" />
              </Field>
              <Field label="Ignorar datos de más de (h)">
                <Input inputMode="numeric" className="w-24" value={req.maxAgeHours ?? ''} onChange={(e) => setReq({ ...req, maxAgeHours: parseIntOrNull(e.target.value) })} placeholder="—" />
              </Field>
              <Toggle checked={req.includeThirdParty} onChange={(v) => setReq({ ...req, includeThirdParty: v })} label="Incluir terceros" />
              <Button variant="primary" disabled={!req.origin || !req.destination || req.origin === req.destination} busy={run.isPending} onClick={() => run.mutate(req, { onSuccess: setResult })}>
                <Play className="size-4" /> Actualizar análisis
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Instant acepta ofertas existentes (sin comisión). Historical publica una sell offer en destino (paga comisión) con precio P25/P50/P75 de lo observado. Hybrid muestra ambos y recomienda según el
              descuento por riesgo configurado.
            </p>
          </Card>
          <ErrorBox error={run.error} />
          {result ? <Results result={result} /> : <Empty>Elige origen y destino y pulsa «Actualizar análisis». Nada se recalcula automáticamente.</Empty>}
          <Card title="Análisis anteriores">
            <DataTable
              rows={runs.data ?? []}
              rowKey={(r) => r.id}
              pageSize={10}
              onRowClick={(r) => void call('analysis.runs.get', { id: r.id }).then((x) => x && setResult(x))}
              columns={[
                { key: 'at', header: 'Fecha', cell: (r) => formatDateTime(r.startedAt), sort: (r) => r.startedAt },
                { key: 'route', header: 'Ruta', cell: (r) => `${r.origin} → ${r.destination}` },
                { key: 's', header: 'Estrategia', cell: (r) => r.strategy },
                { key: 'n', header: 'Items', cell: (r) => r.opportunities, align: 'right' },
              ]}
            />
          </Card>
        </>
      )}
    </Page>
  )
}

function Results({ result }: { result: AnalysisResult }) {
  const [ranking, setRanking] = useState<Ranking>('profit')
  const [detail, setDetail] = useState<Opportunity | null>(null)
  const exporter = useApiMutation('analysis.export')
  const openFolder = useApiMutation('app.openFolder')
  const ranked = useMemo(() => rankOpportunities(result.opportunities, ranking), [result, ranking])
  const positive = result.opportunities.filter((o) => o.netProfit > 0)
  const totalProfit = positive.reduce((s, o) => s + o.netProfit, 0)
  const routeNet = result.transferCost.gp === null ? null : totalProfit - result.transferCost.gp

  return (
    <>
      <div className="grid gap-3 md:grid-cols-5">
        <Stat label="Ruta" value={`${result.origin} → ${result.destination}`} hint={<RouteBadge status={result.route.status} />} />
        <Stat label="Items comparados" value={result.itemsConsidered} hint={`${positive.length} con ganancia`} />
        <Stat label="Ganancia sumada (antes de transferir)" value={<Gp value={totalProfit} />} hint="suma de items independientes" />
        <Stat label="Transferencia" value={<Gp value={result.transferCost.gp} />} hint={result.transferCost.tc ? `${result.transferCost.tc} TC · ${result.transferCost.method}` : 'sin configurar'} />
        <Stat label="Neto de la ruta (estimado)" value={<Gp value={routeNet} signed />} tone={routeNet === null ? undefined : routeNet > 0 ? 'good' : 'bad'} hint={result.route.status !== 'allowed' ? 'ruta no ejecutable' : undefined} />
      </div>
      <Warnings items={[...result.warnings, ...result.transferCost.warnings]} />
      <Card
        title="Oportunidades"
        actions={
          <>
            <Link to={`/cart?run=${result.runId}`} className="text-sm text-accent">
              Armar carrito →
            </Link>
            <Button onClick={() => exporter.mutate({ runId: result.runId, format: 'csv' })}>
              <FileDown className="size-4" /> CSV
            </Button>
            <Button onClick={() => exporter.mutate({ runId: result.runId, format: 'json' })}>
              <FileDown className="size-4" /> JSON
            </Button>
          </>
        }
      >
        {exporter.data && (
          <p className="mb-2 flex items-center gap-2 text-xs text-good">
            Exportado: {exporter.data.path}
            <Button variant="ghost" onClick={() => openFolder.mutate({ target: 'exports' })}>
              <FolderOpen className="size-4" />
            </Button>
          </p>
        )}
        <Tabs value={ranking} onChange={setRanking} tabs={RANKINGS} />
        <div className="mt-3">
          <DataTable
            rows={ranked}
            rowKey={(o) => o.itemId}
            onRowClick={setDetail}
            empty="Ningún item con ganancia positiva en esta ruta con los datos disponibles."
            columns={[
              { key: 'item', header: 'Item', cell: (o) => <span className="flex items-center gap-2"><ItemIcon item={{ name: o.itemName, iconUrl: `tt-img://item/${o.itemId}` }} size={24} />{o.itemName}</span>, sort: (o) => o.itemName },
              { key: 'rec', header: 'Estrategia', cell: (o) => <Badge tone={o.recommended === 'instant' ? 'good' : 'accent'}>{o.recommended === 'instant' ? 'Instant' : o.recommended === 'historical' ? 'Historical (estimado)' : '—'}</Badge> },
              { key: 'q', header: 'Cant.', cell: (o) => o.quantity.toLocaleString('en-US'), sort: (o) => o.quantity, align: 'right' },
              { key: 'cost', header: 'Compra', cell: (o) => <Gp value={o.buyCost} short />, sort: (o) => o.buyCost, align: 'right' },
              { key: 'rev', header: 'Ingreso', cell: (o) => <Gp value={o.grossRevenue} short />, sort: (o) => o.grossRevenue, align: 'right' },
              { key: 'fee', header: 'Comisión', cell: (o) => <Gp value={o.marketFees} short />, align: 'right' },
              { key: 'net', header: 'Neto', cell: (o) => <Gp value={o.netProfit} short signed />, sort: (o) => o.netProfit, align: 'right' },
              { key: 'roi', header: 'ROI', cell: (o) => formatPct(o.roiCommitted), sort: (o) => o.roiCommitted, align: 'right' },
              {
                key: 'liq',
                header: 'Liquidez',
                cell: (o) => (
                  <span title={o.liquidity.liquidityConfidence === 'official' ? `${o.liquidity.officialTransactionsPerDay?.toFixed(1)} transacciones/día (${o.liquidity.officialSource})` : o.liquidity.liquidityConfidence === 'inferred' ? 'inferida de snapshots' : 'sin datos'}>
                    {o.liquidity.score} {o.liquidity.liquidityConfidence === 'official' ? <ProvenanceBadge kind="official_stats" /> : o.liquidity.liquidityConfidence === 'inferred' ? <ProvenanceBadge kind="inferred" /> : null}
                  </span>
                ),
                sort: (o) => o.liquidity.score,
                align: 'right',
              },
              { key: 'conf', header: 'Confianza', cell: (o) => Math.round(o.scores.confidence), sort: (o) => o.scores.confidence, align: 'right' },
              { key: 'score', header: 'Score', cell: (o) => o.scores.total, sort: (o) => o.scores.total, align: 'right' },
              { key: 'src', header: 'Fuentes', cell: (o) => <span className="flex gap-1">{[...new Set(o.evidence.map((e) => e.source))].map((s) => <ProvenanceBadge key={s} kind={s} />)}</span> },
              { key: 'age', header: 'Dato más viejo', cell: (o) => <Freshness at={oldest(o)} />, sort: (o) => oldest(o) },
              { key: 'w', header: '', cell: (o) => (o.warnings.length ? <Badge tone="warn">{o.warnings.length} avisos</Badge> : null) },
            ]}
          />
        </div>
      </Card>
      <Card title="Verificación de la ruta">
        <ul className="flex flex-col gap-1 text-sm">
          {result.route.checks.map((c) => (
            <li key={c.rule + c.reason} className="flex items-center gap-2">
              <CheckBadge result={c.result} /> {c.reason}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Requisitos personales del personaje en <Link className="text-accent" to="/transfers">Transferencias</Link>.
        </p>
      </Card>
      {detail && <Detail o={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

function Detail({ o, onClose }: { o: Opportunity; onClose: () => void }) {
  return (
    <Modal title={o.itemName} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Neto" value={<Gp value={o.netProfit} signed />} />
          <Stat label="ROI s/ capital comprometido" value={formatPct(o.roiCommitted)} hint="compra + comisiones" />
          <Stat label="ROI s/ compra" value={formatPct(o.roiPurchase)} />
          <Stat label="Score" value={o.scores.total} hint={`ROI ${Math.round(o.scores.roi)} · liq ${o.scores.liquidity} · conf ${Math.round(o.scores.confidence)} · estab ${Math.round(o.scores.stability)}`} />
        </div>
        <Warnings items={o.warnings} />
        {o.instant && (
          <Card title={`Instant: ${o.instant.quantity} unidades, bruto ${o.instant.grossProfit.toLocaleString('en-US')} gp`}>
            <DataTable
              rows={o.instant.lots}
              rowKey={(l) => `${l.buyPrice}-${l.sellPrice}-${l.amount}`}
              empty="Sin lotes con margen."
              columns={[
                { key: 'b', header: 'Compro a', cell: (l) => <Gp value={l.buyPrice} />, align: 'right' },
                { key: 's', header: 'Vendo a', cell: (l) => <Gp value={l.sellPrice} />, align: 'right' },
                { key: 'a', header: 'Unidades', cell: (l) => l.amount, align: 'right' },
                { key: 'u', header: 'Ganancia/u', cell: (l) => <Gp value={l.unitProfit} signed />, align: 'right' },
              ]}
            />
            <p className="mt-2 text-xs text-muted">
              Profundidad: {o.instant.originDepth.toLocaleString('en-US')} en venta en origen · {o.instant.destinationDepth.toLocaleString('en-US')} pedidas en destino.
            </p>
          </Card>
        )}
        {o.historical && (
          <Card title={`Historical (${o.historical.status === 'ok' ? 'muestra suficiente' : o.historical.status === 'experimental' ? 'experimental' : 'bloqueado'})`}>
            {o.historical.scenarios.length === 0 ? (
              <Empty>Sin escenarios: {o.historical.warnings.join('; ')}</Empty>
            ) : (
              <DataTable
                rows={o.historical.scenarios}
                rowKey={(s) => s.name}
                columns={[
                  { key: 'n', header: 'Escenario', cell: (s) => ({ pessimistic: 'Pesimista (P25)', base: 'Base (P50)', optimistic: 'Optimista (P75)' })[s.name] },
                  { key: 't', header: 'Precio objetivo', cell: (s) => <Gp value={s.targetPrice} />, align: 'right' },
                  { key: 'r', header: 'Ingreso', cell: (s) => <Gp value={s.revenue} />, align: 'right' },
                  { key: 'f', header: 'Comisión', cell: (s) => <Gp value={s.postingFee} />, align: 'right' },
                  { key: 'p', header: 'Neto', cell: (s) => <Gp value={s.netProfit} signed />, align: 'right' },
                ]}
              />
            )}
            <p className="mt-2 text-xs text-muted">
              <ProvenanceBadge kind="estimated" /> Muestra: {o.historical.sample.observations} precios en {o.historical.sample.snapshots} snapshots / {o.historical.sample.days} días · riesgo de no venta: {o.historical.noSaleRisk}
              {o.historical.minDaysToSell !== null && ` · ≥ ${o.historical.minDaysToSell.toFixed(1)} días para vender`}
            </p>
          </Card>
        )}
        <Card title="Evidencia usada">
          <ul className="flex flex-col gap-1">
            {o.evidence.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <ProvenanceBadge kind={e.source} /> {formatDateTime(e.observedAt)} <Freshness at={e.observedAt} /> {e.scanId && <span className="font-mono text-muted">scan {e.scanId.slice(0, 8)}</span>}
                {e.confidence !== null && <span className="text-muted">OCR {Math.round(e.confidence * 100)} %</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Modal>
  )
}

function Matrix({ onPick }: { onPick: (origin: string, destination: string) => void }) {
  const [thirdParty, setThirdParty] = useState(true)
  const matrix = useApi('analysis.matrix', { includeThirdParty: thirdParty, maxAgeHours: null }, { enabled: false })
  return (
    <Card
      title="Rutas entre mundos con datos"
      actions={
        <>
          <Toggle checked={thirdParty} onChange={setThirdParty} label="Incluir terceros" />
          <Button variant="primary" onClick={() => void matrix.refetch()} busy={matrix.isFetching}>
            Calcular matriz
          </Button>
        </>
      }
    >
      <ErrorBox error={matrix.error} />
      <DataTable
        rows={matrix.data ?? []}
        rowKey={(c) => `${c.origin}>${c.destination}`}
        onRowClick={(c) => onPick(c.origin, c.destination)}
        initialSort={{ key: 'best', dir: 'desc' }}
        empty="Pulsa «Calcular matriz». Solo aparecen mundos con order books (propios o de terceros)."
        columns={[
          { key: 'o', header: 'Origen', cell: (c) => c.origin, sort: (c) => c.origin },
          { key: 'd', header: 'Destino', cell: (c) => c.destination, sort: (c) => c.destination },
          { key: 's', header: 'Transferencia', cell: (c) => <RouteBadge status={c.status} />, sort: (c) => c.status },
          { key: 'c', header: 'Items en común', cell: (c) => c.commonItems, sort: (c) => c.commonItems, align: 'right' },
          { key: 'n', header: 'Con ganancia Instant', cell: (c) => c.opportunities, sort: (c) => c.opportunities, align: 'right' },
          { key: 'best', header: 'Mejor Instant', cell: (c) => <Gp value={c.bestInstantProfit} short />, sort: (c) => c.bestInstantProfit, align: 'right' },
        ]}
      />
    </Card>
  )
}
