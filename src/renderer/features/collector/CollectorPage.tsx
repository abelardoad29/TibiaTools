import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, Crop, Eye, FolderInput, Pause, Play, Square, X } from 'lucide-react'
import type { ItemSummary, Screenshot } from '@shared/api'
import { downsample, meanAbsDiff, toGray, type Gray } from '@core/ocr/image'
import type { Rect, ScreenType } from '@core/ocr/types'
import { call, useApi, useApiMutation, useEvent } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import { ItemPicker, WorldPicker } from '../../components/data'
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Page, Select, Toggle } from '../../components/ui'

// Collector: el usuario elige la ventana/pantalla, la región y cuándo capturar.
// Nunca se envía input al cliente de Tibia: solo se leen frames de la captura de pantalla.

interface Pending {
  id: number
  png: Uint8Array
  url: string
  at: string
}

function grabFrame(video: HTMLVideoElement, region: Rect | null): HTMLCanvasElement {
  const r = region ?? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }
  const c = document.createElement('canvas')
  c.width = r.w
  c.height = r.h
  c.getContext('2d')!.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return c
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo codificar PNG'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

// Juegos con aceleración por GPU (como Tibia) pueden capturarse en negro al elegir su ventana.
const BLACK_FRAME_MSG =
  'La captura salió en negro: Windows no entrega la imagen de la ventana de Tibia (aceleración por GPU). Usa la carpeta de screenshots de Tibia (arriba) o elige «Pantalla» como fuente y marca la región del Market.'

function isBlackFrame(canvas: HTMLCanvasElement): boolean {
  const sig = signature(canvas)
  let max = 0
  for (const v of sig.data) if (v > max) max = v
  return max < 12
}

function signature(canvas: HTMLCanvasElement): Gray {
  const ctx = canvas.getContext('2d')!
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return downsample(toGray({ width: img.width, height: img.height, data: img.data }), 160)
}

