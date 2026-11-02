import { useEffect, useRef, useState } from 'react'
import { binarize, crop, toGray, type Binary } from '@core/ocr/image'
import { learnGlyphs, mergeAtlas, readLine } from '@core/ocr/glyphs'
import type { DetailsField, OcrProfile, OfferColumnKey, Rect, RgbaImage, ScreenType } from '@core/ocr/types'
import { useApiMutation } from '../../lib/api'
import { Badge, Button, ErrorBox, Field, Input, Modal, Select, Toggle } from '../../components/ui'
import { ImageRegions, type LabeledRect } from './ImageRegions'
import { loadImage } from './imaging'

export function emptyProfile(screenType: ScreenType, width: number, height: number): OcrProfile {
  return {
    id: null,
    name: `${screenType === 'offers' ? 'Ofertas' : 'Details'} ${width}×${height}`,
    screenType,
    refWidth: width,
    refHeight: height,
    tables: [],
    detailsFields: [],
    preprocess: { threshold: 'otsu', darkText: false, spaceGap: 3 },
    atlas: { glyphs: [] },
    version: 0,
    updatedAt: null,
  }
}

const COL_LABEL: Record<OfferColumnKey, string> = { amount: 'Cantidad', unitPrice: 'Precio unidad', totalPrice: 'Total', endsAt: 'Vence' }
const FIELD_LABEL: Record<DetailsField, string> = { transactions: 'Transacciones', highest: 'Máximo', average: 'Promedio', lowest: 'Mínimo' }

type Tool = { kind: 'table'; side: 'buy' | 'sell' } | { kind: 'column'; side: 'buy' | 'sell'; key: OfferColumnKey } | { kind: 'detail'; side: 'buy' | 'sell'; field: DetailsField } | { kind: 'calibrate' }

function BinaryPreview({ bin }: { bin: Binary }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = bin.width
    c.height = bin.height
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(bin.width, bin.height)
    for (let i = 0; i < bin.data.length; i++) {
      const v = bin.data[i] ? 255 : 20
      img.data.set([v, v, v, 255], i * 4)
    }
    ctx.putImageData(img, 0, 0)
  }, [bin])
  return <canvas ref={ref} className="pixel max-w-full border border-line" style={{ width: bin.width * 4, height: bin.height * 4 }} />
}

/**
 * Editor visual de perfiles OCR. Las regiones se dibujan sobre una captura real; la calibración
 * aprende los glifos a partir de líneas que el usuario etiqueta. No hay coordenadas universales.
 */
