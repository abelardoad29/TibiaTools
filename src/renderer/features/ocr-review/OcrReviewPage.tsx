import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CheckCircle2, Plus, ScanText, Trash2, XCircle } from 'lucide-react'
import type { ConfirmOfferInput, ConfirmStatsInput, ItemSummary, Screenshot } from '@shared/api'
import { parseGp } from '@core/domain/money/gp'
import { OCR_VERSION, PARSER_VERSION, reviewLevel, validateRows } from '@core/ocr/pipeline'
import type { DetailsField, OcrOfferRow, OcrProfile, OcrResult, ScreenType } from '@core/ocr/types'
import { call, useApi, useApiMutation } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { Confidence, ItemPicker, WorldPicker } from '../../components/data'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Page, Select, Warnings } from '../../components/ui'
import { ImageRegions } from './ImageRegions'
import { emptyProfile, ProfileEditor } from './ProfileEditor'
import { loadImage, runOcrInWorker } from './imaging'

interface EditField {
  raw: string
  ocr: number | null
  text: string
  confidence: number
}

interface EditRow {
  key: string
  side: 'buy' | 'sell'
  rowIndex: number
  include: boolean
  reviewed: boolean
  amount: EditField
  unitPrice: EditField
  totalPrice: EditField | null
  endsAt: string | null
}

const fieldFrom = (f: { raw: string; value: number | null; confidence: number }): EditField => ({ raw: f.raw, ocr: f.value, text: f.value === null ? f.raw : String(f.value), confidence: f.confidence })
const valueOf = (f: EditField | null) => (f ? parseGp(f.text) : null)
const edited = (f: EditField | null) => !!f && valueOf(f) !== f.ocr

const FIELDS: DetailsField[] = ['transactions', 'highest', 'average', 'lowest']
const FIELD_LABEL: Record<DetailsField, string> = { transactions: 'Transacciones', highest: 'Máximo', average: 'Promedio', lowest: 'Mínimo' }

export function OcrReviewPage() {
  const [params, setParams] = useSearchParams()
  const shotId = params.get('shot')
  const list = useApi('collector.screenshots.list', { status: null, limit: 100 })
  const shot = list.data?.find((s) => s.id === shotId) ?? null
  const pending = (list.data ?? []).filter((s) => s.status === 'new' || s.status === 'processed')

  return (
    <Page title="Revisión OCR" subtitle="Corrige lo que leyó el OCR antes de guardarlo. La captura original se conserva intacta.">
      <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
        <Card title={`Pendientes (${pending.length})`}>
          <div className="flex max-h-[75vh] flex-col gap-2 overflow-auto">
            {pending.length === 0 && <Empty>No hay capturas pendientes.</Empty>}
            {pending.map((s) => (
              <button key={s.id} onClick={() => setParams({ shot: s.id })} className={`flex flex-col gap-1 rounded-lg border p-1.5 text-left ${s.id === shotId ? 'border-accent' : 'border-line hover:border-accent/60'}`}>
                <img src={s.url} alt="" className="h-16 w-full rounded object-contain" loading="lazy" />
                <span className="text-[11px] text-muted">
                  {formatDateTime(s.capturedAtUtc)} · {s.screenType ?? 'sin tipo'}
                </span>
              </button>
            ))}
          </div>
        </Card>
        {shot ? <Review key={shot.id} shot={shot} onDone={() => setParams({})} /> : <Empty>Elige una captura de la lista o captura una nueva en Collector.</Empty>}
      </div>
    </Page>
  )
}