export function CollectorPage() {
  const qc = useQueryClient()
  const settings = useApi('app.settings.get', undefined)
  const sources = useApi('collector.sources', undefined, { enabled: false })
  const inbox = useApi('collector.screenshots.list', { status: 'new', limit: 30 })
  const importer = useApiMutation('collector.import', ['collector.screenshots.list'])
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [region, setRegion] = useState<Rect | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [screenType, setScreenType] = useState<ScreenType>('offers')
  const [world, setWorld] = useState<string | null>(null)
  const [item, setItem] = useState<ItemSummary | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [last, setLast] = useState<Screenshot | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const worlds = useApi('catalog.worlds.list', { activeOnly: false })
  const worldId = worlds.data?.find((w) => w.name === world)?.id ?? null

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [stream])

  const start = async (id: string) => {
    setError(null)
    try {
      await call('collector.selectSource', { id })
      stream?.getTracks().forEach((t) => t.stop())
      // main responde a getDisplayMedia con la fuente elegida (sin diálogo extra).
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
      setSourceId(id)
      setStream(s)
      setRegion(null)
    } catch (e) {
      setError(e)
    }
  }

  const save = useCallback(
    async (png: Uint8Array, mode: 'manual' | 'assisted') => {
      const shot = await call('collector.save', { png, region, mode, screenType, worldId, itemId: item?.id ?? null })
      setLast(shot)
      // Refresca todas las listas de capturas (bandeja y Revisión OCR).
      void qc.invalidateQueries({ queryKey: ['collector.screenshots.list'] })
      return shot
    },
    [region, screenType, worldId, item, qc],
  )

  const capture = useCallback(async () => {
    const v = videoRef.current
    if (!v || !stream || v.videoWidth === 0) return setError(new Error('Primero elige una ventana o pantalla'))
    setError(null)
    try {
      const frame = grabFrame(v, region)
      if (isBlackFrame(frame)) return setError(new Error(BLACK_FRAME_MSG))
      await save(await toPng(frame), 'manual')
    } catch (e) {
      setError(e)
    }
  }, [stream, region, save])

  useEvent('hotkey.capture', useCallback(() => void capture(), [capture]))

  return (
    <Page
      title="Collector"
      subtitle="Importa los screenshots del cliente o captura la pantalla. La app solo lee imágenes: no hace clics ni envía teclas."
      actions={
        <>
          <Button onClick={() => importer.mutate(undefined)} busy={importer.isPending}>
            <FolderInput className="size-4" /> Importar PNG/JPG/BMP
          </Button>
          <Button variant="primary" onClick={() => void capture()} disabled={!stream}>
            <Camera className="size-4" /> Capturar {settings.data?.collector.hotkey && <span className="text-xs opacity-75">({settings.data.collector.hotkey})</span>}
          </Button>
        </>
      }
    >
      <TibiaFolderCard />
      <ErrorBox error={error ?? importer.error} />
      {importer.data && (
        <p className="text-sm text-muted">
          Importadas {importer.data.imported.length}. {importer.data.errors.length > 0 && <span className="text-warn">Errores: {importer.data.errors.join('; ')}</span>}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[3fr_1fr]">
        <Card
          title="Vista en vivo"
          actions={
            <>
              <Button onClick={() => void sources.refetch()} busy={sources.isFetching}>
                Elegir fuente
              </Button>
              <Button onClick={() => setSelecting(true)} disabled={!stream}>
                <Crop className="size-4" /> Región
              </Button>
              {region && (
                <Button variant="ghost" onClick={() => setRegion(null)}>
                  <X className="size-4" /> Quitar región
                </Button>
              )}
              {stream && (
                <Button variant="ghost" onClick={() => (stream.getTracks().forEach((t) => t.stop()), setStream(null), setSourceId(null))}>
                  <Square className="size-4" /> Detener
                </Button>
              )}
            </>
          }
        >
          {sources.data && !stream && (
            <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
              {sources.data.map((s) => (
                <button key={s.id} onClick={() => void start(s.id)} className="flex flex-col gap-1 rounded-lg border border-line bg-panel-2 p-2 text-left hover:border-accent">
                  <img src={s.thumbnail} alt="" className="aspect-video w-full rounded object-contain" />
                  <span className="truncate text-xs">
                    <Badge>{s.kind === 'screen' ? 'Pantalla' : 'Ventana'}</Badge> {s.name}
                  </span>
                </button>
              ))}
            </div>
          )}
          {stream ? (
            <RegionVideo videoRef={videoRef} region={region} selecting={selecting} onRegion={(r) => (setRegion(r), setSelecting(false))} />
          ) : (
            !sources.data && <Empty>Para Tibia usa la carpeta de screenshots (arriba): capturar su ventana suele salir en negro. Aquí puedes elegir «Pantalla» y marcar la región del Market.</Empty>
          )}
          {region && (
            <p className="mt-2 text-xs text-muted">
              Región: {region.w}×{region.h} en ({region.x}, {region.y}). Las capturas guardan solo esta región; usa la misma región con su perfil OCR.
            </p>
          )}
          {sourceId && <p className="mt-1 text-xs text-muted">Fuente: {sources.data?.find((s) => s.id === sourceId)?.name}</p>}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title="Datos de la captura">
            <div className="flex flex-col gap-3">
              <Field label="Pantalla">
                <Select
                  value={screenType}
                  onChange={(e) => setScreenType(e.target.value as ScreenType)}
                  options={[
                    { value: 'offers', label: 'Ofertas (buy/sell)' },
                    { value: 'details', label: 'Details (estadísticas 30 días)' },
                  ]}
                />
              </Field>
              <Field label="Mundo">
                <WorldPicker value={world} onChange={setWorld} allowEmpty />
              </Field>
              <Field label="Item">
                <ItemPicker value={item} onChange={setItem} />
              </Field>
              <p className="text-xs text-muted">Se pueden completar después en Revisión OCR.</p>
            </div>
          </Card>
          <Assisted videoRef={videoRef} region={region} enabled={!!stream} onSave={(png) => save(png, 'assisted')} />
          {last && (
            <Card title="Última captura">
              <img src={last.url} alt="Última captura" className="max-h-40 w-full rounded object-contain" />
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                {formatDateTime(last.capturedAtUtc)} · {last.width}×{last.height}
                <Link className="text-accent" to={`/ocr?shot=${last.id}`}>
                  Revisar →
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card title={`Bandeja de entrada (${inbox.data?.length ?? 0} sin revisar)`}>
        {inbox.data?.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {inbox.data.map((s) => (
              <Link key={s.id} to={`/ocr?shot=${s.id}`} className="flex flex-col gap-1 rounded-lg border border-line bg-panel-2 p-2 hover:border-accent">
                <img src={s.url} alt="" className="h-24 w-full rounded object-contain" loading="lazy" />
                <span className="text-xs text-muted">
                  {formatDateTime(s.capturedAtUtc)} · {s.sourceMode} · {s.screenType ?? 'sin tipo'}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>No hay capturas pendientes de revisión.</Empty>
        )}
      </Card>
    </Page>
  )
}

function RegionVideo({ videoRef, region, selecting, onRegion }: { videoRef: React.RefObject<HTMLVideoElement | null>; region: Rect | null; selecting: boolean; onRegion: (r: Rect) => void }) {
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const scale = () => {
    const v = videoRef.current!
    return v.videoWidth / v.clientWidth
  }
  const pos = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }
  const shown = drag
    ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    : region && videoRef.current
      ? { x: region.x / scale(), y: region.y / scale(), w: region.w / scale(), h: region.h / scale() }
      : null
  return (
    <div
      className={`relative ${selecting ? 'cursor-crosshair' : ''}`}
      onMouseDown={(e) => {
        if (!selecting) return
        const p = pos(e)
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      }}
      onMouseMove={(e) => drag && setDrag({ ...drag, x1: pos(e).x, y1: pos(e).y })}
      onMouseUp={() => {
        if (!drag) return
        const s = scale()
        const r = { x: Math.round(Math.min(drag.x0, drag.x1) * s), y: Math.round(Math.min(drag.y0, drag.y1) * s), w: Math.round(Math.abs(drag.x1 - drag.x0) * s), h: Math.round(Math.abs(drag.y1 - drag.y0) * s) }
        setDrag(null)
        if (r.w > 10 && r.h > 10) onRegion(r)
      }}
    >
      <video ref={videoRef} autoPlay muted className="w-full rounded-lg bg-black" />
      {shown && <div className="pointer-events-none absolute border-2 border-accent bg-accent/10" style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }} />}
      {selecting && !drag && <div className="pointer-events-none absolute inset-x-0 top-2 text-center text-sm text-accent">Arrastra para marcar la región del Market</div>}
    </div>
  )
}

/** Captura asistida: observa solo la región, detecta cambios y propone capturas tras un debounce. */
function Assisted({ videoRef, region, enabled, onSave }: { videoRef: React.RefObject<HTMLVideoElement | null>; region: Rect | null; enabled: boolean; onSave: (png: Uint8Array) => Promise<unknown> }) {
  const { data: settings } = useApi('app.settings.get', undefined)
  const saveSettings = useApiMutation('app.settings.set', ['app.settings.get'])
  const [state, setState] = useState<'off' | 'running' | 'paused'>('off')
  const [pending, setPending] = useState<Pending[]>([])
  const [status, setStatus] = useState('')
  const [saved, setSaved] = useState(0)
  const cfg = settings?.collector

  useEffect(() => {
    if (state !== 'running' || !enabled || !cfg) return
    let prev: Gray | null = null
    let lastSaved: Gray | null = null
    let changedAt: number | null = null
    let busy = false
    const timer = setInterval(async () => {
      const v = videoRef.current
      if (!v || v.videoWidth === 0 || busy) return
      const frame = grabFrame(v, region)
      if (isBlackFrame(frame)) {
        setStatus('La fuente se ve en negro: usa la carpeta de screenshots de Tibia o la pantalla completa')
        return
      }
      const sig = signature(frame)
      const diffPrev = prev ? meanAbsDiff(prev, sig) : 0
      prev = sig
      if (diffPrev > cfg.assistedThreshold) {
        changedAt = Date.now()
        setStatus('Cambio detectado: esperando que la imagen se estabilice…')
        return
      }
      if (changedAt === null && lastSaved !== null) return
      if (changedAt !== null && Date.now() - changedAt < cfg.assistedDebounceMs) return
      // Estable: solo se propone si difiere de la última guardada/propuesta.
      if (lastSaved && meanAbsDiff(lastSaved, sig) <= cfg.assistedThreshold) {
        changedAt = null
        return
      }
      changedAt = null
      lastSaved = sig
      busy = true
      try {
        const png = await toPng(frame)
        if (cfg.assistedAutoSave) {
          await onSave(png)
          setSaved((n) => n + 1)
          setStatus('Captura guardada automáticamente')
        } else {
          const url = URL.createObjectURL(new Blob([png.slice()], { type: 'image/png' }))
          setPending((p) => [{ id: Date.now(), png, url, at: new Date().toISOString() }, ...p].slice(0, 12))
          setStatus('Nueva captura propuesta')
        }
      } finally {
        busy = false
      }
    }, cfg.assistedIntervalMs)
    setStatus('Observando la región…')
    return () => clearInterval(timer)
  }, [state, enabled, cfg, region, videoRef, onSave])

  const drop = (id: number) =>
    setPending((p) => {
      p.filter((x) => x.id === id).forEach((x) => URL.revokeObjectURL(x.url))
      return p.filter((x) => x.id !== id)
    })

  if (!cfg) return null
  return (
    <Card
      title="Captura asistida"
      actions={
        state === 'off' ? (
          <Button onClick={() => setState('running')} disabled={!enabled}>
            <Play className="size-4" /> Iniciar
          </Button>
        ) : (
          <>
            <Button onClick={() => setState(state === 'running' ? 'paused' : 'running')}>{state === 'running' ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
            <Button variant="danger" onClick={() => (setState('off'), setStatus(''))}>
              <Square className="size-4" />
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Eye className="size-3.5" /> {state === 'off' ? 'Detenida' : state === 'paused' ? 'En pausa' : status} {saved > 0 && `· ${saved} guardadas`}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Intervalo ms">
            <Input inputMode="numeric" value={cfg.assistedIntervalMs} onChange={(e) => saveSettings.mutate({ collector: { ...cfg, assistedIntervalMs: Math.max(250, Number(e.target.value) || 1000) } })} />
          </Field>
          <Field label="Debounce ms">
            <Input inputMode="numeric" value={cfg.assistedDebounceMs} onChange={(e) => saveSettings.mutate({ collector: { ...cfg, assistedDebounceMs: Math.max(0, Number(e.target.value) || 0) } })} />
          </Field>
          <Field label="Umbral">
            <Input inputMode="numeric" value={cfg.assistedThreshold} onChange={(e) => saveSettings.mutate({ collector: { ...cfg, assistedThreshold: Math.max(1, Number(e.target.value) || 6) } })} />
          </Field>
        </div>
        <Toggle checked={cfg.assistedAutoSave} onChange={(v) => saveSettings.mutate({ collector: { ...cfg, assistedAutoSave: v } })} label="Guardar automáticamente (sin preview)" />
        {pending.length > 0 && (
          <div className="flex flex-col gap-2">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 p-1.5">
                <img src={p.url} alt="Captura propuesta" className="h-12 w-20 rounded object-contain" />
                <span className="flex-1 text-xs text-muted">{formatDateTime(p.at)}</span>
                <Button variant="primary" onClick={() => void onSave(p.png).then(() => drop(p.id))}>
                  Guardar
                </Button>
                <Button variant="ghost" onClick={() => drop(p.id)} aria-label="Descartar">
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

/** Importa los screenshots que el cliente de Tibia guarda en su carpeta (vía recomendada). */
function TibiaFolderCard() {
  const settings = useApi('app.settings.get', undefined)
  const status = useApi('collector.tibiaFolder.status', undefined, { refetchInterval: 15_000 })
  const save = useApiMutation('app.settings.set', ['app.settings.get', 'collector.tibiaFolder.status'])
  const pick = useApiMutation('collector.tibiaFolder.pick', ['app.settings.get', 'collector.tibiaFolder.status'])
  const importer = useApiMutation('collector.tibiaFolder.importExisting', ['collector.screenshots.list', 'collector.tibiaFolder.status'])
  const c = settings.data?.collector
  if (!c) return null
  const tf = c.tibiaFolder
  const onlyHotkey = tf.types.length === 1 && tf.types[0] === 'Hotkey'
  const st = status.data
  return (
    <Card
      title="Capturas del cliente de Tibia (recomendado)"
      actions={
        <Button onClick={() => pick.mutate(undefined)} busy={pick.isPending}>
          <FolderInput className="size-4" /> Cambiar carpeta
        </Button>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted">
          Toma la captura con la tecla de screenshot del propio Tibia: el cliente la guarda en su carpeta y Tibia Tools la importa sola, sin capturar la ventana (que puede salir en negro).
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono">{st?.path ?? tf.path ?? '…'}</span>
          {st && (st.exists ? <Badge tone="good">carpeta encontrada</Badge> : <Badge tone="bad">no existe</Badge>)}
          {st?.watching && <Badge tone="info">vigilando</Badge>}
          {st && <span className="text-muted">{st.matchingFiles} capturas {onlyHotkey ? 'de la tecla de screenshot' : 'en total'} · {st.imported} importadas en esta sesión</span>}
          {st?.error && <span className="text-bad">{st.error}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Toggle checked={tf.enabled} onChange={(v) => save.mutate({ collector: { ...c, tibiaFolder: { ...tf, enabled: v } } })} label="Importar automáticamente las nuevas" />
          <Toggle
            checked={onlyHotkey}
            onChange={(v) => save.mutate({ collector: { ...c, tibiaFolder: { ...tf, types: v ? ['Hotkey'] : [] } } })}
            label="Solo las de la tecla de screenshot (*_Hotkey.png)"
          />
          <Button onClick={() => importer.mutate({ sinceDays: 7 })} busy={importer.isPending} disabled={!st?.exists}>
            Importar las de los últimos 7 días
          </Button>
        </div>
        {importer.data && (
          <p className="text-xs text-muted">
            {importer.data.imported.length} importadas, {importer.data.skipped} ya estaban.
            {importer.data.errors.length > 0 && <span className="text-warn"> Errores: {importer.data.errors.join('; ')}</span>}
          </p>
        )}
        <ErrorBox error={pick.error ?? importer.error ?? save.error} />
      </div>
    </Card>
  )
}
