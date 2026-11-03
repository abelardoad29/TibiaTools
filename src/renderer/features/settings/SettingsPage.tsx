import { useState } from 'react'
import { FolderOpen, X } from 'lucide-react'
import type { MarketFeeRule } from '@core/domain/money/market-fee'
import type { Settings } from '@shared/settings'
import { platform } from '../../platform'
import { useApi, useApiMutation } from '../../lib/api'
import { formatDateTime, parseIntOrNull } from '../../lib/format'
import { WorldPicker } from '../../components/data'
import { Badge, Button, Card, DataTable, ErrorBox, Field, Input, Page, Select, Tabs, Toggle } from '../../components/ui'

type Tab = 'general' | 'rules' | 'analysis' | 'data'

export function SettingsPage() {
  const desktop = platform.kind === 'electron'
  const [tab, setTab] = useState<Tab>('general')
  const settings = useApi('app.settings.get', undefined)
  const set = useApiMutation('app.settings.set', ['app.settings.get'])
  const s = settings.data
  if (!s) return null
  const patch = (p: Partial<Settings>) => set.mutate(p)
  return (
    <Page title="Ajustes">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: 'General' },
          ...(desktop
            ? ([
                { id: 'rules', label: 'Reglas económicas' },
                { id: 'analysis', label: 'Análisis y OCR' },
                { id: 'data', label: 'Datos y respaldos' },
              ] as const)
            : []),
        ]}
      />
      <ErrorBox error={set.error} />
      {tab === 'general' && (
        <Card title="General">
          <div className="grid max-w-3xl gap-4 md:grid-cols-2">
            <Field label="Tema">
              <Select value={s.theme} onChange={(e) => patch({ theme: e.target.value as Settings['theme'] })} options={[{ value: 'dark', label: 'Oscuro' }, { value: 'light', label: 'Claro' }, { value: 'system', label: 'Sistema' }]} />
            </Field>
            <Field label="Mundo principal">
              <WorldPicker value={s.homeWorld} onChange={(w) => patch({ homeWorld: w })} allowEmpty />
            </Field>
            <Field label="Mis mundos" hint="Salen primero en todos los selectores de mundo (OCR, Market, Arbitraje…). También puedes marcarlos con ★ en Mundos.">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {s.favoriteWorlds.map((w) => (
                    <span key={w} className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-sm">
                      {w}
                      <button type="button" className="text-muted hover:text-bad" aria-label={`Quitar ${w}`} onClick={() => patch({ favoriteWorlds: s.favoriteWorlds.filter((x) => x !== w) })}>
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                  {s.favoriteWorlds.length === 0 && <span className="text-xs text-muted">Ninguno todavía.</span>}
                </div>
                <WorldPicker value={null} onChange={(w) => w && !s.favoriteWorlds.includes(w) && patch({ favoriteWorlds: [...s.favoriteWorlds, w] })} label="Agregar mundo…" />
              </div>
            </Field>
            {desktop && (
              <>
                <Field label="Atajo de captura" hint="Formato Electron, p. ej. CommandOrControl+Shift+F12. Solo dispara una captura en esta app.">
                  <Input value={s.collector.hotkey ?? ''} onChange={(e) => patch({ collector: { ...s.collector, hotkey: e.target.value || null } })} />
                </Field>
                <Field label="Consultar personajes cada (min)" hint="Se aplica al reiniciar. Mínimo 2.">
                  <Input inputMode="numeric" value={s.tracker.pollMinutes} onChange={(e) => patch({ tracker: { ...s.tracker, pollMinutes: Math.max(2, Number(e.target.value) || 5) } })} />
                </Field>
                <Toggle checked={s.notifications.enabled} onChange={(v) => patch({ notifications: { enabled: v } })} label="Notificaciones de Windows" />
                <Toggle checked={s.tracker.notify} onChange={(v) => patch({ tracker: { ...s.tracker, notify: v } })} label="Notificar level up / muertes" />
                <Toggle checked={s.network.thirdPartyEnabled} onChange={(v) => patch({ network: { ...s.network, thirdPartyEnabled: v } })} label="Permitir datos de terceros (tibiamarket.top)" />
                {s.network.thirdPartyEnabled && (
                  <div className="flex flex-wrap items-end gap-3">
                    <Toggle
                      checked={s.network.thirdPartyAutoSync}
                      onChange={(v) => patch({ network: { ...s.network, thirdPartyAutoSync: v } })}
                      label="Bajar los precios de todos los mundos automáticamente (solo los que cambiaron)"
                    />
                    <Field label="Revisar cada (horas)">
                      <Input
                        inputMode="numeric"
                        className="w-20"
                        disabled={!s.network.thirdPartyAutoSync}
                        value={s.network.thirdPartySyncHours}
                        onChange={(e) => patch({ network: { ...s.network, thirdPartySyncHours: Math.min(168, Math.max(1, Number(e.target.value) || 1)) } })}
                      />
                    </Field>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      )}
      {tab === 'rules' && <Rules />}
      {tab === 'analysis' && (
        <Card title="Análisis y OCR">
          <div className="grid max-w-4xl gap-4 md:grid-cols-3">
            <Field label="Snapshots mínimos para Historical">
              <Input inputMode="numeric" value={s.analysis.minSnapshots} onChange={(e) => patch({ analysis: { ...s.analysis, minSnapshots: Math.max(1, Number(e.target.value) || 5) } })} />
            </Field>
            <Field label="Datos viejos a partir de (h)">
              <Input inputMode="numeric" value={s.analysis.staleAfterHours} onChange={(e) => patch({ analysis: { ...s.analysis, staleAfterHours: Math.max(1, Number(e.target.value) || 48) } })} />
            </Field>
            <Field label="Descuento de Historical en Hybrid (0–1)">
              <Input inputMode="decimal" value={s.analysis.historicalHaircut} onChange={(e) => patch({ analysis: { ...s.analysis, historicalHaircut: Math.min(1, Math.max(0, Number(e.target.value) || 0)) } })} />
            </Field>
            {(['roi', 'liquidity', 'confidence', 'stability'] as const).map((k) => (
              <Field key={k} label={`Peso ${k}`}>
                <Input inputMode="decimal" value={s.analysis.weights[k]} onChange={(e) => patch({ analysis: { ...s.analysis, weights: { ...s.analysis.weights, [k]: Math.max(0, Number(e.target.value) || 0) } } })} />
              </Field>
            ))}
            <Field label="ROI para score 100 (%)">
              <Input inputMode="numeric" value={s.analysis.scoreParams.roiForFullScore} onChange={(e) => patch({ analysis: { ...s.analysis, scoreParams: { ...s.analysis.scoreParams, roiForFullScore: Math.max(1, Number(e.target.value) || 50) } } })} />
            </Field>
            <Field label="Vida media de la confianza (h)">
              <Input inputMode="numeric" value={s.analysis.scoreParams.freshnessHalfLifeHours} onChange={(e) => patch({ analysis: { ...s.analysis, scoreParams: { ...s.analysis.scoreParams, freshnessHalfLifeHours: Math.max(1, Number(e.target.value) || 24) } } })} />
            </Field>
            <Field label="Peso de datos de terceros (0–1)">
              <Input inputMode="decimal" value={s.analysis.scoreParams.thirdPartyWeight} onChange={(e) => patch({ analysis: { ...s.analysis, scoreParams: { ...s.analysis.scoreParams, thirdPartyWeight: Math.min(1, Math.max(0, Number(e.target.value) || 0)) } } })} />
            </Field>
            <Field label="OCR: aceptación sugerida ≥" hint="No es precisión garantizada">
              <Input inputMode="decimal" value={s.ocr.acceptThreshold} onChange={(e) => patch({ ocr: { ...s.ocr, acceptThreshold: Math.min(1, Math.max(0, Number(e.target.value) || 0.98)) } })} />
            </Field>
            <Field label="OCR: revisión obligatoria <">
              <Input inputMode="decimal" value={s.ocr.reviewThreshold} onChange={(e) => patch({ ocr: { ...s.ocr, reviewThreshold: Math.min(1, Math.max(0, Number(e.target.value) || 0.9)) } })} />
            </Field>
            <Field label="Importación: tamaño máximo (MB)">
              <Input inputMode="numeric" value={s.collector.maxImportMb} onChange={(e) => patch({ collector: { ...s.collector, maxImportMb: Math.max(1, Number(e.target.value) || 25) } })} />
            </Field>
          </div>
        </Card>
      )}
      {tab === 'data' && <DataTab />}
    </Page>
  )
}

function Rules() {
  const rules = useApi('analysis.rules', undefined)
  const history = useApi('analysis.rules.history', { key: 'market_fee' })
  const add = useApiMutation('analysis.rules.add', ['analysis.rules', 'analysis.rules.history'])
  const [fee, setFee] = useState<MarketFeeRule | null>(null)
  const [tc, setTc] = useState<{ regular: string; express: string } | null>(null)
  const [source, setSource] = useState('')
  if (!rules.data) return null
  const f = fee ?? rules.data.marketFee.value
  const t = tc ?? { regular: String(rules.data.transferCostTc.value.regular ?? ''), express: String(rules.data.transferCostTc.value.express ?? '') }
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Comisión del Market (versionada)">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Tasa (bps; 250 = 2.5 %)">
            <Input inputMode="numeric" value={f.rateBps} onChange={(e) => setFee({ ...f, rateBps: parseIntOrNull(e.target.value) ?? 0 })} />
          </Field>
          <Field label="Mínimo gp">
            <Input inputMode="numeric" value={f.minGp} onChange={(e) => setFee({ ...f, minGp: parseIntOrNull(e.target.value) ?? 0 })} />
          </Field>
          <Field label="Máximo gp">
            <Input inputMode="numeric" value={f.maxGp} onChange={(e) => setFee({ ...f, maxGp: parseIntOrNull(e.target.value) ?? 0 })} />
          </Field>
          <Field label="Base">
            <Select value={f.basis} onChange={(e) => setFee({ ...f, basis: e.target.value as 'unit' | 'total' })} options={[{ value: 'total', label: 'Total (precio × cantidad)' }, { value: 'unit', label: 'Precio unitario' }]} />
          </Field>
          <Field label="Redondeo">
            <Select value={f.rounding} onChange={(e) => setFee({ ...f, rounding: e.target.value as MarketFeeRule['rounding'] })} options={[{ value: 'ceil', label: 'Hacia arriba' }, { value: 'floor', label: 'Hacia abajo' }, { value: 'round', label: 'Al más cercano' }]} />
          </Field>
          <div className="flex flex-col justify-end gap-1">
            <Toggle checked={f.basisVerified} onChange={(v) => setFee({ ...f, basisVerified: v })} label="Base verificada" />
            <Toggle checked={f.roundingVerified} onChange={(v) => setFee({ ...f, roundingVerified: v })} label="Redondeo verificado" />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          Para verificar: en el panel de crear oferta del cliente escribe precio y cantidad y anota el «Fee» que muestra, sin confirmar la oferta.
        </p>
        <Field label="Fuente" className="mt-2">
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder={rules.data.marketFee.sourceUrl ?? ''} />
        </Field>
        <Button className="mt-2" variant="primary" busy={add.isPending} onClick={() => add.mutate({ key: 'market_fee', value: f, sourceUrl: source || rules.data!.marketFee.sourceUrl, notes: 'Editada en Ajustes', verifiedAt: today }, { onSuccess: () => setFee(null) })}>
          Guardar nueva versión
        </Button>
        <div className="mt-4">
          <DataTable
            rows={history.data ?? []}
            rowKey={(r) => r.id}
            pageSize={5}
            columns={[
              { key: 'v', header: 'Versión', cell: (r) => `#${r.id}` },
              { key: 'val', header: 'Valor', cell: (r) => <span className="font-mono text-xs">{JSON.stringify(r.value)}</span> },
              { key: 'ver', header: 'Verificada', cell: (r) => r.verifiedAt ?? <Badge tone="warn">no</Badge> },
              { key: 'at', header: 'Creada', cell: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        </div>
      </Card>
      <Card title="Transferencia de personaje (Tibia Coins)">
        <p className="mb-2 text-xs text-muted">El manual oficial no publica los montos. Cópialos de la Store; se guardan con fecha.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Regular (TC)">
            <Input inputMode="numeric" value={t.regular} onChange={(e) => setTc({ ...t, regular: e.target.value })} />
          </Field>
          <Field label="Express (TC)">
            <Input inputMode="numeric" value={t.express} onChange={(e) => setTc({ ...t, express: e.target.value })} />
          </Field>
        </div>
        <Button
          className="mt-2"
          variant="primary"
          busy={add.isPending}
          onClick={() => add.mutate({ key: 'transfer_cost_tc', value: { regular: parseIntOrNull(t.regular), express: parseIntOrNull(t.express) }, sourceUrl: 'Tibia Store', notes: 'Editado en Ajustes', verifiedAt: today }, { onSuccess: () => setTc(null) })}
        >
          Guardar
        </Button>
        <p className="mt-2 text-xs text-muted">
          Verificado: {rules.data.transferCostTc.verifiedAt ?? 'nunca'}. Reglas de rutas: versión {rules.data.transferRules.version}, verificadas {rules.data.transferRules.verifiedAt} (vigencia {rules.data.transferRules.validityDays} días).
        </p>
      </Card>
    </div>
  )
}

function DataTab() {
  const info = useApi('app.info', undefined)
  const backups = useApi('app.backup.list', undefined)
  const create = useApiMutation('app.backup.create', ['app.backup.list'])
  const restore = useApiMutation('app.backup.restore')
  const open = useApiMutation('app.openFolder')
  const logs = useApi('app.logs.tail', { lines: 80 }, { enabled: false })
  const [confirmPath, setConfirmPath] = useState<string | null>(null)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Datos locales">
        {info.data && (
          <div className="flex flex-col gap-1 text-sm">
            <div>Versión {info.data.version} · esquema v{info.data.schemaVersion}</div>
            <div className="text-xs text-muted">{info.data.dataDir}</div>
            <div className="text-xs text-muted">
              Seeds: items {formatDateTime(info.data.seeds.items)} · mundos {formatDateTime(info.data.seeds.worlds)} · imbuements {formatDateTime(info.data.seeds.imbuements)}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {(['data', 'evidence', 'backups', 'exports', 'logs'] as const).map((t) => (
            <Button key={t} onClick={() => open.mutate({ target: t })}>
              <FolderOpen className="size-4" /> {t}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Las capturas originales nunca se borran automáticamente. Los respaldos incluyen la versión de esquema en el nombre.</p>
      </Card>
      <Card title="Respaldos" actions={<Button variant="primary" busy={create.isPending} onClick={() => create.mutate(undefined)}>Crear respaldo</Button>}>
        <ErrorBox error={create.error ?? restore.error} />
        <DataTable
          rows={backups.data ?? []}
          rowKey={(b) => b.path}
          pageSize={8}
          empty="Sin respaldos."
          columns={[
            { key: 'n', header: 'Archivo', cell: (b) => <span className="text-xs">{b.name}</span> },
            { key: 's', header: 'Tamaño', cell: (b) => `${(b.size / 1024 / 1024).toFixed(1)} MB`, align: 'right' },
            {
              key: 'r',
              header: '',
              cell: (b) =>
                confirmPath === b.path ? (
                  <span className="flex gap-1">
                    <Button variant="danger" busy={restore.isPending} onClick={() => restore.mutate({ path: b.path })}>
                      Confirmar (reinicia la app)
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmPath(null)}>
                      Cancelar
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmPath(b.path)}>
                    Restaurar…
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Card title="Log" actions={<Button onClick={() => void logs.refetch()}>Ver últimas líneas</Button>} className="xl:col-span-2">
        {logs.data && <pre className="max-h-80 overflow-auto rounded-lg bg-panel-2 p-2 text-[11px]">{logs.data.join('\n') || '(vacío)'}</pre>}
      </Card>
    </div>
  )
}
