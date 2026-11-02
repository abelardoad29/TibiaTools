import { inflateSync } from 'node:zlib'
import type { RgbaImage } from '../../src/core/ocr/types'

// Decodificador PNG mínimo para el CLI de evaluación: 8 bits por canal, sin entrelazado,
// tipos de color 0 (gris), 2 (RGB), 4 (gris+alfa) y 6 (RGBA). Suficiente para capturas de pantalla.
export function decodePng(buf: Uint8Array): RgbaImage {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('No es un PNG')
  let pos = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat: Uint8Array[] = []
  while (pos < buf.length) {
    const len = dv.getUint32(pos)
    const type = String.fromCharCode(...buf.subarray(pos + 4, pos + 8))
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8)
      height = dv.getUint32(pos + 12)
      const depth = data[8]
      colorType = data[9]!
      if (depth !== 8 || data[12] !== 0) throw new Error('Solo PNG de 8 bits sin entrelazado')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`Tipo de color PNG ${colorType} no soportado`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8ClampedArray(width * height * 4)
  const prev = new Uint8Array(stride)
  const cur = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels]! : 0
      const b = prev[i]!
      const c = i >= channels ? prev[i - channels]! : 0
      const x = line[i]!
      let v: number
      if (filter === 0) v = x
      else if (filter === 1) v = x + a
      else if (filter === 2) v = x + b
      else if (filter === 3) v = x + ((a + b) >> 1)
      else {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      cur[i] = v & 0xff
    }
    for (let px = 0; px < width; px++) {
      const s = px * channels
      const d = (y * width + px) * 4
      if (channels === 1 || channels === 2) {
        out[d] = out[d + 1] = out[d + 2] = cur[s]!
        out[d + 3] = channels === 2 ? cur[s + 1]! : 255
      } else {
        out[d] = cur[s]!
        out[d + 1] = cur[s + 1]!
        out[d + 2] = cur[s + 2]!
        out[d + 3] = channels === 4 ? cur[s + 3]! : 255
      }
    }
    prev.set(cur)
  }
  return { width, height, data: out }
}
