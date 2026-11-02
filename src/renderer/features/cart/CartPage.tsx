import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { FileDown, Save, Trash2 } from 'lucide-react'
import type { Cart, CartConstraints } from '@core/domain/cart/greedy'
import { useApi, useApiMutation } from '../../lib/api'
import { formatDateTime, formatPct, parseIntOrNull } from '../../lib/format'
import { Gp, ItemIcon } from '../../components/data'
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Page, Select, Stat, Warnings } from '../../components/ui'

const ORDER_LABEL = { roi: 'Mayor ROI primero', profit: 'Mayor ganancia primero', profit_per_oz: 'Mayor ganancia por oz' }

export function CartPage() {
  const [params] = useSearchParams()
  const runs = useApi('analysis.runs.list', { limit: 30 })
  const [runId, setRunId] = useState<string | null>(params.get('run'))
  const run = useApi('analysis.runs.get', { id: runId ?? '' }, { enabled: !!runId })
  const [c, setC] = useState<CartConstraints>({ budgetGp: 10_000_000, transferCostGp: null, minRoi: 0, minConfidenceScore: 0, maxQuantityPerItem: null, capacityOz: null, slots: null })
  useEffect(() => {
    if (run.data?.transferCost.gp != null) setC((x) => ({ ...x, transferCostGp: run.data!.transferCost.gp }))
  }, [run.data])
  const build = useApiMutation('cart.build')
  const save = useApiMutation('cart.save', ['cart.list'])
  const saved = useApi('cart.list', undefined)
  const del = useApiMutation('cart.delete', ['cart.list'])
  const exporter = useApiMutation('cart.export')
  const [name, setName] = useState('')

  const num = (v: string) => parseIntOrNull(v)
  return (
    <Page title="Carrito" subtitle="Heurística greedy documentada: propone carritos razonables, no garantiza el óptimo global.">
      <Card title="Restricciones">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Análisis base">
            <Select value={runId ?? ''} onChange={(e) => setRunId(e.target.value || null)} options={[{ value: '', label: 'Elegir…' }, ...(runs.data ?? []).map((r) => ({ value: r.id, label: `${r.origin} → ${r.destination} · ${r.strategy} · ${formatDateTime(r.startedAt)}` }))]} />
          </Field>
          <Field label="Presupuesto GP">
            <Input inputMode="numeric" className="w-36" value={c.budgetGp} onChange={(e) => setC({ ...c, budgetGp: num(e.target.value) ?? 0 })} />
          </Field>
          <Field label="Transferencia GP" hint="Del análisis o manual">
            <Input inputMode="numeric" className="w-36" value={c.transferCostGp ?? ''} onChange={(e) => setC({ ...c, transferCostGp: num(e.target.value) })} placeholder="desconocido" />
          </Field>
          <Field label="ROI mínimo %">
            <Input inputMode="numeric" className="w-20" value={c.minRoi} onChange={(e) => setC({ ...c, minRoi: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Confianza mínima (0–100)">
            <Input inputMode="numeric" className="w-20" value={c.minConfidenceScore} onChange={(e) => setC({ ...c, minConfidenceScore: Math.min(100, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="Máx. por item">
            <Input inputMode="numeric" className="w-24" value={c.maxQuantityPerItem ?? ''} onChange={(e) => setC({ ...c, maxQuantityPerItem: num(e.target.value) })} placeholder="—" />
          </Field>
          <Field label="Capacidad oz (opcional)">
            <Input inputMode="numeric" className="w-24" value={c.capacityOz ?? ''} onChange={(e) => setC({ ...c, capacityOz: num(e.target.value) })} placeholder="—" />
          </Field>
          <Field label="Slots (opcional)">
            <Input inputMode="numeric" className="w-20" value={c.slots ?? ''} onChange={(e) => setC({ ...c, slots: num(e.target.value) })} placeholder="—" />
          </Field>
          <Button variant="primary" disabled={!runId} busy={build.isPending} onClick={() => runId && build.mutate({ runId, constraints: c })}>
            Armar carritos
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Según el manual oficial, banco, depot, stash e inbox viajan con el personaje: la capacidad y los slots solo importan si quieres cargar los items encima.
        </p>
      </Card>
      <ErrorBox error={build.error ?? run.error} />
      {build.data && (
        <div className="grid gap-4 2xl:grid-cols-3">
          {build.data.map((cart) => (
            <CartView key={cart.ordering} cart={cart} onSave={() => runId && save.mutate({ name: name || `${run.data?.origin} → ${run.data?.destination} (${ORDER_LABEL[cart.ordering]})`, runId, cart, constraints: c })} saving={save.isPending} />
          ))}
        </div>
      )}
      {build.data && (
        <div className="flex items-center gap-2">
          <Input placeholder="Nombre para guardar" value={name} onChange={(e) => setName(e.target.value)} />
          {save.data && <span className="text-xs text-good">Guardado.</span>}
        </div>
      )}
      <Card title="Carritos guardados">
        {exporter.data && <p className="mb-2 text-xs text-good">Exportado: {exporter.data.path}</p>}
        <DataTable
          rows={saved.data ?? []}
          rowKey={(x) => x.id}
          empty="Sin carritos guardados."
          columns={[
            { key: 'n', header: 'Nombre', cell: (x) => x.name },
            { key: 'at', header: 'Fecha', cell: (x) => formatDateTime(x.createdAt), sort: (x) => x.createdAt },
            { key: 'l', header: 'Líneas', cell: (x) => x.lines, align: 'right' },
            { key: 'p', header: 'Neto', cell: (x) => <Gp value={x.netProfit} signed />, align: 'right' },
            {
              key: 'x',
              header: '',
              cell: (x) => (
                <span className="flex gap-1">
                  <Button variant="ghost" onClick={() => exporter.mutate({ id: x.id, format: 'csv' })}>
                    <FileDown className="size-4" /> CSV
                  </Button>
                  <Button variant="ghost" onClick={() => exporter.mutate({ id: x.id, format: 'json' })}>
                    JSON
                  </Button>
                  <Button variant="ghost" onClick={() => del.mutate({ id: x.id })} aria-label="Borrar carrito">
                    <Trash2 className="size-4" />
                  </Button>
                </span>
              ),
            },
          ]}
        />
      </Card>
    </Page>
  )
}

function CartView({ cart, onSave, saving }: { cart: Cart; onSave: () => void; saving: boolean }) {
  return (
    <Card
      title={ORDER_LABEL[cart.ordering]}
      actions={
        <Button onClick={onSave} busy={saving} disabled={cart.lines.length === 0}>
          <Save className="size-4" /> Guardar
        </Button>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2">
        <Stat label="Compra" value={<Gp value={cart.buyCost} short />} />
        <Stat label="Ingreso esperado (neto de comisiones)" value={<Gp value={cart.expectedRevenue} short />} />
        <Stat label="Transferencia" value={<Gp value={cart.transferCost} short />} />
        <Stat label="Ganancia neta" value={<Gp value={cart.netProfit} short signed />} hint={`ROI ${formatPct(cart.roi)}`} tone={cart.netProfit === null ? undefined : cart.netProfit > 0 ? 'good' : 'bad'} />
        <Stat label="Peso" value={cart.totalWeightOz === null ? 'sin datos' : `${cart.totalWeightOz.toFixed(1)} oz`} hint={cart.capacityApproximate ? 'aproximado' : undefined} />
        <Stat label="Slots" value={cart.totalSlots ?? 'sin datos'} />
      </div>
      <Warnings items={cart.warnings} />
      {cart.lines.length === 0 ? (
        <Empty>Ninguna oportunidad cumple las restricciones.</Empty>
      ) : (
        <DataTable
          rows={cart.lines}
          rowKey={(l) => l.itemId}
          columns={[
            { key: 'i', header: 'Item', cell: (l) => <span className="flex items-center gap-2"><ItemIcon item={{ name: l.itemName, iconUrl: `tt-img://item/${l.itemId}` }} size={22} />{l.itemName}</span> },
            { key: 's', header: '', cell: (l) => <Badge tone={l.strategy === 'instant' ? 'good' : 'accent'}>{l.strategy}</Badge> },
            { key: 'q', header: 'Cant.', cell: (l) => l.quantity.toLocaleString('en-US'), align: 'right' },
            { key: 'c', header: 'Compra', cell: (l) => <Gp value={l.buyCost} short />, align: 'right' },
            { key: 'p', header: 'Neto', cell: (l) => <Gp value={l.netProfit} short signed />, align: 'right' },
          ]}
        />
      )}
    </Card>
  )
}
