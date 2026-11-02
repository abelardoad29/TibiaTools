import { useMemo, useState } from 'react'
import { Copy, Trash2, UserPlus } from 'lucide-react'
import type { ImbuementTier } from '@core/domain/tools/imbuements'
import { imbuementCost } from '@core/domain/tools/imbuements'
import { shareRange } from '@core/domain/tools/share-exp'
import { parsePartySession, splitLoot, type SplitResult } from '@core/domain/tools/split-loot'
import { platform } from '../../platform'
import { call, useApi, useApiMutation } from '../../lib/api'
import { formatDateTime, parseIntOrNull } from '../../lib/format'
import { Freshness, Gp, ItemIcon, ProvenanceBadge, WorldPicker } from '../../components/data'
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Page, Select, Tabs } from '../../components/ui'

type Tab = 'share' | 'loot' | 'imbuements' | 'characters'

export function ToolsPage() {
  const [tab, setTab] = useState<Tab>('share')
  return (
    <Page title="Herramientas" subtitle="Las herramientas de Tibia Tools v1, corregidas.">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'share', label: 'Share Exp' },
          { id: 'loot', label: 'Split Loot' },
          { id: 'imbuements', label: 'Imbuements' },
          { id: 'characters', label: 'Personajes' },
        ]}
      />
      {tab === 'share' && <ShareExp />}
      {tab === 'loot' && <SplitLoot />}
      {tab === 'imbuements' && <Imbuements />}
      {tab === 'characters' && <Characters />}
    </Page>
  )
}

