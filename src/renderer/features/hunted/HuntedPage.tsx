import { useEffect, useState } from 'react'
import { AlertTriangle, LogIn, LogOut, Plus, RefreshCw, Trash2, TrendingUp, Users } from 'lucide-react'
import type { WatchList } from '@shared/api'
import { useApi, useApiMutation } from '../../lib/api'
import { formatAge, formatDateTime, parseIntOrNull } from '../../lib/format'
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Field, Input, Page, Select, Stat, Tabs, Toggle } from '../../components/ui'

// Hunted list y otras listas de vigilancia. La lista de conectados de Tibia se publica cada ~1 minuto
// (TibiaData la guarda 60 s): cada lectura nueva se empuja al instante a esta pantalla y a Windows.

const EVENT_ICON = { login: LogIn, logout: LogOut, level: TrendingUp, burst: AlertTriangle } as const

export function HuntedPage() {
  const status = useApi('watch.status', undefined, { refetchInterval: 15_000 })
  const lists = useApi('watch.lists', undefined)
  const online = useApi('watch.online', undefined)
  const events = useApi('watch.events', { limit: 150 })
  const settings = useApi('app.settings.get', undefined)
  const saveSettings = useApiMutation('app.settings.set', ['app.settings.get', 'watch.status'])
  const scan = useApiMutation('watch.scanNow', ['watch.status', 'watch.lists', 'watch.entries', 'watch.online', 'watch.events'])
  const [listId, setListId] = useState<number | null>(null)
  useEffect(() => {
    if (listId === null && lists.data?.[0]) setListId(lists.data[0].id)
  }, [lists.data, listId])
  const list = lists.data?.find((l) => l.id === listId) ?? null
  const st = status.data
  const w = settings.data?.watch

  return (
    <Page
      title="Hunted"
      subtitle="Avisos cuando alguien de tus listas se conecta, y cuando se conectan varios de golpe."
      actions={
        <Button onClick={() => scan.mutate(undefined)} busy={scan.isPending}>
          <RefreshCw className="size-4" /> Leer ahora
        </Button>
      }
    >
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Vigilados" value={st?.watched ?? 0} hint={st?.worlds.length ? `${st.worlds.length} mundo(s): ${st.worlds.join(', ')}` : 'sin mundos'} />
        <Stat label="Conectados ahora" value={online.data?.length ?? 0} tone={online.data?.length ? 'bad' : undefined} />
        <Stat label="Última lectura" value={st?.lastScanAt ? formatAge(st.lastScanAt) : '—'} hint={st?.sourceTimestamp ? `lista de Tibia de las ${new Date(st.sourceTimestamp).toLocaleTimeString('es')}` : undefined} />
        <Stat label="Estado" value={st?.running ? 'Vigilando' : 'Detenido'} hint={`cada ${st?.intervalSec ?? 60} s · precisión ≈ 1 min`} />
      </div>
      <ErrorBox error={scan.error ?? (st?.error ? new Error(st.error) : null)} />
      {w && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Toggle checked={w.enabled} onChange={(v) => saveSettings.mutate({ watch: { ...w, enabled: v } })} label="Vigilancia activa" />
          <Toggle checked={w.sound} onChange={(v) => saveSettings.mutate({ watch: { ...w, sound: v } })} label="Sonido en las notificaciones" />
          <span className="text-xs text-muted">
            Tibia publica la lista de conectados cada ~1 minuto: una conexión se ve en la lectura siguiente. Leer más seguido no la adelanta.
          </span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card
          title="Listas"
          actions={
            <Button variant="ghost" onClick={() => setListId(-1)}>
              <Plus className="size-4" /> Nueva lista
            </Button>
          }
        >
          {lists.data && (
            <Tabs
              value={String(listId ?? '')}
              onChange={(v) => setListId(Number(v))}
              tabs={[...lists.data.map((l) => ({ id: String(l.id), label: `${l.name} (${l.online}/${l.entries})` })), ...(listId === -1 ? [{ id: '-1', label: 'Nueva' }] : [])]}
            />
          )}
          <div className="mt-3">{listId === -1 ? <ListSettings list={null} onSaved={(l) => setListId(l.id)} /> : list ? <ListView list={list} onDeleted={() => setListId(null)} /> : <Empty>Sin listas.</Empty>}</div>
        </Card>

        <Card title={`Conectados ahora (${online.data?.length ?? 0})`}>
          {online.data?.length ? (
            <ul className="flex flex-col gap-1.5">
              {online.data.map((o) => (
                <li key={o.name} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-sm">
                  <span>
                    <span className="mr-2 inline-block size-2 rounded-full bg-good" aria-hidden />
                    <strong>{o.name}</strong> <span className="text-xs text-muted">{o.level} {o.vocation} · {o.world}</span>
                    {o.via && <span className="text-xs text-muted"> · guild {o.via}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {o.lists.map((l) => (
                      <Badge key={l} tone="bad">
                        {l}
                      </Badge>
                    ))}
                    <span className="text-xs text-muted" title={o.lastLoginAt ? formatDateTime(o.lastLoginAt) : undefined}>
                      {o.lastLoginAt ? formatAge(o.lastLoginAt) : 'ya estaba'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nadie de tus listas está conectado.</Empty>
          )}
        </Card>
      </div>

      <Card title="Eventos">
        <DataTable
          rows={events.data ?? []}
          rowKey={(e) => e.id}
          pageSize={25}
          empty="Sin eventos todavía. Las conexiones aparecen desde la segunda lectura (la primera solo registra quién ya estaba)."
          columns={[
            { key: 't', header: 'Detectado', cell: (e) => formatDateTime(e.detectedAt), sort: (e) => e.detectedAt },
            {
              key: 'k',
              header: '',
              cell: (e) => {
                const Icon = EVENT_ICON[e.kind]
                return <Icon className={`size-4 ${e.kind === 'burst' ? 'text-bad' : e.kind === 'login' ? 'text-warn' : 'text-muted'}`} aria-label={e.kind} />
              },
            },
            { key: 'l', header: 'Lista', cell: (e) => e.listName ?? '—' },
            { key: 'm', header: 'Evento', cell: (e) => (e.kind === 'burst' ? <strong className="text-bad">{e.message}</strong> : e.message) },
          ]}
        />
      </Card>
    </Page>
  )
}

function ListSettings({ list, onSaved }: { list: WatchList | null; onSaved: (l: WatchList) => void }) {
  const save = useApiMutation('watch.lists.save', ['watch.lists'])
  const [name, setName] = useState(list?.name ?? '')
  const [notify, setNotify] = useState(list?.notifyLogin ?? true)
  const [burst, setBurst] = useState<string>(list?.burstThreshold != null ? String(list.burstThreshold) : list ? '' : '5')
  const [windowSec, setWindowSec] = useState(String(list?.burstWindowSec ?? 60))
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-3">
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hunted, Amigos…" className="w-40" />
      </Field>
      <Toggle checked={notify} onChange={setNotify} label="Avisar cada conexión" />
      <Field label="Avisar si se conectan al menos" hint="Vacío = sin aviso de ráfaga">
        <Input inputMode="numeric" className="w-20" value={burst} onChange={(e) => setBurst(e.target.value)} />
      </Field>
      <Field label="…en (segundos)">
        <Input inputMode="numeric" className="w-20" value={windowSec} onChange={(e) => setWindowSec(e.target.value)} />
      </Field>
      <Button
        variant="primary"
        disabled={!name.trim()}
        busy={save.isPending}
        onClick={() =>
          save.mutate(
            { id: list?.id ?? null, name, notifyLogin: notify, burstThreshold: parseIntOrNull(burst), burstWindowSec: Math.max(30, parseIntOrNull(windowSec) ?? 60) },
            { onSuccess: onSaved },
          )
        }
      >
        Guardar lista
      </Button>
      <ErrorBox error={save.error} />
    </div>
  )
}

function ListView({ list, onDeleted }: { list: WatchList; onDeleted: () => void }) {
  const entries = useApi('watch.entries', { listId: list.id })
  const add = useApiMutation('watch.entries.add', ['watch.entries', 'watch.lists', 'watch.status', 'watch.online'])
  const remove = useApiMutation('watch.entries.remove', ['watch.entries', 'watch.lists', 'watch.status', 'watch.online'])
  const delList = useApiMutation('watch.lists.delete', ['watch.lists'])
  const [kind, setKind] = useState<'character' | 'guild'>('character')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const submit = () => add.mutate({ listId: list.id, kind, name: name.trim(), note: note.trim() || null }, { onSuccess: () => (setName(''), setNote('')) })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {list.notifyLogin ? <Badge tone="warn">avisa cada conexión</Badge> : <Badge>sin aviso por conexión</Badge>}
        {list.burstThreshold ? <Badge tone="bad">ráfaga: ≥ {list.burstThreshold} en {list.burstWindowSec} s</Badge> : <Badge>sin aviso de ráfaga</Badge>}
        <Button variant="ghost" onClick={() => setEditing(!editing)}>
          Configurar
        </Button>
        <Button variant="ghost" onClick={() => delList.mutate({ id: list.id }, { onSuccess: onDeleted })}>
          <Trash2 className="size-4" /> Borrar lista
        </Button>
      </div>
      {editing && <ListSettings list={list} onSaved={() => setEditing(false)} />}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Agregar">
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'character' | 'guild')} options={[{ value: 'character', label: 'Personaje' }, { value: 'guild', label: 'Guild completa' }]} />
        </Field>
        <Field label="Nombre exacto">
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} className="w-52" />
        </Field>
        <Field label="Nota (opcional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-52" placeholder="p. ej. PK de Edron" />
        </Field>
        <Button variant="primary" disabled={name.trim().length < 2} busy={add.isPending} onClick={submit}>
          <Plus className="size-4" /> Agregar
        </Button>
      </div>
      <ErrorBox error={add.error} />
      <DataTable
        rows={entries.data ?? []}
        rowKey={(e) => e.id}
        empty="Lista vacía. Agrega personajes o guilds (se validan contra TibiaData)."
        columns={[
          {
            key: 'n',
            header: 'Nombre',
            cell: (e) => (
              <span className="flex items-center gap-2">
                {e.kind === 'guild' ? <Users className="size-4 text-muted" aria-label="guild" /> : <span className={`inline-block size-2 rounded-full ${e.online ? 'bg-good' : 'bg-line'}`} aria-label={e.online ? 'conectado' : 'desconectado'} />}
                {e.name}
                {e.note && <span className="text-xs text-muted">· {e.note}</span>}
              </span>
            ),
            sort: (e) => e.name,
          },
          { key: 'w', header: 'Mundo', cell: (e) => e.world ?? '—', sort: (e) => e.world },
          {
            key: 's',
            header: 'Estado',
            cell: (e) =>
              e.kind === 'guild' ? (
                <span>
                  {e.online}/{e.members} conectados
                </span>
              ) : e.online ? (
                <Badge tone="good">conectado</Badge>
              ) : (
                <Badge>desconectado</Badge>
              ),
            sort: (e) => e.online,
          },
          { key: 'l', header: 'Nivel', cell: (e) => (e.kind === 'character' ? (e.level ? `${e.level} ${e.vocation ?? ''}` : '—') : '—'), align: 'right' },
          { key: 'seen', header: 'Visto', cell: (e) => (e.lastSeenAt ? formatAge(e.lastSeenAt) : '—'), sort: (e) => e.lastSeenAt },
          { key: 'x', header: '', cell: (e) => <Button variant="ghost" onClick={() => remove.mutate({ id: e.id })} aria-label={`Quitar ${e.name}`}><Trash2 className="size-4" /></Button> },
        ]}
      />
    </div>
  )
}
