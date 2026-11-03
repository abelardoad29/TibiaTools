import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ItemSummary } from '@shared/api'
import type { AlertRule } from '@core/domain/alerts/rules'
import { useApi, useApiMutation } from '../../lib/api'
import { formatDateTime, parseIntOrNull } from '../../lib/format'
import { ItemPicker, WorldPicker } from '../../components/data'
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Page, Select, Toggle } from '../../components/ui'

const KIND_LABEL: Record<AlertRule['kind'], string> = {
  roi_above: 'ROI sobre umbral',
  item_below_price: 'Item bajo precio',
  tc_spread_above: 'Spread de TC',
  stale_data: 'Datos vencidos',
  route_invalid: 'Ruta deja de ser válida',
}

function describe(r: AlertRule): string {
  switch (r.kind) {
    case 'roi_above':
      return `ROI ≥ ${r.params.minRoi} %${r.params.originWorld ? ` desde ${r.params.originWorld}` : ''}${r.params.destinationWorld ? ` hacia ${r.params.destinationWorld}` : ''}`
    case 'item_below_price':
      return `${r.params.itemName} ≤ ${r.params.maxPrice.toLocaleString('en-US')} gp en ${r.params.world}`
    case 'tc_spread_above':
      return `Spread ≥ ${r.params.minSpreadPct} %${r.params.world ? ` en ${r.params.world}` : ''}`
    case 'stale_data':
      return `${r.params.world} sin capturas propias en ${r.params.maxAgeHours} h`
    case 'route_invalid':
      return `${r.params.originWorld} → ${r.params.destinationWorld}`
  }
}

export function AlertsPage() {
  const rules = useApi('alerts.rules.list', undefined)
  const events = useApi('alerts.events.list', { unreadOnly: false, limit: 200 })
  const save = useApiMutation('alerts.rules.save', ['alerts.rules.list'])
  const del = useApiMutation('alerts.rules.delete', ['alerts.rules.list'])
  const evaluate = useApiMutation('alerts.evaluate', ['alerts.events.list'])
  const markRead = useApiMutation('alerts.events.markRead', ['alerts.events.list'])
  const [kind, setKind] = useState<AlertRule['kind']>('roi_above')
  const [num, setNum] = useState('20')
  const [w1, setW1] = useState<string | null>(null)
  const [w2, setW2] = useState<string | null>(null)
  const [item, setItem] = useState<ItemSummary | null>(null)

  const build = (): AlertRule | null => {
    const n = Number(num)
    switch (kind) {
      case 'roi_above':
        return { id: 0, kind, params: { minRoi: n, originWorld: w1 ?? undefined, destinationWorld: w2 ?? undefined } }
      case 'item_below_price':
        return w1 && item && parseIntOrNull(num) ? { id: 0, kind, params: { world: w1, itemId: item.id, itemName: item.name, maxPrice: parseIntOrNull(num)! } } : null
      case 'tc_spread_above':
        return { id: 0, kind, params: { minSpreadPct: n, world: w1 ?? undefined } }
      case 'stale_data':
        return w1 ? { id: 0, kind, params: { world: w1, maxAgeHours: n } } : null
      case 'route_invalid':
        return w1 && w2 ? { id: 0, kind, params: { originWorld: w1, destinationWorld: w2 } } : null
    }
  }
  const draft = build()
  const unread = (events.data ?? []).filter((e) => !e.readAt)

  return (
    <Page title="Alertas" subtitle="Avisos locales (y notificaciones de Windows opcionales). Nunca ejecutan acciones en el juego.">
      <Card title="Nueva regla">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as AlertRule['kind'])} options={(Object.keys(KIND_LABEL) as AlertRule['kind'][]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          </Field>
          {kind !== 'route_invalid' && (
            <Field label={kind === 'item_below_price' ? 'Precio máximo (gp)' : kind === 'stale_data' ? 'Horas máximas' : 'Umbral (%)'}>
              <Input inputMode="numeric" className="w-32" value={num} onChange={(e) => setNum(e.target.value)} />
            </Field>
          )}
          <Field label={kind === 'route_invalid' || kind === 'roi_above' ? 'Origen' : 'Mundo'}>
            <WorldPicker value={w1} onChange={setW1} allowEmpty label={kind === 'roi_above' || kind === 'tc_spread_above' ? 'Cualquiera' : 'Mundo…'} />
          </Field>
          {(kind === 'route_invalid' || kind === 'roi_above') && (
            <Field label="Destino">
              <WorldPicker value={w2} onChange={setW2} allowEmpty label={kind === 'roi_above' ? 'Cualquiera' : 'Mundo…'} />
            </Field>
          )}
          {kind === 'item_below_price' && (
            <Field label="Item">
              <ItemPicker value={item} onChange={setItem} />
            </Field>
          )}
          <Button variant="primary" disabled={!draft} busy={save.isPending} onClick={() => draft && save.mutate({ rule: draft, enabled: true })}>
            Agregar
          </Button>
        </div>
        <ErrorBox error={save.error} />
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Reglas">
          <DataTable
            rows={rules.data ?? []}
            rowKey={(r) => r.rule.id}
            empty="Sin reglas."
            columns={[
              { key: 'k', header: 'Tipo', cell: (r) => KIND_LABEL[r.rule.kind] },
              { key: 'd', header: 'Condición', cell: (r) => describe(r.rule) },
              { key: 'e', header: 'Activa', cell: (r) => <Toggle checked={r.enabled} onChange={(v) => save.mutate({ rule: r.rule, enabled: v })} label="" /> },
              { key: 'x', header: '', cell: (r) => <Button variant="ghost" onClick={() => del.mutate({ id: r.rule.id })} aria-label="Borrar regla"><Trash2 className="size-4" /></Button> },
            ]}
          />
        </Card>
        <Card
          title={`Historial (${unread.length} sin leer)`}
          actions={
            <>
              <Button onClick={() => evaluate.mutate(undefined)} busy={evaluate.isPending}>
                Evaluar ahora
              </Button>
              <Button variant="ghost" disabled={unread.length === 0} onClick={() => markRead.mutate({ ids: unread.map((e) => e.id) })}>
                Marcar leídas
              </Button>
            </>
          }
        >
          {evaluate.data && <p className="mb-2 text-xs text-muted">{evaluate.data.fired} alertas nuevas.</p>}
          <DataTable
            rows={events.data ?? []}
            rowKey={(e) => e.id}
            empty="Sin alertas disparadas."
            columns={[
              { key: 't', header: 'Fecha', cell: (e) => formatDateTime(e.firedAt), sort: (e) => e.firedAt },
              { key: 'm', header: 'Mensaje', cell: (e) => e.message },
              { key: 'r', header: '', cell: (e) => (e.readAt ? null : <Badge tone="accent">nueva</Badge>) },
            ]}
          />
        </Card>
      </div>
    </Page>
  )
}