function ShareExp() {
  const [name, setName] = useState('')
  const [level, setLevel] = useState('')
  const [result, setResult] = useState<{ who: string; level: number; min: number; max: number } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const calc = async () => {
    setError(null)
    setResult(null)
    try {
      if (name.trim()) {
        setBusy(true)
        const ch = await call('tools.character', { name: name.trim() })
        if (!ch) throw new Error(`Personaje "${name}" no encontrado`)
        setResult({ who: `${ch.name} (${ch.vocation}, ${ch.world})`, ...shareRange(ch.level) })
      } else {
        const l = parseIntOrNull(level)
        if (l === null) throw new Error('Ingresa un nombre o un nivel válido')
        setResult({ who: `Nivel ${l}`, ...shareRange(l) })
      }
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Rango de experiencia compartida">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Nombre del personaje (TibiaData)">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" onKeyDown={(e) => e.key === 'Enter' && void calc()} />
        </Field>
        <Field label="…o nivel">
          <Input value={level} onChange={(e) => setLevel(e.target.value)} inputMode="numeric" className="w-28" onKeyDown={(e) => e.key === 'Enter' && void calc()} />
        </Field>
        <Button variant="primary" onClick={() => void calc()} busy={busy}>
          Calcular
        </Button>
      </div>
      <div className="mt-4">
        <ErrorBox error={error} />
        {result && (
          <p className="text-lg">
            <strong>{result.who}</strong> (nivel {result.level}) comparte experiencia con niveles <strong className="num text-accent">{result.min}</strong> a{' '}
            <strong className="num text-accent">{result.max}</strong>.
          </p>
        )}
        <p className="mt-2 text-xs text-muted">Regla: el nivel más alto no puede superar 3/2 del más bajo (mín = ⌈2L/3⌉, máx = ⌊3L/2⌋).</p>
      </div>
    </Card>
  )
}

function SplitLoot() {
  const [text, setText] = useState('')
  const [result, setResult] = useState<SplitResult | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (t: string) => {
    await navigator.clipboard.writeText(t)
    setCopied(t)
    setTimeout(() => setCopied(null), 1_500)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Texto del Party Hunt Analyzer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          placeholder="Pega aquí el texto copiado del analizador de party…"
          className="w-full rounded-lg border border-line bg-panel-2 p-2 font-mono text-xs outline-none focus:border-accent"
        />
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            onClick={() => {
              setError(null)
              try {
                setResult(splitLoot(parsePartySession(text)))
              } catch (e) {
                setResult(null)
                setError(e)
              }
            }}
          >
            Calcular
          </Button>
          <Button variant="ghost" onClick={() => (setText(''), setResult(null))}>
            Limpiar
          </Button>
        </div>
      </Card>
      <Card title="Reparto">
        <ErrorBox error={error} />
        {!result && !error && <Empty>Pega la sesión y pulsa Calcular.</Empty>}
        {result && (
          <div className="flex flex-col gap-3">
            <div className="text-sm">
              Balance total <Gp value={result.session.totalBalance} signed /> · {result.session.members.length} jugadores · cada uno <Gp value={result.sharePerMember} signed /> gp
              {result.remainder > 0 && <span className="text-muted"> (sobran {result.remainder} gp por redondeo)</span>}
            </div>
            <DataTable
              rows={result.session.members}
              rowKey={(m) => m.name}
              columns={[
                { key: 'n', header: 'Jugador', cell: (m) => `${m.name}${m.leader ? ' ★' : ''}` },
                { key: 'b', header: 'Balance', cell: (m) => <Gp value={m.balance} signed />, align: 'right' },
                { key: 'd', header: 'Diferencia', cell: (m) => <Gp value={m.balance - result.sharePerMember} signed />, align: 'right' },
              ]}
            />
            {result.transfers.length === 0 ? (
              <Empty>Nadie debe transferir.</Empty>
            ) : (
              <ul className="flex flex-col gap-1">
                {result.transfers.map((t) => (
                  <li key={t.command + t.from} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm">
                    <span>
                      <strong>{t.from}</strong> → {t.to}: <Gp value={t.amount} /> gp
                    </span>
                    <Button variant="ghost" onClick={() => void copy(t.command)} title={t.command}>
                      <Copy className="size-4" /> {copied === t.command ? 'Copiado' : 'Copiar'}
                    </Button>
                  </li>
                ))}
                <Button onClick={() => void copy(result.transfers.map((t) => t.command).join('\n'))}>Copiar todas</Button>
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function Imbuements() {
  const { data: catalog, error } = useApi('tools.imbuements', undefined)
  const settings = useApi('app.settings.get', undefined)
  const saveSettings = useApiMutation('app.settings.set', ['app.settings.get'])
  const [imbName, setImbName] = useState('Vampirism')
  const [tierName, setTierName] = useState<ImbuementTier>('Powerful')
  const world = settings.data?.imbuements.world ?? settings.data?.homeWorld ?? null
  const def = catalog?.imbuements.find((i) => i.name === imbName)
  const tier = catalog?.tiers.find((t) => t.tier === tierName)
  const names = useMemo(() => [...(def?.materials.map((m) => m.item) ?? []), 'Gold Token'], [def])
  const { data: icons = [] } = useApi('catalog.items.byName', { names })
  const prices = useApi('tools.imbuements.prices', { world: world ?? '', items: names }, { enabled: !!world && platform.kind === 'electron' })
  const manual = settings.data?.imbuements.manualPrices ?? {}
  const priceOf = (n: string) => manual[n] ?? prices.data?.[n]?.price ?? null

  if (error) return <ErrorBox error={error} />
  if (!catalog || !def || !tier || !settings.data) return null
  const s = settings.data
  const cost = imbuementCost(def, tier, Object.fromEntries(names.map((n) => [n, priceOf(n)])), {
    tokensForTier: s.imbuements.tokensPerTier[tierName],
    goldTokenPrice: priceOf('Gold Token'),
    tradeable: catalog.tokenTradeable.includes(def.name),
  })
  const setManual = (n: string, v: number | null) => {
    const next = { ...manual }
    if (v === null) delete next[n]
    else next[n] = v
    saveSettings.mutate({ imbuements: { ...s.imbuements, manualPrices: next } })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card title="Imbuement">
        <div className="flex flex-col gap-3">
          <Field label="Tipo">
            <Select value={imbName} onChange={(e) => setImbName(e.target.value)} options={catalog.imbuements.map((i) => ({ value: i.name, label: `${i.name} — ${i.effect}` }))} />
          </Field>
          <Field label="Nivel">
            <Select value={tierName} onChange={(e) => setTierName(e.target.value as ImbuementTier)} options={catalog.tiers.map((t) => ({ value: t.tier, label: `${t.tier} (santuario ${t.shrineFeeGp.toLocaleString('en-US')} gp)` }))} />
          </Field>
          {platform.kind === 'electron' && (
            <Field label="Precios del Market de" hint="Mejor sell offer conocida (comprar al instante). Puedes fijar precios manuales.">
              <WorldPicker value={world} allowEmpty label="Sin mundo (solo precios manuales)" onChange={(w) => saveSettings.mutate({ imbuements: { ...s.imbuements, world: w } })} />
            </Field>
          )}
          <Field label={`Gold Tokens para ${tierName}`} hint="Cantidad que pide Yana por tier (configúrala tú; no viene en el seed).">
            <Input
              inputMode="numeric"
              value={s.imbuements.tokensPerTier[tierName] ?? ''}
              onChange={(e) => saveSettings.mutate({ imbuements: { ...s.imbuements, tokensPerTier: { ...s.imbuements.tokensPerTier, [tierName]: parseIntOrNull(e.target.value) } } })}
            />
          </Field>
          <p className="text-xs text-muted">Fuente: {catalog.source}</p>
        </div>
      </Card>
      <Card title={`${def.name} ${tierName}`}>
        <div className="flex flex-col gap-2">
          {cost.lines.map((l) => {
            const icon = icons.find((i) => i.name.toLowerCase() === l.item.toLowerCase())
            const market = prices.data?.[l.item]
            return (
              <div key={l.item} className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2">
                <Badge tone="accent">{l.qty}×</Badge>
                {icon && <ItemIcon item={icon} />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{l.item}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {manual[l.item] !== undefined ? <ProvenanceBadge kind="manual" /> : market ? (
                      <>
                        <ProvenanceBadge kind={market.source === 'third_party' ? 'third_party' : 'own_capture'} /> <Freshness at={market.observedAt} />
                      </>
                    ) : (
                      'sin precio'
                    )}
                  </div>
                </div>
                <Input
                  className="w-28 text-right"
                  inputMode="numeric"
                  placeholder={market ? String(market.price) : 'precio'}
                  value={manual[l.item] ?? ''}
                  onChange={(e) => setManual(l.item, parseIntOrNull(e.target.value))}
                  aria-label={`Precio manual de ${l.item}`}
                />
                <div className="w-28 text-right">
                  <Gp value={l.subtotal} />
                </div>
              </div>
            )
          })}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <div className="text-sm text-muted">
              Materiales <Gp value={cost.materialsTotal} /> + santuario <Gp value={cost.shrineFee} />
            </div>
            <div className="text-lg font-semibold">
              Total <Gp value={cost.total} className="text-accent" /> gp
            </div>
          </div>
          {cost.missingPrices.length > 0 && <p className="text-xs text-warn">Faltan precios de: {cost.missingPrices.join(', ')}. El total no se calcula con ceros.</p>}
          {cost.tokenAlternative ? (
            <div className="rounded-lg border border-line px-3 py-2 text-sm">
              Con {cost.tokenAlternative.tokens} Gold Tokens a <Gp value={cost.tokenAlternative.tokenPrice} />: <Gp value={cost.tokenAlternative.total} /> gp →{' '}
              <strong className="text-accent">{cost.tokenAlternative.cheaper === 'tokens' ? 'conviene comprar tokens' : cost.tokenAlternative.cheaper === 'materials' ? 'conviene comprar materiales' : 'compara cuando tengas todos los precios'}</strong>
            </div>
          ) : (
            catalog.tokenTradeable.includes(def.name) && <p className="text-xs text-muted">Para comparar con Gold Tokens, configura cuántos pide este tier y el precio del Gold Token.</p>
          )}
        </div>
      </Card>
    </div>
  )
}

function Characters() {
  const desktop = platform.kind === 'electron'
  const list = useApi('characters.list', undefined, { enabled: desktop })
  const events = useApi('characters.events', { limit: 50 }, { enabled: desktop })
  const add = useApiMutation('characters.add', ['characters.list'])
  const remove = useApiMutation('characters.remove', ['characters.list'])
  const refresh = useApiMutation('characters.refresh', ['characters.list', 'characters.events'])
  const [name, setName] = useState('')
  if (!desktop) return <Empty>El seguimiento de personajes necesita la app de escritorio.</Empty>
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Personajes seguidos"
        actions={
          <Button onClick={() => refresh.mutate(undefined)} busy={refresh.isPending}>
            Consultar ahora
          </Button>
        }
      >
        <div className="mb-3 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre exacto" onKeyDown={(e) => e.key === 'Enter' && name.trim() && add.mutate({ name: name.trim() }, { onSuccess: () => setName('') })} />
          <Button variant="primary" onClick={() => add.mutate({ name: name.trim() }, { onSuccess: () => setName('') })} busy={add.isPending} disabled={!name.trim()}>
            <UserPlus className="size-4" /> Seguir
          </Button>
        </div>
        <ErrorBox error={add.error ?? refresh.error} />
        <DataTable
          rows={list.data ?? []}
          rowKey={(c) => c.id}
          empty="Agrega personajes para recibir avisos de level up y muertes (consulta TibiaData cada pocos minutos)."
          columns={[
            { key: 'n', header: 'Nombre', cell: (c) => c.name, sort: (c) => c.name },
            { key: 'w', header: 'Mundo', cell: (c) => c.world ?? '—' },
            { key: 'l', header: 'Nivel', cell: (c) => c.level ?? '—', align: 'right', sort: (c) => c.level },
            { key: 'v', header: 'Vocación', cell: (c) => c.vocation ?? '—' },
            { key: 'c', header: 'Consulta', cell: (c) => (c.lastError ? <span className="text-xs text-bad">{c.lastError}</span> : <Freshness at={c.lastCheckedAt} staleHours={1} />) },
            {
              key: 'x',
              header: '',
              cell: (c) => (
                <Button variant="ghost" onClick={() => remove.mutate({ id: c.id })} aria-label={`Dejar de seguir a ${c.name}`}>
                  <Trash2 className="size-4" />
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title="Eventos">
        <DataTable
          rows={events.data ?? []}
          rowKey={(e) => e.id}
          empty="Sin eventos todavía."
          columns={[
            { key: 'm', header: 'Evento', cell: (e) => e.message },
            { key: 't', header: 'Detectado', cell: (e) => formatDateTime(e.detectedAt), sort: (e) => e.detectedAt },
          ]}
        />
      </Card>
    </div>
  )
}
