import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ImbuableItem, ImbuementCatalog } from '@shared/api'
import type { ImbuedItemBuild, ImbuedSlot, Settings } from '@shared/settings'
import type { DataSource } from '@shared/provenance'
import { huntCost, imbuedItemCost, imbuementCost, materialsForTier, TIERS, withPaidTotal, type ImbuementCost, type ImbuementTier } from '@core/domain/tools/imbuements'
import { allowedImbuements, duplicateImbuements } from '@core/domain/tools/imbuable'
import { matchScore } from '@core/domain/catalog/names'
import { platform } from '../../platform'
import { useApi, useApiMutation } from '../../lib/api'
import { formatGp, parseIntOrNull } from '../../lib/format'
import { Freshness, Gp, ItemIcon, ProvenanceBadge, WorldPicker } from '../../components/data'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat, Toggle } from '../../components/ui'

const GOLD_TOKEN = 'Gold Token'
const scrollName = (imb: string, tier: ImbuementTier) => `${tier.toLowerCase()} ${imb.toLowerCase()} scroll`

type PriceMap = Record<string, { price: number; observedAt: string; source: DataSource } | null>

type CostFn = (imbName: string, tierName: ImbuementTier, slot?: Pick<ImbuedSlot, 'prices' | 'paidTotal'> | null) => ImbuementCost | null

/**
 * Calcula el costo de un imbuement. Prioridad de precios: los propios del slot (lo que pagaste en ese item),
 * luego los manuales globales y luego el Market. Si el slot tiene "precio pagado", ese total manda.
 */
function useCostFn(catalog: ImbuementCatalog | undefined, settings: Settings | undefined, prices: PriceMap | undefined): CostFn {
  return (imbName, tierName, slot) => {
    const def = catalog?.imbuements.find((i) => i.name === imbName)
    const tier = catalog?.tiers.find((t) => t.tier === tierName)
    if (!catalog || !def || !tier || !settings) return null
    const manual = settings.imbuements.manualPrices
    const priceOf = (n: string) => slot?.prices?.[n] ?? manual[n] ?? prices?.[n]?.price ?? null
    const override = settings.imbuements.tokensPerTier
    const cost = imbuementCost(def, tier, catalog.tiers, {
      prices: Object.fromEntries(def.materials.map((m) => [m.item, priceOf(m.item)])),
      goldTokenPrice: priceOf(GOLD_TOKEN),
      tokensPerTier: { Basic: override.Basic ?? catalog.tokensPerTier.Basic, Intricate: override.Intricate ?? catalog.tokensPerTier.Intricate, Powerful: override.Powerful ?? catalog.tokensPerTier.Powerful },
      tokenTradeable: catalog.tokenTradeable.includes(def.name),
      scrollPrice: manual[scrollName(def.name, tierName)] ?? prices?.[scrollName(def.name, tierName)]?.price ?? null,
    })
    return slot?.paidTotal ? withPaidTotal(cost, slot.paidTotal) : cost
  }
}

