import { describe, expect, it } from 'vitest'
import { decodePng, encodePng } from '../../scripts/lib/png'

describe('decodificador PNG del CLI', () => {
  it('ida y vuelta RGBA', () => {
    const w = 7
    const h = 5
    const px = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256)
    const img = decodePng(encodePng({ width: w, height: h, data: px }))
    expect(img.width).toBe(w)
    expect(img.height).toBe(h)
    expect([...img.data]).toEqual([...px])
  })
  it('rechaza lo que no es PNG', () => {
    expect(() => decodePng(new Uint8Array(20))).toThrow()
  })
})
