import { useState } from 'react'
import { Link } from 'react-router'
import { Plus, Trash2 } from 'lucide-react'
import type { RouteStatus } from '@core/domain/transfers/rules'
import type { TransferProfile } from '@core/domain/transfers/checklist'
import { useApi, useApiMutation } from '../../lib/api'
import { formatDateTime, parseIntOrNull } from '../../lib/format'
import { CheckBadge, Gp, RouteBadge, WorldPicker } from '../../components/data'
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Page, Select, TriState, Warnings } from '../../components/ui'

const EMPTY_PROFILE: TransferProfile & { id: number | null } = {
  id: null,
  name: '',
  currentWorld: null,
  lastTransferAt: null,
  hasRedOrBlackSkull: null,
  isGuildLeader: null,
  ownsHouse: null,
  hasOpenTcMarketOffers: null,
  isOnMainContinent: null,
  visitedCalvaOrCalvera: null,
  transferType: 'regular',
  availableEligibleTc: null,
}

export function TransfersPage() {
  const [origin, setOrigin] = useState<string | null>(null)
  const [destination, setDestination] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<number | null>(null)
  const profiles = useApi('transfers.profiles.list', undefined)
  const evaluation = useApi('transfers.evaluate', { origin: origin ?? '', destination: destination ?? '', profileId }, { enabled: !!origin && !!destination })
  const setLooser = useApiMutation('catalog.worlds.update', ['transfers.evaluate', 'catalog.worlds.list'])
  const e = evaluation.data

  return (
    <Page title="Transferencias" subtitle="Compatibilidad de rutas y requisitos del personaje. Si algo es desconocido, la ruta no se marca como ejecutable.">
      <Card title="Simulador">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Origen">
            <WorldPicker value={origin} onChange={setOrigin} allowEmpty />
          </Field>
          <Field label="Destino">
            <WorldPicker value={destination} onChange={setDestination} allowEmpty />
          </Field>
          <Field label="Perfil del personaje">
            <Select value={String(profileId ?? '')} onChange={(ev) => setProfileId(Number(ev.target.value) || null)} options={[{ value: '', label: 'Sin perfil' }, ...(profiles.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))]} />
          </Field>
        </div>
        <ErrorBox error={evaluation.error} />
        {e && (
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                Estado final:{' '}
                {e.final === 'eligible' ? <Badge tone="good">Elegible</Badge> : e.final === 'blocked' ? <Badge tone="bad">Bloqueada</Badge> : <Badge tone="warn">No verificada</Badge>}
              </div>
              <div className="flex items-center gap-2 text-sm">
                Ruta general: <RouteBadge status={e.route.status} />
              </div>
              <div className="rounded-lg border border-line p-2 text-sm">
                <div className="text-xs text-muted">Costo estimado</div>
                <div>
                  {e.cost.tc ?? '—'} TC ({e.cost.type}) ≈ <Gp value={e.cost.gp} /> gp
                </div>
                <div className="text-xs text-muted">{e.cost.method}</div>
                <Link to="/settings" className="text-xs text-accent">
                  Configurar precio en TC →
                </Link>
              </div>
              <Warnings items={e.cost.warnings} />
            </div>
            <Card title="Reglas del mundo">
              <ul className="flex flex-col gap-1.5 text-sm">
                {e.route.checks.map((c) => (
                  <li key={c.rule + c.reason} className="flex items-start gap-2">
                    <CheckBadge result={c.result} />
                    <span>
                      {c.reason}
                      {c.rule === 'pvp' && c.result === 'unknown' && destination && (
                        <span className="mt-1 block text-xs text-muted">
                          Tibia a veces abre mundos (normalmente nuevos) con «condiciones de transferencia más flexibles»: aceptan personajes de cualquier tipo de PvP por un tiempo. TibiaData no
                          publica ese dato; revísalo en la página del mundo en tibia.com.
                          <span className="mt-1 flex gap-2">
                            <Button variant="secondary" onClick={() => setLooser.mutate({ name: destination, looserTransferConditions: false })}>
                              {destination} no las tiene
                            </Button>
                            <Button variant="ghost" onClick={() => setLooser.mutate({ name: destination, looserTransferConditions: true })}>
                              Sí las tiene
                            </Button>
                          </span>
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Checklist del personaje">
              <ul className="flex flex-col gap-1.5 text-sm">
                {e.checklist.map((c) => (
                  <li key={c.key} className="flex items-start gap-2" title={c.detail}>
                    <CheckBadge result={c.result} />
                    <span>
                      {c.label}
                      <span className="block text-xs text-muted">{c.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Profiles />
        <ManualRules />
      </div>
    </Page>
  )
}

function Profiles() {
  const list = useApi('transfers.profiles.list', undefined)
  const save = useApiMutation('transfers.profiles.save', ['transfers.profiles.list', 'transfers.evaluate'])
  const del = useApiMutation('transfers.profiles.delete', ['transfers.profiles.list'])
  const [p, setP] = useState(EMPTY_PROFILE)
  return (
    <Card title="Perfiles de personaje" actions={<Button onClick={() => setP(EMPTY_PROFILE)}><Plus className="size-4" /> Nuevo</Button>}>
      <div className="mb-3 flex flex-wrap gap-2">
        {(list.data ?? []).map((x) => (
          <span key={x.id} className="inline-flex items-center gap-1">
            <Button variant={p.id === x.id ? 'primary' : 'secondary'} onClick={() => setP(x)}>
              {x.name}
            </Button>
            <Button variant="ghost" onClick={() => del.mutate({ id: x.id })} aria-label={`Borrar ${x.name}`}>
              <Trash2 className="size-4" />
            </Button>
          </span>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nombre (identificación local)">
          <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </Field>
        <Field label="Mundo actual">
          <WorldPicker value={p.currentWorld} onChange={(w) => setP({ ...p, currentWorld: w })} allowEmpty />
        </Field>
        <Field label="Última transferencia" hint="Vacío = desconocida">
          <Input type="date" value={p.lastTransferAt?.slice(0, 10) ?? ''} onChange={(e) => setP({ ...p, lastTransferAt: e.target.value || null })} />
        </Field>
        <Field label="Tipo de transferencia">
          <Select value={p.transferType} onChange={(e) => setP({ ...p, transferType: e.target.value as 'regular' | 'express' })} options={[{ value: 'regular', label: 'Regular' }, { value: 'express', label: 'Express' }]} />
        </Field>
        <Field label="TC elegibles disponibles">
          <Input inputMode="numeric" value={p.availableEligibleTc ?? ''} onChange={(e) => setP({ ...p, availableEligibleTc: parseIntOrNull(e.target.value) })} />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <TriState label="¿Tiene red o black skull?" value={p.hasRedOrBlackSkull} onChange={(v) => setP({ ...p, hasRedOrBlackSkull: v })} />
        <TriState label="¿Es líder de guild?" value={p.isGuildLeader} onChange={(v) => setP({ ...p, isGuildLeader: v })} />
        <TriState label="¿Tiene casa alquilada?" value={p.ownsHouse} onChange={(v) => setP({ ...p, ownsHouse: v })} />
        <TriState label="¿Tiene ofertas de Market con Tibia Coins?" value={p.hasOpenTcMarketOffers} onChange={(v) => setP({ ...p, hasOpenTcMarketOffers: v })} />
        <TriState label="¿Está en el continente principal?" value={p.isOnMainContinent} onChange={(v) => setP({ ...p, isOnMainContinent: v })} />
        <TriState label="¿Visitó Calva o Calvera? (solo Hardcore)" value={p.visitedCalvaOrCalvera} onChange={(v) => setP({ ...p, visitedCalvaOrCalvera: v })} />
      </div>
      <ErrorBox error={save.error} />
      <Button className="mt-3" variant="primary" disabled={!p.name.trim()} busy={save.isPending} onClick={() => save.mutate(p, { onSuccess: setP })}>
        Guardar perfil
      </Button>
    </Card>
  )
}

function ManualRules() {
  const list = useApi('transfers.manual.list', undefined)
  const save = useApiMutation('transfers.manual.save', ['transfers.manual.list', 'transfers.evaluate'])
  const del = useApiMutation('transfers.manual.delete', ['transfers.manual.list', 'transfers.evaluate'])
  const [r, setR] = useState<{ origin: string | null; destination: string | null; status: RouteStatus; reason: string; sourceUrl: string; validUntil: string }>({ origin: null, destination: null, status: 'allowed', reason: '', sourceUrl: '', validUntil: '' })
  return (
    <Card title="Reglas manuales verificadas">
      <p className="mb-2 text-xs text-muted">Úsalas cuando hayas comprobado una ruta en la página oficial. Quedan con fecha y fuente, y pueden vencer.</p>
      <div className="grid gap-2 md:grid-cols-2">
        <WorldPicker value={r.origin} onChange={(w) => setR({ ...r, origin: w })} allowEmpty label="Origen…" />
        <WorldPicker value={r.destination} onChange={(w) => setR({ ...r, destination: w })} allowEmpty label="Destino…" />
        <Select value={r.status} onChange={(e) => setR({ ...r, status: e.target.value as RouteStatus })} options={[{ value: 'allowed', label: 'Permitida' }, { value: 'blocked', label: 'Bloqueada' }, { value: 'unknown', label: 'Desconocida' }]} />
        <Input type="date" value={r.validUntil} onChange={(e) => setR({ ...r, validUntil: e.target.value })} aria-label="Válida hasta" />
        <Input className="md:col-span-2" placeholder="Motivo" value={r.reason} onChange={(e) => setR({ ...r, reason: e.target.value })} />
        <Input className="md:col-span-2" placeholder="URL de la fuente oficial" value={r.sourceUrl} onChange={(e) => setR({ ...r, sourceUrl: e.target.value })} />
      </div>
      <ErrorBox error={save.error} />
      <Button
        className="mt-2"
        variant="primary"
        disabled={!r.origin || !r.destination || !r.reason.trim()}
        busy={save.isPending}
        onClick={() => save.mutate({ origin: r.origin!, destination: r.destination!, status: r.status, reason: r.reason, sourceUrl: r.sourceUrl || null, validUntil: r.validUntil || null })}
      >
        Agregar regla
      </Button>
      <div className="mt-3">
        <DataTable
          rows={list.data ?? []}
          rowKey={(x) => x.id}
          empty="Sin reglas manuales."
          columns={[
            { key: 'r', header: 'Ruta', cell: (x) => `${x.origin} → ${x.destination}` },
            { key: 's', header: 'Estado', cell: (x) => <RouteBadge status={x.status} /> },
            { key: 'why', header: 'Motivo', cell: (x) => x.reason },
            { key: 'v', header: 'Verificada', cell: (x) => formatDateTime(x.verifiedAt) },
            { key: 'u', header: 'Vence', cell: (x) => x.validUntil ?? '—' },
            { key: 'x', header: '', cell: (x) => <Button variant="ghost" onClick={() => del.mutate({ id: x.id })} aria-label="Borrar regla"><Trash2 className="size-4" /></Button> },
          ]}
        />
      </div>
    </Card>
  )
}
