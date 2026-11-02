// El oro (GP) siempre es entero. Se representa con `number` mientras sea un entero seguro
// (|n| <= 2^53 - 1); cualquier operación que salga de ese rango lanza en vez de perder precisión.

export type Gp = number

export type Rounding = 'ceil' | 'floor' | 'round'

export function assertGp(n: number, what = 'GP'): Gp {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} debe ser un entero seguro, se recibió ${n}`)
  return n
}

export function mulGp(unitPrice: Gp, amount: number): Gp {
  assertGp(unitPrice, 'precio')
  assertGp(amount, 'cantidad')
  return assertGp(unitPrice * amount, 'precio × cantidad')
}

export function sumGp(values: readonly Gp[]): Gp {
  let total = 0
  for (const v of values) total = assertGp(total + assertGp(v), 'suma')
  return total
}

/** División entera de enteros no negativos con redondeo explícito. */
export function divRound(numerator: number, denominator: number, rounding: Rounding): number {
  assertGp(numerator)
  assertGp(denominator)
  if (denominator <= 0) throw new RangeError('denominador debe ser > 0')
  if (numerator < 0) return -divRound(-numerator, denominator, rounding === 'ceil' ? 'floor' : rounding === 'floor' ? 'ceil' : 'round')
  const q = Math.floor(numerator / denominator)
  const r = numerator - q * denominator
  if (r === 0) return q
  if (rounding === 'floor') return q
  if (rounding === 'ceil') return q + 1
  return r * 2 >= denominator ? q + 1 : q
}

/** value × bps / 10 000 con redondeo explícito (1 bps = 0.01 %). */
export function applyBps(value: Gp, bps: number, rounding: Rounding): Gp {
  return divRound(mulGp(value, bps), 10_000, rounding)
}

const SUFFIX: Record<string, number> = { '': 1, k: 1_000, kk: 1_000_000, kkk: 1_000_000_000 }

/**
 * Convierte texto de precio a GP: "1,234,567", "1 234", "15k", "1.5kk", "-12,345".
 * Devuelve null si el texto no es un número válido. No usa floats: "1.5kk" se resuelve por dígitos.
 */
export function parseGp(text: string): Gp | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '').replace(/gp$|gold$/, '')
  const m = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(k{0,3})$/.exec(t)
  if (!m) return null
  const [, sign, intPart = '', frac = '', suffix = ''] = m
  const mult = SUFFIX[suffix]
  if (mult === undefined) return null
  if (frac && mult === 1) return null // "1.5" sin sufijo no es un precio válido
  const digits = intPart.replace(/,/g, '')
  const fracDigits = frac.slice(0, String(mult).length - 1)
  const scale = 10 ** fracDigits.length
  if (mult % scale !== 0) return null
  const value = Number(digits) * mult + (fracDigits ? Number(fracDigits) * (mult / scale) : 0)
  if (!Number.isSafeInteger(value)) return null
  return sign ? -value : value
}

export function formatGp(n: Gp): string {
  return n.toLocaleString('en-US')
}

/** Formato corto al estilo del juego: 1,500 → 1.5k, 2,300,000 → 2.3kk. Solo para mostrar. */
export function formatGpShort(n: Gp): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  const units: [number, string][] = [
    [1_000_000_000, 'kkk'],
    [1_000_000, 'kk'],
    [1_000, 'k'],
  ]
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const tenths = divRound(abs, size / 10, 'floor')
      const whole = Math.floor(tenths / 10)
      const dec = tenths % 10
      return `${sign}${whole}${dec ? '.' + dec : ''}${suffix}`
    }
  }
  return `${sign}${abs}`
}
