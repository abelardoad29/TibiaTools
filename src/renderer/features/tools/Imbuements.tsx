import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { ImbuementCatalog, ItemSummary } from '@shared/api'
import type { ImbuedItemBuild, Settings } from '@shared/settings'
import type { DataSource } from '@shared/provenance'
import { huntCost, imbuedItemCost, imbuementCost, TIERS, type ImbuementCost, type ImbuementTier } from '@core/domain/tools/imbuements'
import { platform } from '../../platform'
import { useApi, useApiMutation } from '../../lib/api'
import { formatGp, parseIntOrNull } from '../../lib/format'
import { Freshness, Gp, ItemIcon, ItemPicker, ProvenanceBadge, WorldPicker } from '../../components/data'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Select, Stat } from '../../components/ui'

const GOLD_TOKEN = 'Gold Token'
const scrollName = (imb: string, tier: ImbuementTier) => `${tier.toLowerCase()} ${imb.toLowerCase()} scroll`

type PriceMap = Record<string, { price: number; observedAt: string; source: DataSource } | null>

/** Calcula el costo de un imbuement con precios del Market, overrides manuales y tokens. */
function useCostFn(catalog: ImbuementCatalog | undefined, settings: Settings | undefined, prices: PriceMap | undefined) {
  return (imbName: string, tierName: ImbuementTier): ImbuementCost | null => {
    const def = catalog?.imbuements.find((i) => i.name === imbName)
    const tier = catalog?.tiers.find((t) => t.tier === tierName)
    if (!catalog || !def || !tier || !settings) return null
    const manual = settings.imbuements.manualPrices
    const priceOf = (n: string) => manual[n] ?? prices?.[n]?.price ?? null
    const override = settings.imbuements.tokensPerTier
    return imbuementCost(def, tier, catalog.tiers, {
      prices: Object.fromEntries(def.materials.map((m) => [m.item, priceOf(m.item)])),
      goldTokenPrice: priceOf(GOLD_TOKEN),
      tokensPerTier: { Basic: override.Basic ?? catalog.tokensPerTier.Basic, Intricate: override.Intricate ?? catalog.tokensPerTier.Intricate, Powerful: override.Powerful ?? catalog.tokensPerTier.Powerful },
      tokenTradeable: catalog.tokenTradeable.includes(def.name),
      scrollPrice: manual[scrollName(def.name, tierName)] ?? prices?.[scrollName(def.name, tierName)]?.price ?? null,
    })
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
      <Builds catalog={catalog} settings={s} costOf={costOf} />
    </div>
  )
}

function newBuild(): ImbuedItemBuild {
  return { id: `${Date.now()}`, name: '', itemId: null, slots: [{ imbuement: 'Vampirism', tier: 'Powerful' }, null] }
}