function Review({ shot, onDone }: { shot: Screenshot; onDone: () => void }) {
  const settings = useApi('app.settings.get', undefined)
  const profiles = useApi('ocr.profiles.list', undefined)
  const worlds = useApi('catalog.worlds.list', { activeOnly: false })
  const update = useApiMutation('collector.screenshots.update', ['collector.screenshots.list'])
  const reject = useApiMutation('collector.screenshots.setStatus', ['collector.screenshots.list'])
  const confirm = useApiMutation('ocr.confirmScan', ['collector.screenshots.list', 'market.coverage', 'app.info'])
  const exportProfile = useApiMutation('ocr.profiles.export')
  const importProfile = useApiMutation('ocr.profiles.import', ['ocr.profiles.list'])
  const [screenType, setScreenType] = useState<ScreenType>(shot.screenType ?? 'offers')
  const [world, setWorld] = useState<string | null>(null)
  const [item, setItem] = useState<ItemSummary | null>(null)
  const [profileId, setProfileId] = useState<number | null>(null)
  const [editing, setEditing] = useState<OcrProfile | null>(null)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [rows, setRows] = useState<EditRow[]>([])
  const [details, setDetails] = useState<Record<string, EditField>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    if (shot.worldId && worlds.data) setWorld(worlds.data.find((w) => w.id === shot.worldId)?.name ?? null)
  }, [shot.worldId, worlds.data])
  useEffect(() => {
    if (shot.itemId) void call('catalog.items.get', { id: shot.itemId }).then((i) => i && setItem(i))
  }, [shot.itemId])
  const candidates = (profiles.data ?? []).filter((p) => p.screenType === screenType)
  useEffect(() => {
    if (profileId === null && candidates.length) {
      // Preferir un perfil con la misma resolución que la captura.
      setProfileId((candidates.find((p) => p.refWidth === shot.width && p.refHeight === shot.height) ?? candidates[0]!).id)
    }
  }, [candidates, profileId, shot.width, shot.height])
  const profile = candidates.find((p) => p.id === profileId) ?? null
  const thresholds = settings.data?.ocr ?? { acceptThreshold: 0.98, reviewThreshold: 0.9 }
  const worldId = worlds.data?.find((w) => w.name === world)?.id ?? null

  const persistMeta = (patch: Partial<{ screenType: ScreenType; worldId: number | null; itemId: number | null }>) =>
    update.mutate({ id: shot.id, screenType: patch.screenType ?? screenType, worldId: patch.worldId !== undefined ? patch.worldId : worldId, itemId: patch.itemId !== undefined ? patch.itemId : (item?.id ?? null), region: shot.region })

  const run = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      const r = await runOcrInWorker(await loadImage(shot.url), profile)
      setResult(r)
      setRows(
        r.rows.map((row) => ({
          key: `${row.side}-${row.rowIndex}`,
          side: row.side,
          rowIndex: row.rowIndex,
          include: true,
          reviewed: false,
          amount: fieldFrom(row.amount),
          unitPrice: fieldFrom(row.unitPrice),
          totalPrice: row.totalPrice ? fieldFrom(row.totalPrice) : null,
          endsAt: row.endsAt?.raw ?? null,
        })),
      )
      setDetails(Object.fromEntries(r.details.map((d) => [`${d.side}:${d.field}`, fieldFrom(d.value)])))
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  // Validación sobre los valores editados (no sobre lo que leyó el OCR).
  const validated = useMemo(() => {
    const asOcr: OcrOfferRow[] = rows
      .filter((r) => r.include)
      .map((r) => ({
        side: r.side,
        rowIndex: r.rowIndex,
        rect: { x: 0, y: 0, w: 1, h: 1 },
        amount: { raw: r.amount.raw, value: valueOf(r.amount), confidence: r.amount.confidence, unknownGlyphs: 0 },
        unitPrice: { raw: r.unitPrice.raw, value: valueOf(r.unitPrice), confidence: r.unitPrice.confidence, unknownGlyphs: 0 },
        totalPrice: r.totalPrice ? { raw: r.totalPrice.raw, value: valueOf(r.totalPrice), confidence: r.totalPrice.confidence, unknownGlyphs: 0 } : null,
        endsAt: null,
        issues: [],
      }))
    return new Map(validateRows(asOcr).map((r) => [`${r.side}-${r.rowIndex}`, r.issues]))
  }, [rows])

  const needsReview = (r: EditRow) => {
    const conf = Math.min(r.amount.confidence, r.unitPrice.confidence)
    return reviewLevel(conf, thresholds) === 'required' && !r.reviewed && !edited(r.amount) && !edited(r.unitPrice)
  }
  const included = rows.filter((r) => r.include)
  const blocking = included.filter((r) => (validated.get(r.key)?.length ?? 0) > 0 || needsReview(r))
  const canConfirm = !!worldId && !!item && result !== null && (screenType === 'details' ? Object.keys(details).length > 0 : included.length > 0 && blocking.length === 0)

  const doConfirm = () => {
    const correction = (field: string, f: EditField) => (edited(f) ? [{ field, raw: f.raw, ocrValue: f.ocr === null ? '' : String(f.ocr), corrected: f.text }] : [])
    const offers: ConfirmOfferInput[] = included.map((r) => ({
      side: r.side,
      rowIndex: r.rowIndex,
      unitPrice: valueOf(r.unitPrice)!,
      amount: valueOf(r.amount)!,
      totalPrice: valueOf(r.totalPrice),
      expirationText: r.endsAt,
      rawPriceText: r.unitPrice.raw,
      rawAmountText: r.amount.raw,
      // Un campo corregido a mano queda con confianza 1 (lo confirmó el usuario).
      priceConfidence: edited(r.unitPrice) || r.reviewed ? 1 : r.unitPrice.confidence,
      amountConfidence: edited(r.amount) || r.reviewed ? 1 : r.amount.confidence,
      corrections: [...correction('amount', r.amount), ...correction('unitPrice', r.unitPrice), ...(r.totalPrice ? correction('totalPrice', r.totalPrice) : [])],
    }))
    const stats: ConfirmStatsInput[] = (['buy', 'sell'] as const)
      .filter((side) => FIELDS.some((f) => details[`${side}:${f}`]))
      .map((side) => {
        const get = (f: DetailsField) => details[`${side}:${f}`]
        const v = (f: DetailsField) => (get(f) ? parseGp(get(f)!.text) : null)
        return {
          side,
          transactions: v('transactions'),
          avgPrice: v('average'),
          minPrice: v('lowest'),
          maxPrice: v('highest'),
          confidence: Math.min(...FIELDS.map((f) => (get(f) ? (edited(get(f)!) ? 1 : get(f)!.confidence) : 1))),
          corrections: FIELDS.flatMap((f) => (get(f) ? correction(f, get(f)!) : [])),
        }
      })
    confirm.mutate(
      { screenshotId: shot.id, profileId: profile?.id ?? null, worldId: worldId!, itemId: item!.id, screenType, ocrVersion: result?.ocrVersion ?? OCR_VERSION, parserVersion: PARSER_VERSION, offers, stats },
      { onSuccess: onDone },
    )
  }

  const setRow = (key: string, patch: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const setField = (key: string, field: 'amount' | 'unitPrice' | 'totalPrice', text: string) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: { ...(r[field] ?? { raw: '', ocr: null, confidence: 0 }), text } } : r)))

  const overlay = result
    ? result.rows.map((r, i) => ({ rect: r.rect, label: '', tone: (validated.get(`${r.side}-${r.rowIndex}`)?.length ? 'bad' : 'good') as 'bad' | 'good', i }))
    : (profile?.tables ?? []).map((t) => ({ rect: t.rect, label: `Tabla ${t.side}`, tone: 'info' as const }))

  return (
    <div className="flex flex-col gap-4">
      <Card title="Captura">
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="max-h-[55vh] overflow-auto">
            <ImageRegions src={shot.url} rects={overlay} highlight={hover} />
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-xs text-muted">
              {formatDateTime(shot.capturedAtUtc)} (local {shot.capturedAtLocal.slice(0, 16).replace('T', ' ')}) · {shot.width}×{shot.height} · {shot.sourceMode} · sha256 {shot.sha256.slice(0, 12)}…
            </div>
            <Field label="Pantalla">
              <Select
                value={screenType}
                onChange={(e) => {
                  const v = e.target.value as ScreenType
                  setScreenType(v)
                  setProfileId(null)
                  setResult(null)
                  persistMeta({ screenType: v })
                }}
                options={[
                  { value: 'offers', label: 'Ofertas (buy/sell)' },
                  { value: 'details', label: 'Details (estadísticas 30 días)' },
                ]}
              />
            </Field>
            <Field label="Mundo">
              <WorldPicker
                value={world}
                allowEmpty
                activeOnly={false}
                onChange={(w) => {
                  setWorld(w)
                  persistMeta({ worldId: worlds.data?.find((x) => x.name === w)?.id ?? null })
                }}
              />
            </Field>
            <Field label="Item">
              <ItemPicker
                value={item}
                onChange={(i) => {
                  setItem(i)
                  persistMeta({ itemId: i?.id ?? null })
                }}
              />
            </Field>
            <Field label="Perfil OCR">
              <div className="flex gap-2">
                <Select
                  value={String(profileId ?? '')}
                  onChange={(e) => setProfileId(Number(e.target.value) || null)}
                  options={[{ value: '', label: candidates.length ? 'Elegir…' : 'Sin perfiles para esta pantalla' }, ...candidates.map((p) => ({ value: String(p.id), label: `${p.name} (v${p.version}, ${p.refWidth}×${p.refHeight})` }))]}
                />
                <Button onClick={() => setEditing(profile ?? emptyProfile(screenType, shot.width, shot.height))}>{profile ? 'Editar' : 'Crear'}</Button>
                {profile && (
                  <Button variant="ghost" onClick={() => profile.id && exportProfile.mutate({ id: profile.id })} title="Exportar perfil (JSON)">
                    Exportar
                  </Button>
                )}
                <Button variant="ghost" onClick={() => importProfile.mutate(undefined, { onSuccess: (p) => p && setProfileId(p.id) })} title="Importar perfil (JSON)">
                  Importar
                </Button>
              </div>
              {exportProfile.data && <span className="text-xs text-good">Exportado: {exportProfile.data.path}</span>}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void run()} busy={busy} disabled={!profile}>
                <ScanText className="size-4" /> Ejecutar OCR
              </Button>
              <Button variant="danger" onClick={() => reject.mutate({ id: shot.id, status: 'rejected' }, { onSuccess: onDone })}>
                <XCircle className="size-4" /> Rechazar captura
              </Button>
            </div>
            <ErrorBox error={error ?? confirm.error ?? reject.error} />
            {result && <Warnings items={result.warnings} />}
          </div>
        </div>
      </Card>

      {result && screenType === 'offers' && (
        <Card
          title={`Ofertas leídas (${included.length})`}
          actions={
            <Button
              onClick={() =>
                setRows((rs) => [
                  ...rs,
                  { key: `manual-${Date.now()}`, side: 'sell', rowIndex: rs.length, include: true, reviewed: true, amount: { raw: '', ocr: null, text: '', confidence: 1 }, unitPrice: { raw: '', ocr: null, text: '', confidence: 1 }, totalPrice: null, endsAt: null },
                ])
              }
            >
              <Plus className="size-4" /> Fila manual
            </Button>
          }
        >
          {rows.length === 0 ? (
            <Empty>El OCR no encontró filas: revisa las regiones del perfil o agrega filas a mano.</Empty>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-2 py-1 text-left">Incluir</th>
                    <th className="px-2 py-1 text-left">Lado</th>
                    <th className="px-2 py-1 text-right">Cantidad</th>
                    <th className="px-2 py-1 text-right">Precio unidad</th>
                    <th className="px-2 py-1 text-right">Total</th>
                    <th className="px-2 py-1 text-left">Vence</th>
                    <th className="px-2 py-1 text-left">Confianza</th>
                    <th className="px-2 py-1 text-left">Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const issues = validated.get(r.key) ?? []
                    const conf = Math.min(r.amount.confidence, r.unitPrice.confidence)
                    const level = reviewLevel(conf, thresholds)
                    return (
                      <tr key={r.key} className={`border-t border-line ${r.include ? '' : 'opacity-40'}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                        <td className="px-2 py-1">
                          <input type="checkbox" className="size-4" checked={r.include} onChange={(e) => setRow(r.key, { include: e.target.checked })} aria-label="Incluir fila" />
                        </td>
                        <td className="px-2 py-1">
                          <Select value={r.side} onChange={(e) => setRow(r.key, { side: e.target.value as 'buy' | 'sell' })} options={[{ value: 'sell', label: 'Sell' }, { value: 'buy', label: 'Buy' }]} />
                        </td>
                        {(['amount', 'unitPrice', 'totalPrice'] as const).map((f) => {
                          const field = r[f]
                          return (
                            <td key={f} className="px-2 py-1 text-right">
                              {field || f !== 'totalPrice' ? (
                                <div className="flex flex-col items-end">
                                  <Input className={`num w-32 text-right ${edited(field) ? 'border-info' : ''}`} value={field?.text ?? ''} onChange={(e) => setField(r.key, f, e.target.value)} aria-label={f} />
                                  {field?.raw && <span className="font-mono text-[10px] text-muted" title="Texto OCR sin procesar">raw: {field.raw}</span>}
                                </div>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-2 py-1 font-mono text-xs">{r.endsAt ?? '—'}</td>
                        <td className="px-2 py-1">
                          <Confidence value={conf} /> <Badge tone={level === 'accept' ? 'good' : level === 'review' ? 'warn' : 'bad'}>{level === 'accept' ? 'aceptable' : level === 'review' ? 'revisar' : 'obligatoria'}</Badge>
                        </td>
                        <td className="px-2 py-1 text-xs">
                          {issues.length ? <span className="text-bad">{issues.join(' · ')}</span> : needsReview(r) ? (
                            <label className="inline-flex items-center gap-1 text-warn">
                              <input type="checkbox" checked={r.reviewed} onChange={(e) => setRow(r.key, { reviewed: e.target.checked })} /> Revisado
                            </label>
                          ) : (
                            <CheckCircle2 className="size-4 text-good" aria-label="OK" />
                          )}
                        </td>
                        <td>
                          <Button variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Eliminar fila">
                            <Trash2 className="size-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {result && screenType === 'details' && (
        <Card title="Estadísticas de 30 días (vista Details)">
          <div className="grid gap-4 md:grid-cols-2">
            {(['sell', 'buy'] as const).map((side) => (
              <div key={side} className="flex flex-col gap-2">
                <div className="text-sm font-medium">{side === 'sell' ? 'Sell offers' : 'Buy offers'}</div>
                {FIELDS.map((f) => {
                  const k = `${side}:${f}`
                  const v = details[k]
                  return (
                    <Field key={k} label={FIELD_LABEL[f]} hint={v?.raw ? `raw: ${v.raw}` : undefined}>
                      <Input
                        className="num text-right"
                        value={v?.text ?? ''}
                        onChange={(e) => setDetails({ ...details, [k]: { ...(v ?? { raw: '', ocr: null, confidence: 1 }), text: e.target.value } })}
                      />
                    </Field>
                  )
                })}
              </div>
            ))}
          </div>
        </Card>
      )}

      {result && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!worldId && <span className="text-sm text-warn">Falta el mundo</span>}
          {!item && <span className="text-sm text-warn">Falta el item</span>}
          {blocking.length > 0 && <span className="text-sm text-warn">{blocking.length} filas con errores o sin revisar</span>}
          <Button variant="primary" disabled={!canConfirm} busy={confirm.isPending} onClick={doConfirm}>
            <CheckCircle2 className="size-4" /> Confirmar snapshot
          </Button>
        </div>
      )}
      {editing && (
        <ProfileEditor
          initial={editing}
          imageUrl={shot.url}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            setProfileId(p.id)
            setEditing(p)
          }}
        />
      )}
    </div>
  )
}
