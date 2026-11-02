import { useRef, useState } from 'react'
import clsx from 'clsx'
import type { Rect } from '@core/ocr/types'

export interface LabeledRect {
  rect: Rect
  label: string
  tone?: 'accent' | 'info' | 'good' | 'bad' | 'warn'
}

/** Imagen con rectángulos superpuestos (en coordenadas de la imagen) y dibujo opcional de uno nuevo. */
export function ImageRegions({ src, rects, drawing, onDraw, highlight }: { src: string; rects: LabeledRect[]; drawing?: boolean; onDraw?: (r: Rect) => void; highlight?: number | null }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [, force] = useState(0)
  const scale = () => {
    const img = imgRef.current
    return img && img.naturalWidth ? img.clientWidth / img.naturalWidth : 1
  }
  const pos = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }
  const s = scale()
  return (
    <div
      className={clsx('relative inline-block max-w-full select-none', drawing && 'cursor-crosshair')}
      onMouseDown={(e) => {
        if (!drawing) return
        const p = pos(e)
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      }}
      onMouseMove={(e) => drag && setDrag({ ...drag, x1: pos(e).x, y1: pos(e).y })}
      onMouseUp={() => {
        if (!drag) return
        const k = 1 / scale()
        const r = { x: Math.round(Math.min(drag.x0, drag.x1) * k), y: Math.round(Math.min(drag.y0, drag.y1) * k), w: Math.round(Math.abs(drag.x1 - drag.x0) * k), h: Math.round(Math.abs(drag.y1 - drag.y0) * k) }
        setDrag(null)
        if (r.w >= 2 && r.h >= 2) onDraw?.(r)
      }}
    >
      <img ref={imgRef} src={src} alt="Captura" className="pixel block max-w-full" draggable={false} onLoad={() => force((n) => n + 1)} />
      {rects.map((r, i) => (
        <div
          key={i}
          className={clsx(
            'pointer-events-none absolute border',
            r.tone === 'info' && 'border-info',
            r.tone === 'good' && 'border-good',
            r.tone === 'bad' && 'border-bad bg-bad/10',
            r.tone === 'warn' && 'border-warn bg-warn/10',
            (!r.tone || r.tone === 'accent') && 'border-accent',
            highlight === i && 'bg-accent/20',
          )}
          style={{ left: r.rect.x * s, top: r.rect.y * s, width: r.rect.w * s, height: r.rect.h * s }}
        >
          {r.label && <span className="absolute -top-4 left-0 whitespace-nowrap bg-panel/90 px-1 text-[10px]">{r.label}</span>}
        </div>
      ))}
      {drag && <div className="pointer-events-none absolute border-2 border-dashed border-accent" style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }} />}
    </div>
  )
}
