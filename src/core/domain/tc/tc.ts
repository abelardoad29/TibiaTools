import { sortLevels, walkBook, type OfferLevel } from '../market/order-book'
import type { Gp } from '../money/gp'

// Tibia Coins en el Market. No hay tasa universal: comprar TC consume sell offers (precio ascendente)
// y vender TC consume buy offers (precio descendente). Nunca se mezcla un lado con el otro.

export interface TcQuote {
  bestBuyOffer: Gp | null
  bestSellOffer: Gp | null
  spread: Gp | null
  spreadPct: number | null
}

export function tcQuote(buyOffers: readonly OfferLevel[], sellOffers: readonly OfferLevel[]): TcQuote {
  const bestBuyOffer = sortLevels('buy', buyOffers)[0]?.unitPrice ?? null
  const bestSellOffer = sortLevels('sell', sellOffers)[0]?.unitPrice ?? null
  const spread = bestBuyOffer !== null && bestSellOffer !== null ? bestSellOffer - bestBuyOffer : null
  return { bestBuyOffer, bestSellOffer, spread, spreadPct: spread !== null && bestBuyOffer ? (spread / bestBuyOffer) * 100 : null }
}

/** GP necesarios para COMPRAR `tc` coins aceptando sell offers. `unfilled` > 0 si no alcanza la profundidad. */
export function gpToBuyTc(sellOffers: readonly OfferLevel[], tc: number) {
  return walkBook(sortLevels('sell', sellOffers), tc)
}

/** GP obtenidos al VENDER `tc` coins aceptando buy offers. */
export function gpFromSellingTc(buyOffers: readonly OfferLevel[], tc: number) {
  return walkBook(sortLevels('buy', buyOffers), tc)
}
