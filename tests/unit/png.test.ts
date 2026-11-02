import { crc32, deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodePng } from '../../scripts/lib/png'

// Codificador PNG mínimo (RGBA, filtro 0) solo para probar el decodificador del CLI.
function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    out.write(type, 4, 'ascii')
    Buffer.from(data).copy(out, 8)
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])) >>> 0, 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)).copy(raw, y * (w * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())])
}

describe('decodificador PNG del CLI', () => {
  it('ida y vuelta RGBA', () => {
    const w = 7
    const h = 5
    const px = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256)
    const img = decodePng(encodePng(w, h, px))
    expect(img.width).toBe(w)
    expect(img.height).toBe(h)
    expect([...img.data]).toEqual([...px])
  })
  it('rechaza lo que no es PNG', () => {
    expect(() => decodePng(new Uint8Array(20))).toThrow()
  })
})