export function Imbuements() {
  const { data: catalog, error } = useApi('tools.imbuements', undefined)
  const { data: settings } = useApi('app.settings.get', undefined)
  const save = useApiMutation('app.settings.set', ['app.settings.get'])
  const [imbName, setImbName] = useState('Vampirism')
  const [tierName, setTierName] = useState<ImbuementTier>('Powerful')
  const world = settings?.imbuements.world ?? settings?.homeWorld ?? null
  const builds = settings?.imbuements.builds

  // Todos los nombres con precio posible: materiales del cálculo y de los items creados, Gold Token y scrolls.
  const names = useMemo(() => {
    const used = new Set<string>([imbName, ...(builds ?? []).flatMap((b) => b.slots.filter(Boolean).map((s) => s!.imbuement))])
    const out = new Set<string>([GOLD_TOKEN])
    for (const imb of catalog?.imbuements ?? []) {
      if (!used.has(imb.name)) continue
      imb.materials.forEach((m) => out.add(m.item))
      TIERS.forEach((t) => out.add(scrollName(imb.name, t)))
    }
    return [...out]
  }, [catalog, imbName, builds])
  const icons = useApi('catalog.items.byName', { names })
  const prices = useApi('tools.imbuements.prices', { world: world ?? '', items: names }, { enabled: !!world && platform.kind === 'electron' })
  const costOf = useCostFn(catalog, settings, prices.data)

  if (error) return <ErrorBox error={error} />
  if (!catalog || !settings) return null
  const s = settings
  const manual = s.imbuements.manualPrices
  const setManual = (n: string, v: number | null) => {
    const next = { ...manual }
    if (v === null) delete next[n]
    else next[n] = v
    save.mutate({ imbuements: { ...s.imbuements, manualPrices: next } })
  }
  const cost = costOf(imbName, tierName)
  const iconOf = (n: string) => icons.data?.find((i) => i.name.toLowerCase() === n.toLowerCase())

  const priceRow = (name: string, qty?: number) => {
    const market = prices.data?.[name]
    const icon = iconOf(name)
    const price = manual[name] ?? market?.price ?? null
    return (
      <div key={name} className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
        {qty !== undefined && <Badge tone="accent">{qty}×</Badge>}
        {icon && <ItemIcon item={icon} />}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{name}</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {manual[name] !== undefined ? (
              <ProvenanceBadge kind="manual" />
            ) : market ? (
              <>
                <ProvenanceBadge kind={market.source === 'third_party' ? 'third_party' : 'own_capture'} /> <Freshness at={market.observedAt} />
              </>
            ) : (
              'sin precio'
            )}
          </div>
        </div>
        <Input className="w-28 text-right" inputMode="numeric" placeholder={market ? String(market.price) : 'precio'} value={manual[name] ?? ''} onChange={(e) => setManual(name, parseIntOrNull(e.target.value))} aria-label={`Precio manual de ${name}`} />
        <div className="w-28 text-right">{qty !== undefined ? <Gp value={price === null ? null : price * qty} /> : <Gp value={price} />}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card title="Imbuement">
          <div className="flex flex-col gap-3">
            <Field label="Tipo">
              <Select value={imbName} onChange={(e) => setImbName(e.target.value)} options={catalog.imbuements.map((i) => ({ value: i.name, label: `${i.name} — ${i.effect}` }))} />
            </Field>
            <Field label="Nivel">
              <Select value={tierName} onChange={(e) => setTierName(e.target.value as ImbuementTier)} options={catalog.tiers.map((t) => ({ value: t.tier, label: `${t.tier} (santuario ${formatGp(t.shrineFeeGp)} gp)` }))} />
            </Field>
            {platform.kind === 'electron' && (
              <Field label="Precios del Market de" hint="Mejor sell offer conocida. Los precios manuales mandan.">
                <WorldPicker value={world} allowEmpty label="Sin mundo (solo precios manuales)" onChange={(w) => save.mutate({ imbuements: { ...s.imbuements, world: w } })} />
              </Field>
            )}
            <p className="text-xs text-muted">
              Dura {catalog.durationHours} h; el tiempo corre solo con el item equipado y fuera de zona de protección (las backpacks corren siempre). {catalog.notes}
            </p>
          </div>
        </Card>
        <Card title={`${imbName} ${tierName}`}>
          {cost && (
            <div className="flex flex-col gap-2">
              {cost.lines.map((l) => priceRow(l.item, l.qty))}
              {catalog.tokenTradeable.includes(imbName) && priceRow(GOLD_TOKEN)}
              <div className="mt-2 overflow-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-panel-2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Cómo conseguirlo</th>
                      <th className="px-3 py-1.5 text-right">Total (con santuario)</th>
                      <th className="px-3 py-1.5 text-right">Por hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cost.options.map((o) => (
                      <tr key={o.label} className="border-t border-line">
                        <td className="px-3 py-1.5">
                          {o.label} {cost.best === o && <Badge tone="good">más barato</Badge>}
                          {o.missing.length > 0 && <div className="text-xs text-warn">Falta: {o.missing.join(', ')}</div>}
                          {o.note && <div className="text-xs text-muted">{o.note}</div>}
                        </td>
                        <td className="num px-3 py-1.5 text-right">
                          <Gp value={o.total} />
                        </td>
                        <td className="num px-3 py-1.5 text-right">{o.perHour === null ? '—' : `${formatGp(Math.round(o.perHour))} gp/h`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">Santuario {formatGp(cost.shrineFee)} gp incluido en las opciones con materiales o tokens. Un precio faltante nunca se toma como 0.</p>
            </div>
          )}
        </Card>
      </div>
      <Builds catalog={catalog} settings={s} costOf={costOf} globalPrice={(n) => manual[n] ?? prices.data?.[n]?.price ?? null} />
    </div>
  )
}

/** Buscador limitado a los items que admiten imbuements (con su cantidad de slots). */
function ImbuablePicker({ items, onPick }: { items: ImbuableItem[]; onPick: (i: ImbuableItem) => void }) {
  const [q, setQ] = useState('')
  const results = useMemo(
    () =>
      q.trim()
        ? items
            .map((i) => ({ i, s: matchScore(q, i.name) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, 30)
            .map((x) => x.i)
        : [],
    [q, items],
  )
  return (
    <div className="flex flex-col gap-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Buscar entre ${items.length} items imbuibles…`} className="w-80" autoFocus />
      {results.length > 0 && (
        <ul className="max-h-72 w-full max-w-xl overflow-auto rounded-lg border border-line bg-panel">
          {results.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => (onPick(i), setQ(''))} className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-panel-2">
                <ItemIcon item={i} size={28} />
                <span className="flex-1 truncate">{i.name}</span>
                <Badge tone="accent">
                  {i.slots} slot{i.slots > 1 ? 's' : ''}
                </Badge>
                <span className="w-32 truncate text-xs text-muted">{i.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && results.length === 0 && <span className="text-xs text-muted">Ningún item imbuible con ese nombre.</span>}
    </div>
  )
}

interface BuildsProps {
  catalog: ImbuementCatalog
  settings: Settings
  costOf: CostFn
  globalPrice: (name: string) => number | null
}

/** "Crear un item": un equipo imbuible con sus slots, precios propios por slot y costo por hora / por hunt. */
function Builds({ catalog, settings, costOf, globalPrice }: BuildsProps) {
  const save = useApiMutation('app.settings.set', ['app.settings.get'])
  const imbuable = useApi('tools.imbuable', undefined)
  const [draft, setDraft] = useState<ImbuedItemBuild | null>(null)
  const [choosing, setChoosing] = useState(false)
  const builds = settings.imbuements.builds
  const persist = (next: ImbuedItemBuild[]) => save.mutate({ imbuements: { ...settings.imbuements, builds: next } })
  const infoOf = (itemId: number | null) => (itemId === null ? null : (imbuable.data?.items.find((i) => i.id === itemId) ?? null))
  const slotCost = (s: ImbuedSlot | null) => (s ? costOf(s.imbuement, s.tier, s) : null)
  const costs = builds.map((b) => ({ build: b, cost: imbuedItemCost(b.slots.map(slotCost)) }))
  const hunt = huntCost(
    costs.map((c) => c.cost),
    settings.imbuements.huntHours,
  )

  const saveDraft = () => {
    if (!draft) return
    persist(builds.some((b) => b.id === draft.id) ? builds.map((b) => (b.id === draft.id ? draft : b)) : [...builds, draft])
    setDraft(null)
  }

  return (
    <Card
      title="Mis items imbuidos"
      actions={
        <Button onClick={() => (setChoosing(true), setDraft(null))}>
          <Plus className="size-4" /> Crear item
        </Button>
      }
    >
      <p className="mb-3 text-xs text-muted">
        Elige un equipo imbuible: tendrá sus slots reales y solo los imbuements que acepta. Si imbuiste con materiales caros, pon esos precios en el slot (o lo que pagaste en total) y el costo por hora usará ese valor.
      </p>
      {choosing && !draft && imbuable.data && (
        <div className="mb-4 rounded-lg border border-accent/50 p-3">
          <ImbuablePicker
            items={imbuable.data.items}
            onPick={(i) => (setDraft({ id: `${Date.now()}`, name: i.name, itemId: i.id, slots: Array.from({ length: i.slots }, () => null) }), setChoosing(false))}
          />
          <p className="mt-1 text-xs text-muted">Slots e imbuements permitidos según TibiaWiki EN.</p>
        </div>
      )}
      {draft && (
        <BuildEditor
          draft={draft}
          info={infoOf(draft.itemId)}
          slotTypes={imbuable.data?.slotTypes ?? {}}
          catalog={catalog}
          costOf={costOf}
          globalPrice={globalPrice}
          onChange={setDraft}
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
        />
      )}
      {builds.length === 0 && !draft && !choosing ? (
        <Empty>Crea un item (p. ej. un casco con Vampirism y Void) para ver su costo por hora y por hunt.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {costs.map(({ build, cost }) => {
            const info = infoOf(build.itemId)
            return (
              <div key={build.id} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  {info && <ItemIcon item={info} />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {build.name}{' '}
                      {info && (
                        <span className="text-xs text-muted">
                          · {info.slots} slot{info.slots > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 text-xs text-muted">
                      {build.slots.map((sl, i) => {
                        const sc = cost.slots[i]
                        const own = !!sl && (!!sl.paidTotal || Object.keys(sl.prices ?? {}).length > 0)
                        return sl ? (
                          <Badge key={i} tone={sc?.best ? (own ? 'info' : 'neutral') : 'warn'} title={sc?.best ? sc.best.label : 'Faltan precios'}>
                            {sl.tier} {sl.imbuement}: {sc?.best ? `${formatGp(sc.best.total!)} gp` : 'sin precio'}
                            {own && ' · precio propio'}
                          </Badge>
                        ) : (
                          <Badge key={i}>slot vacío</Badge>
                        )
                      })}
                    </div>
                  </div>
                  <Stat label="Por ciclo (20 h)" value={<Gp value={cost.perCycle} short />} />
                  <Stat label="Por hora" value={cost.perHour === null ? '—' : `${formatGp(Math.round(cost.perHour))}`} />
                  <Button variant="ghost" onClick={() => (setChoosing(false), setDraft(structuredClone(build)))}>
                    Editar
                  </Button>
                  <Button variant="ghost" onClick={() => persist(builds.filter((b) => b.id !== build.id))} aria-label={`Borrar ${build.name}`}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {cost.missing.length > 0 && <p className="mt-1 text-xs text-warn">Sin precio completo: {cost.missing.join(', ')}</p>}
              </div>
            )
          })}
          {builds.length > 0 && (
            <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-line pt-3">
              <Field label="Horas por hunt">
                <Input
                  inputMode="decimal"
                  className="w-24"
                  value={settings.imbuements.huntHours}
                  onChange={(e) => save.mutate({ imbuements: { ...settings.imbuements, huntHours: Math.max(0.25, Number(e.target.value.replace(',', '.')) || 1) } })}
                />
              </Field>
              <Stat label="Set completo por hora" value={hunt.perHour === null ? '—' : `${formatGp(Math.round(hunt.perHour))} gp`} />
              <Stat label={`Costo por hunt de ${settings.imbuements.huntHours} h`} value={<Gp value={hunt.perHunt} />} hint="solo el tiempo con el equipo puesto" />
            </div>
          )}
        </div>
      )}
      <ErrorBox error={save.error ?? imbuable.error} />
    </Card>
  )
}

function SlotPriceInput({ label, placeholder, value, onChange, hint }: { label: string; placeholder: string; value: number | undefined | null; onChange: (v: number | null) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input inputMode="numeric" placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange(parseIntOrNull(e.target.value))} />
    </Field>
  )
}

function BuildEditor({
  draft,
  info,
  slotTypes,
  catalog,
  costOf,
  globalPrice,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ImbuedItemBuild
  info: ImbuableItem | null
  slotTypes: Record<string, string[]>
  catalog: ImbuementCatalog
  costOf: CostFn
  globalPrice: (name: string) => number | null
  onChange: (b: ImbuedItemBuild) => void
  onSave: () => void
  onCancel: () => void
}) {
  const [showAll, setShowAll] = useState(false)
  const [pricesOpen, setPricesOpen] = useState<number | null>(null)
  const allowed = info && !showAll ? allowedImbuements(info, slotTypes) : catalog.imbuements.map((i) => i.name)
  const dupes = duplicateImbuements(draft.slots)
  const setSlot = (i: number, slot: ImbuedSlot | null) => onChange({ ...draft, slots: draft.slots.map((x, j) => (j === i ? slot : x)) })
  const setPrice = (i: number, slot: ImbuedSlot, name: string, v: number | null) => {
    const prices = { ...(slot.prices ?? {}) }
    if (v === null) delete prices[name]
    else prices[name] = v
    setSlot(i, { ...slot, prices })
  }
  const placeholder = (name: string) => {
    const g = globalPrice(name)
    return g === null ? 'precio por unidad' : `global: ${formatGp(g)}`
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-accent/50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {info && <ItemIcon item={info} size={40} />}
        <Field label="Nombre">
          <Input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} className="w-60" />
        </Field>
        {info ? (
          <span className="text-xs text-muted">
            {info.slots} slot{info.slots > 1 ? 's' : ''} · {info.type}
            {info.vocations && ` · ${info.vocations}`} · acepta: {allowedImbuements(info, slotTypes).join(', ') || '—'}
          </span>
        ) : (
          <span className="text-xs text-warn">Item sin datos de slots (creado antes): puedes elegir 1 a 3 slots.</span>
        )}
      </div>
      {info && <Toggle checked={showAll} onChange={setShowAll} label="Mostrar todos los imbuements (excepciones que el wiki solo menciona en notas, p. ej. Falcon Coif con Epiphany)" />}

      {draft.slots.map((slot, i) => {
        const usedElsewhere = new Set(draft.slots.filter((x, j) => x && j !== i).map((x) => x!.imbuement))
        const options = allowed.filter((n) => !usedElsewhere.has(n) || n === slot?.imbuement)
        const cost = slot ? costOf(slot.imbuement, slot.tier, slot) : null
        const def = slot ? catalog.imbuements.find((d) => d.name === slot.imbuement) : null
        const tierDef = slot ? catalog.tiers.find((t) => t.tier === slot.tier) : null
        return (
          <div key={i} className="rounded-lg border border-line p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-14 text-xs text-muted">Slot {i + 1}</span>
              <Select
                value={slot?.imbuement ?? ''}
                onChange={(e) => setSlot(i, e.target.value ? { imbuement: e.target.value, tier: slot?.tier ?? 'Powerful' } : null)}
                options={[{ value: '', label: 'Vacío' }, ...options.map((n) => ({ value: n, label: `${n} — ${catalog.imbuements.find((d) => d.name === n)?.effect ?? ''}` }))]}
              />
              {slot && <Select value={slot.tier} onChange={(e) => setSlot(i, { ...slot, tier: e.target.value as ImbuementTier })} options={TIERS.map((t) => ({ value: t, label: t }))} />}
              {slot && cost && (
                <span className="text-sm">
                  {cost.best ? (
                    <>
                      <Gp value={cost.best.total} /> gp · {formatGp(Math.round(cost.best.perHour!))} gp/h <span className="text-xs text-muted">({cost.best.label})</span>
                    </>
                  ) : (
                    <span className="text-warn">faltan precios</span>
                  )}
                </span>
              )}
              {slot && (
                <Button variant="ghost" onClick={() => setPricesOpen(pricesOpen === i ? null : i)}>
                  {pricesOpen === i ? 'Ocultar precios' : 'Precios de este slot'}
                </Button>
              )}
              {!info && draft.slots.length > 1 && (
                <Button variant="ghost" onClick={() => onChange({ ...draft, slots: draft.slots.filter((_, j) => j !== i) })} aria-label="Quitar slot">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
            {slot && pricesOpen === i && def && tierDef && (
              <div className="mt-2 grid gap-2 border-t border-line pt-2 md:grid-cols-2">
                {materialsForTier(def, tierDef).map((m) => (
                  <SlotPriceInput key={m.item} label={`${m.qty}× ${m.item}`} placeholder={placeholder(m.item)} value={slot.prices?.[m.item]} onChange={(v) => setPrice(i, slot, m.item, v)} />
                ))}
                {catalog.tokenTradeable.includes(def.name) && <SlotPriceInput label={GOLD_TOKEN} placeholder={placeholder(GOLD_TOKEN)} value={slot.prices?.[GOLD_TOKEN]} onChange={(v) => setPrice(i, slot, GOLD_TOKEN, v)} />}
                <SlotPriceInput
                  label="O lo que pagaste en total (con santuario)"
                  placeholder="opcional"
                  value={slot.paidTotal}
                  onChange={(v) => setSlot(i, { ...slot, paidTotal: v })}
                  hint="Si lo llenas, manda sobre los precios de arriba."
                />
                <p className="self-end text-xs text-muted">Vacío = usa el precio global (manual o del Market). Estos precios solo afectan a este slot.</p>
              </div>
            )}
          </div>
        )
      })}
      {!info && draft.slots.length < 3 && (
        <Button variant="ghost" onClick={() => onChange({ ...draft, slots: [...draft.slots, null] })}>
          <Plus className="size-4" /> Slot
        </Button>
      )}
      {dupes.length > 0 && <p className="text-xs text-bad">Un item no puede llevar dos veces el mismo imbuement: {dupes.join(', ')}.</p>}
      <div className="flex gap-2">
        <Button variant="primary" disabled={!draft.name.trim() || draft.slots.every((x) => !x) || dupes.length > 0} onClick={onSave}>
          Guardar item
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
