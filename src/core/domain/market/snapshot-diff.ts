import type { Gp } from '../money/gp'
import type { OfferLevel, OfferSide } from './order-book'

// Compara dos snapshots consecutivos del mismo mundo/item/lado. La identidad de una oferta es
// probabilística (precio + cantidad no la identifican de forma única) y una desaparición NO prueba
// una venta: por eso no existe ningún estado "vendido confirmado".

export type MarketEventType =
  | 'first_seen'
  | 'amount_reduced'
  | 'amount_increased'
  | 'price_changed'
  | 'possibly_filled'
  | 'possibly_removed'
  | 'expired_unknown'

export interface MarketEvent {
  type: MarketEventType
  side: OfferSide
  price: Gp
  quantity: number
  confidence: number
  note: string
}

interface PriceBucket {
  price: Gp
  amounts: number[]
  expiresAt: (string | null)[]
}

function bucketize(levels: readonly OfferLevel[]): Map<Gp, PriceBucket> {
  const map = new Map<Gp, PriceBucket>()
  for (const l of levels) {
    const b = map.get(l.unitPrice) ?? { price: l.unitPrice, amounts: [], expiresAt: [] }
    b.amounts.push(l.amount)
    b.expiresAt.push(l.expiresAt ?? null)
    map.set(l.unitPrice, b)
  }
  return map
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export function diffSnapshots(side: OfferSide, prev: readonly OfferLevel[], next: readonly OfferLevel[], nextObservedAt: string): MarketEvent[] {
  const before = bucketize(prev)
  const after = bucketize(next)
  const events: MarketEvent[] = []
  // El mejor precio previo es donde una ejecución es más probable.
  const prevPrices = [...before.keys()].sort((a, b) => (side === 'sell' ? a - b : b - a))
  const best = prevPrices[0]

  const vanished: PriceBucket[] = []
  const appeared: PriceBucket[] = []

  for (const [price, b] of before) {
    const a = after.get(price)
    if (!a) {
      vanished.push(b)
      continue
    }
    const delta = sum(a.amounts) - sum(b.amounts)
    if (delta < 0) {
      events.push({ type: 'amount_reduced', side, price, quantity: -delta, confidence: 0.6, note: 'Cantidad menor al mismo precio' })
      events.push({
        type: 'possibly_filled',
        side,
        price,
        quantity: -delta,
        confidence: price === best ? 0.6 : 0.4,
        note: 'Reducción parcial: posible ejecución (también puede ser una oferta retirada)',
      })
    } else if (delta > 0) {
      events.push({ type: 'amount_increased', side, price, quantity: delta, confidence: 0.7, note: 'Más cantidad al mismo precio (oferta nueva o ampliada)' })
    }
  }
  for (const [price, a] of after) if (!before.has(price)) appeared.push(a)

  // Un nivel que desaparece y otro que aparece con la misma cantidad total sugiere un cambio de precio.
  const matchedAppeared = new Set<PriceBucket>()
  for (const v of vanished) {
    const qty = sum(v.amounts)
    const twin = appeared.find((a) => !matchedAppeared.has(a) && sum(a.amounts) === qty)
    if (twin) {
      matchedAppeared.add(twin)
      events.push({ type: 'price_changed', side, price: twin.price, quantity: qty, confidence: 0.35, note: `Posible cambio de precio desde ${v.price}` })
      continue
    }
    const expired = v.expiresAt.some((e) => e !== null && e <= nextObservedAt)
    if (expired) {
      events.push({ type: 'expired_unknown', side, price: v.price, quantity: qty, confidence: 0.7, note: 'Vencía antes del snapshot nuevo' })
    } else if (v.price === best) {
      events.push({ type: 'possibly_filled', side, price: v.price, quantity: qty, confidence: 0.5, note: 'Desapareció el mejor precio: posible ejecución' })
    } else {
      events.push({ type: 'possibly_removed', side, price: v.price, quantity: qty, confidence: 0.4, note: 'Desapareció un nivel no-mejor: posible retiro o ejecución' })
    }
  }
  for (const a of appeared) {
    if (matchedAppeared.has(a)) continue
    events.push({ type: 'first_seen', side, price: a.price, quantity: sum(a.amounts), confidence: 0.8, note: 'Nivel de precio nuevo' })
  }
  return events
}
