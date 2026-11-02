// Genera el icono de la app (512×512) a partir del logo de Lumbre: recorta el emblema (sin el texto),
// lo centra sobre un cuadrado oscuro redondeado (como el favicon de Lumbre) y lo guarda donde lo usan
// Electron, el instalador y la PWA.
// Uso: npm run icon
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodePng } from './lib/png'

const ROOT = join(import.meta.dirname, '..')
const SIZE = 512
const RADIUS = 112 // 14/64 del favicon de Lumbre
const PADDING = 72
const BG = [0x0b, 0x0b, 0x0b]

const src = decodePng(readFileSync(join(ROOT, 'resources', 'brand', 'logo-lumbre.png')))
const alpha = (x: number, y: number) => src.data[(y * src.width + x) * 4 + 3]!
const rowHasInk = (y: number) => {
  for (let x = 0; x < src.width; x++) if (alpha(x, y) > 16) return true
  return false
}

// El emblema termina en la primera franja vacía (≥ 12 filas) después de empezar la tinta: debajo va el texto.
let top = 0
while (top < src.height && !rowHasInk(top)) top++
let bottom = top
let gap = 0
for (let y = top; y < src.height; y++) {
  if (rowHasInk(y)) {
    bottom = y
    gap = 0
  } else if (++gap >= 12) break
}
let left = src.width
let right = 0
for (let y = top; y <= bottom; y++) {
  for (let x = 0; x < src.width; x++) {
    if (alpha(x, y) > 16) {
      left = Math.min(left, x)
      right = Math.max(right, x)
    }
  }
}
const ew = right - left + 1
const eh = bottom - top + 1
const scale = Math.min((SIZE - 2 * PADDING) / ew, (SIZE - 2 * PADDING) / eh)
const ox = (SIZE - ew * scale) / 2
const oy = (SIZE - eh * scale) / 2

// Muestreo bilineal con alfa premultiplicado.
function sample(fx: number, fy: number): [number, number, number, number] {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const acc = [0, 0, 0, 0]
  for (const [dx, dy, w] of [
    [0, 0, (1 - (fx - x0)) * (1 - (fy - y0))],
    [1, 0, (fx - x0) * (1 - (fy - y0))],
    [0, 1, (1 - (fx - x0)) * (fy - y0)],
    [1, 1, (fx - x0) * (fy - y0)],
  ] as const) {
    const x = Math.min(right, Math.max(left, x0 + dx))
    const y = Math.min(bottom, Math.max(top, y0 + dy))
    const i = (y * src.width + x) * 4
    const a = src.data[i + 3]! / 255
    acc[0]! += src.data[i]! * a * w
    acc[1]! += src.data[i + 1]! * a * w
    acc[2]! += src.data[i + 2]! * a * w
    acc[3]! += a * w
  }
  return acc as [number, number, number, number]
}

const out = new Uint8ClampedArray(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // Máscara del cuadrado redondeado (antialias de 1 px en las esquinas).
    const cx = Math.max(RADIUS - x - 0.5, 0, x + 0.5 - (SIZE - RADIUS))
    const cy = Math.max(RADIUS - y - 0.5, 0, y + 0.5 - (SIZE - RADIUS))
    const mask = Math.min(1, Math.max(0, RADIUS - Math.hypot(cx, cy) + 0.5))
    let [r, g, b] = BG as [number, number, number]
    // Supermuestreo 2×2 del emblema.
    let er = 0
    let eg = 0
    let eb = 0
    let ea = 0
    for (const sy of [0.25, 0.75]) {
      for (const sx of [0.25, 0.75]) {
        const fx = left + (x + sx - ox) / scale
        const fy = top + (y + sy - oy) / scale
        if (fx < left || fx > right || fy < top || fy > bottom) continue
        const [pr, pg, pb, pa] = sample(fx, fy)
        er += pr / 4
        eg += pg / 4
        eb += pb / 4
        ea += pa / 4
      }
    }
    r = er + r * (1 - ea)
    g = eg + g * (1 - ea)
    b = eb + b * (1 - ea)
    out.set([r, g, b, Math.round(mask * 255)], (y * SIZE + x) * 4)
  }
}

const png = encodePng({ width: SIZE, height: SIZE, data: out })
for (const target of [join(ROOT, 'resources', 'icon.png'), join(ROOT, 'src', 'renderer', 'public', 'icon.png')]) writeFileSync(target, png)
console.log(`Emblema ${ew}×${eh} (filas ${top}–${bottom}) → icono ${SIZE}×${SIZE}`)
