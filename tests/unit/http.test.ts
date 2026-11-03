import { describe, expect, it } from 'vitest'
import { retryDelayMs } from '../../src/main/external/http'

describe('retryDelayMs', () => {
  it('respeta Retry-After en segundos (con margen) y no baja de la espera exponencial', () => {
    expect(retryDelayMs('5', 0)).toBe(5_250)
    expect(retryDelayMs('1', 3)).toBe(8_000)
  })
  it('acepta una fecha HTTP y la tope en 60 s', () => {
    const now = Date.parse('2026-11-02T23:00:00Z')
    expect(retryDelayMs('Mon, 02 Nov 2026 23:00:10 GMT', 0, now)).toBe(10_250)
    expect(retryDelayMs('3600', 0)).toBe(60_000)
  })
  it('sin cabecera o con basura usa 1 s · 2^intento', () => {
    expect(retryDelayMs(null, 0)).toBe(1_000)
    expect(retryDelayMs('pronto', 2)).toBe(4_000)
  })
})