/** "Crear un item": varios slots imbuidos y el costo por hora / por hunt del set. */
function Builds({ catalog, settings, costOf }: { catalog: ImbuementCatalog; settings: Settings; costOf: (imb: string, tier: ImbuementTier) => ImbuementCost | null }) {
  const save = useApiMutation('app.settings.set', ['app.settings.get'])
  const [draft, setDraft] = useState<ImbuedItemBuild | null>(null)
  const [draftItem, setDraftItem] = useState<ItemSummary | null>(null)
  const builds = settings.imbuements.builds
  const persist = (next: ImbuedItemBuild[]) => save.mutate({ imbuements: { ...settings.imbuements, builds: next } })
  const costs = builds.map((b) => ({ build: b, cost: imbuedItemCost(b.slots.map((s) => (s ? costOf(s.imbuement, s.tier) : null))) }))
  const hunt = huntCost(costs.map((c) => c.cost), settings.imbuements.huntHours)

  const slotEditor = (b: ImbuedItemBuild, onChange: (b: ImbuedItemBuild) => void) => (
    <div className="flex flex-col gap-2">
      {b.slots.map((slot, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="w-14 text-xs text-muted">Slot {i + 1}</span>
          <Select
            value={slot?.imbuement ?? ''}
            onChange={(e) => onChange({ ...b, slots: b.slots.map((x, j) => (j === i ? (e.target.value ? { imbuement: e.target.value, tier: x?.tier ?? 'Powerful' } : null) : x)) })}
            options={[{ value: '', label: 'Vacío' }, ...catalog.imbuements.map((m) => ({ value: m.name, label: m.name }))]}
          />
          {slot && (
            <Select value={slot.tier} onChange={(e) => onChange({ ...b, slots: b.slots.map((x, j) => (j === i ? { ...slot, tier: e.target.value as ImbuementTier } : x)) })} options={TIERS.map((t) => ({ value: t, label: t }))} />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {b.slots.length < 3 && (
          <Button variant="ghost" onClick={() => onChange({ ...b, slots: [...b.slots, null] })}>
            <Plus className="size-4" /> Slot
          </Button>
        )}
        {b.slots.length > 1 && (
          <Button variant="ghost" onClick={() => onChange({ ...b, slots: b.slots.slice(0, -1) })}>
            Quitar slot
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <Card
      title="Mis items imbuidos"
      actions={
        <Button onClick={() => (setDraft(newBuild()), setDraftItem(null))}>
          <Plus className="size-4" /> Crear item
        </Button>
      }
    >
      <p className="mb-3 text-xs text-muted">Arma tu equipo con sus imbuements y mira cuánto cuesta mantenerlo por hora de uso y por hunt. Cada slot usa la opción más barata disponible.</p>
      {draft && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-accent/50 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Item del catálogo (opcional)">
              <ItemPicker
                value={draftItem}
                onChange={(i) => {
                  setDraftItem(i)
                  setDraft({ ...draft, itemId: i?.id ?? null, name: draft.name || i?.name || '' })
                }}
              />
            </Field>
            <Field label="Nombre">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="p. ej. Casco de hunt" />
            </Field>
          </div>
          {slotEditor(draft, setDraft)}
          <div className="flex gap-2">
            <Button variant="primary" disabled={!draft.name.trim() || draft.slots.every((x) => !x)} onClick={() => (persist([...builds, draft]), setDraft(null))}>
              Guardar item
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {builds.length === 0 && !draft ? (
        <Empty>Crea un item (p. ej. un casco con Vampirism y Void) para ver su costo por hora y por hunt.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {costs.map(({ build, cost }) => (
            <div key={build.id} className="rounded-lg border border-line bg-panel-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                {build.itemId && platform.kind === 'electron' && <ItemIcon item={{ name: build.name, iconUrl: `tt-img://item/${build.itemId}` }} />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{build.name}</div>
                  <div className="flex flex-wrap gap-1 text-xs text-muted">
                    {build.slots.map((sl, i) => {
                      const sc = cost.slots[i]
                      return sl ? (
                        <Badge key={i} tone={sc?.best ? 'neutral' : 'warn'} title={sc?.best ? sc.best.label : 'Faltan precios'}>
                          {sl.tier} {sl.imbuement}: {sc?.best ? `${formatGp(sc.best.total!)} gp` : 'sin precio'}
                        </Badge>
                      ) : (
                        <Badge key={i}>vacío</Badge>
                      )
                    })}
                  </div>
                </div>
                <Stat label="Por ciclo (20 h)" value={<Gp value={cost.perCycle} short />} />
                <Stat label="Por hora" value={cost.perHour === null ? '—' : `${formatGp(Math.round(cost.perHour))}`} />
                <Button variant="ghost" onClick={() => persist(builds.filter((b) => b.id !== build.id))} aria-label={`Borrar ${build.name}`}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {cost.missing.length > 0 && <p className="mt-1 text-xs text-warn">Sin precio completo: {cost.missing.join(', ')}</p>}
            </div>
          ))}
          <div className="mt-2 flex flex-wrap items-end gap-3 border-t border-line pt-3">
            <Field label="Horas por hunt">
              <Input inputMode="decimal" className="w-24" value={settings.imbuements.huntHours} onChange={(e) => save.mutate({ imbuements: { ...settings.imbuements, huntHours: Math.max(0.25, Number(e.target.value.replace(',', '.')) || 1) } })} />
            </Field>
            <Stat label="Set completo por hora" value={hunt.perHour === null ? '—' : `${formatGp(Math.round(hunt.perHour))} gp`} />
            <Stat label={`Costo por hunt de ${settings.imbuements.huntHours} h`} value={<Gp value={hunt.perHunt} />} hint="solo el tiempo con el equipo puesto" />
          </div>
        </div>
      )}
      <ErrorBox error={save.error} />
    </Card>
  )
}