export function ProfileEditor({ initial, imageUrl, onClose, onSaved }: { initial: OcrProfile; imageUrl: string; onClose: () => void; onSaved: (p: OcrProfile) => void }) {
  const [p, setP] = useState<OcrProfile>(initial)
  const [tool, setTool] = useState<Tool>({ kind: initial.screenType === 'offers' ? 'table' : 'detail', side: 'sell', ...(initial.screenType === 'details' ? { field: 'transactions' as const } : {}) } as Tool)
  const [image, setImage] = useState<RgbaImage | null>(null)
  const [sample, setSample] = useState<{ rect: Rect; bin: Binary; read: string } | null>(null)
  const [label, setLabel] = useState('')
  const [calibError, setCalibError] = useState<string | null>(null)
  const save = useApiMutation('ocr.profiles.save', ['ocr.profiles.list'])

  useEffect(() => {
    void loadImage(imageUrl).then((img) => {
      setImage(img)
      // Un perfil nuevo toma la resolución de la captura de referencia.
      setP((cur) => (cur.id === null ? { ...cur, refWidth: img.width, refHeight: img.height } : cur))
    })
  }, [imageUrl])

  const binOf = (r: Rect) => binarize(crop(toGray(image!), r), p.preprocess.threshold, p.preprocess.darkText)

  const onDraw = (r: Rect) => {
    if (tool.kind === 'table') {
      const others = p.tables.filter((t) => t.side !== tool.side)
      const prev = p.tables.find((t) => t.side === tool.side)
      setP({ ...p, tables: [...others, { side: tool.side, rect: r, columns: prev?.columns ?? [], rowHeight: prev?.rowHeight ?? null }] })
    } else if (tool.kind === 'column') {
      const table = p.tables.find((t) => t.side === tool.side)
      if (!table) return setCalibError('Primero dibuja el área de la tabla de ese lado')
      const columns = [...table.columns.filter((c) => c.key !== tool.key), { key: tool.key, x: r.x, w: r.w }]
      setP({ ...p, tables: p.tables.map((t) => (t.side === tool.side ? { ...t, columns } : t)) })
    } else if (tool.kind === 'detail') {
      setP({ ...p, detailsFields: [...p.detailsFields.filter((f) => !(f.side === tool.side && f.field === tool.field)), { side: tool.side, field: tool.field, rect: r }] })
    } else if (image) {
      const bin = binOf(r)
      setSample({ rect: r, bin, read: readLine(bin, p.atlas, p.preprocess.spaceGap).text })
      setCalibError(null)
    }
  }

  const learn = () => {
    if (!sample) return
    const r = learnGlyphs(sample.bin, label)
    if ('error' in r) return setCalibError(r.error)
    const atlas = mergeAtlas(p.atlas, r.glyphs)
    setP({ ...p, atlas })
    setSample({ ...sample, read: readLine(sample.bin, atlas, p.preprocess.spaceGap).text })
    setCalibError(null)
  }

  const rects: LabeledRect[] = [
    ...p.tables.flatMap((t) => [
      { rect: t.rect, label: `Tabla ${t.side}`, tone: 'info' as const },
      ...t.columns.map((c) => ({ rect: { x: c.x, y: t.rect.y, w: c.w, h: t.rect.h }, label: `${t.side}: ${COL_LABEL[c.key]}`, tone: 'accent' as const })),
    ]),
    ...p.detailsFields.map((f) => ({ rect: f.rect, label: `${f.side}: ${FIELD_LABEL[f.field]}`, tone: 'accent' as const })),
    ...(sample ? [{ rect: sample.rect, label: 'muestra', tone: 'good' as const }] : []),
  ]

  const toolValue = tool.kind === 'table' ? `table:${tool.side}` : tool.kind === 'column' ? `column:${tool.side}:${tool.key}` : tool.kind === 'detail' ? `detail:${tool.side}:${tool.field}` : 'calibrate'
  const toolOptions =
    p.screenType === 'offers'
      ? [
          ...(['sell', 'buy'] as const).flatMap((side) => [
            { value: `table:${side}`, label: `Área de la tabla ${side === 'sell' ? 'Sell' : 'Buy'} offers (sin cabecera)` },
            ...(Object.keys(COL_LABEL) as OfferColumnKey[]).map((key) => ({ value: `column:${side}:${key}`, label: `  Columna ${side}: ${COL_LABEL[key]}` })),
          ]),
          { value: 'calibrate', label: 'Calibrar glifos (dibuja una línea de texto)' },
        ]
      : [
          ...(['sell', 'buy'] as const).flatMap((side) => (Object.keys(FIELD_LABEL) as DetailsField[]).map((field) => ({ value: `detail:${side}:${field}`, label: `${side === 'sell' ? 'Sell' : 'Buy'} offers: ${FIELD_LABEL[field]}` }))),
          { value: 'calibrate', label: 'Calibrar glifos (dibuja una línea de texto)' },
        ]
  const parseTool = (v: string): Tool => {
    const [kind, side, key] = v.split(':') as [string, 'buy' | 'sell', string]
    if (kind === 'table') return { kind, side }
    if (kind === 'column') return { kind, side, key: key as OfferColumnKey }
    if (kind === 'detail') return { kind, side, field: key as DetailsField }
    return { kind: 'calibrate' }
  }
  const chars = [...new Set(p.atlas.glyphs.map((g) => g.ch))].sort().join(' ')

  return (
    <Modal title={p.id ? `Perfil: ${p.name} (v${p.version})` : 'Nuevo perfil OCR'} onClose={onClose} wide>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="max-h-[70vh] overflow-auto">
          <ImageRegions src={imageUrl} rects={rects} drawing onDraw={onDraw} />
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <Field label="Nombre">
            <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          </Field>
          <p className="text-xs text-muted">
            Resolución de referencia {p.refWidth}×{p.refHeight}. Usa capturas con la misma región y escala de la GUI.
          </p>
          <Field label="Qué dibujar">
            <Select value={toolValue} onChange={(e) => setTool(parseTool(e.target.value))} options={toolOptions} />
          </Field>
          {p.screenType === 'offers' &&
            p.tables.map((t) => (
              <Field key={t.side} label={`Alto de fila (${t.side})`} hint="Vacío = detectar filas automáticamente">
                <Input
                  inputMode="numeric"
                  value={t.rowHeight ?? ''}
                  onChange={(e) => setP({ ...p, tables: p.tables.map((x) => (x.side === t.side ? { ...x, rowHeight: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : null } : x)) })}
                />
              </Field>
            ))}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Umbral" hint="otsu o 0–255">
              <Input
                value={String(p.preprocess.threshold)}
                onChange={(e) => {
                  const v = e.target.value.trim()
                  setP({ ...p, preprocess: { ...p.preprocess, threshold: v === 'otsu' || v === '' ? 'otsu' : Math.max(0, Math.min(255, Number(v) || 0)) } })
                }}
              />
            </Field>
            <Field label="Espacio entre palabras (px)">
              <Input inputMode="numeric" value={p.preprocess.spaceGap} onChange={(e) => setP({ ...p, preprocess: { ...p.preprocess, spaceGap: Math.max(1, Number(e.target.value) || 3) } })} />
            </Field>
          </div>
          <Toggle checked={p.preprocess.darkText} onChange={(v) => setP({ ...p, preprocess: { ...p.preprocess, darkText: v } })} label="Texto más oscuro que el fondo" />

          <div className="rounded-lg border border-line p-2">
            <div className="mb-1 text-xs font-medium text-muted">Calibración de glifos</div>
            <p className="text-xs text-muted">
              Elige «Calibrar glifos», dibuja un rectángulo ajustado a UNA línea (p. ej. un precio) y escribe exactamente lo que dice. Repite hasta cubrir los dígitos 0–9 y la coma.
            </p>
            {sample && (
              <div className="mt-2 flex flex-col gap-2">
                <BinaryPreview bin={sample.bin} />
                <div className="text-xs">
                  Lectura actual: <span className="num font-mono">{sample.read || '—'}</span>
                </div>
                <div className="flex gap-2">
                  <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Texto exacto, p. ej. 1,234,567" onKeyDown={(e) => e.key === 'Enter' && learn()} />
                  <Button onClick={learn} disabled={!label.trim()}>
                    Aprender
                  </Button>
                </div>
              </div>
            )}
            {calibError && <p className="mt-1 text-xs text-bad">{calibError}</p>}
            <div className="mt-2 text-xs">
              Glifos: {p.atlas.glyphs.length} · caracteres: <span className="font-mono">{chars || '—'}</span>
            </div>
            {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ','].filter((c) => !chars.includes(c)).length > 0 && (
              <Badge tone="warn">Faltan: {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ','].filter((c) => !chars.includes(c)).join(' ')}</Badge>
            )}
          </div>

          <ErrorBox error={save.error} />
          <div className="flex gap-2">
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate(p, { onSuccess: (saved) => (setP(saved), onSaved(saved)) })}>
              Guardar perfil
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
