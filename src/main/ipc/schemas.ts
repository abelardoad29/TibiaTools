import { z } from 'zod'
import type { Channel, In } from '@shared/api'

// Validación de entrada de cada canal IPC. Todo lo que llega del renderer se valida aquí.

const name = z.string().trim().min(1).max(64)
const id = z.number().int().positive()
const uuid = z.string().uuid()
const gp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const nullableBool = z.boolean().nullable()
const rect = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().positive(), h: z.number().int().positive() })
const screenType = z.enum(['offers', 'details'])
const dataSource = z.enum(['own_capture', 'third_party', 'manual'])
const routeStatus = z.enum(['allowed', 'blocked', 'unknown'])
const correction = z.object({ field: z.string().max(32), raw: z.string().max(200), ocrValue: z.string().max(200), corrected: z.string().max(200) })

const glyph = z.object({ ch: z.string().length(1), w: z.number().int().positive().max(64), h: z.number().int().positive().max(64), bits: z.string().regex(/^[01]+$/) })
export const ocrProfileSchema = z.object({
  id: z.number().int().positive().nullable(),
  name: z.string().trim().min(1).max(80),
  screenType,
  refWidth: z.number().int().positive().max(10_000),
  refHeight: z.number().int().positive().max(10_000),
  tables: z.array(
    z.object({
      side: z.enum(['buy', 'sell']),
      rect,
      columns: z.array(z.object({ key: z.enum(['amount', 'unitPrice', 'totalPrice', 'endsAt']), x: z.number().int().min(0), w: z.number().int().positive() })).max(4),
      rowHeight: z.number().int().positive().max(200).nullable(),
    }),
  ).max(2),
  detailsFields: z.array(z.object({ side: z.enum(['buy', 'sell']), field: z.enum(['transactions', 'highest', 'average', 'lowest']), rect })).max(8),
  preprocess: z.object({
    threshold: z.union([z.number().int().min(0).max(255), z.literal('otsu'), z.literal('auto')]),
    delta: z.number().int().min(1).max(128).optional(),
    darkText: z.boolean(),
    spaceGap: z.number().int().min(1).max(20),
  }),
  atlas: z.object({ glyphs: z.array(glyph).max(2_000) }),
  anchor: z
    .object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().positive().max(400), h: z.number().int().positive().max(100), threshold: z.number().int().min(0).max(255), bits: z.string().regex(/^[01]+$/), label: z.string().max(40) })
    .nullable()
    .optional(),
  itemList: z
    .object({ rect, entryHeight: z.number().int().positive().max(200), iconWidth: z.number().int().min(0).max(200), atlas: z.object({ glyphs: z.array(glyph).max(2_000) }), spaceGap: z.number().int().min(1).max(20) })
    .nullable()
    .optional(),
  version: z.number().int().min(0),
  updatedAt: z.string().nullable(),
})

const transferProfile = z.object({
  id: z.number().int().positive().nullable(),
  name,
  currentWorld: name.nullable(),
  lastTransferAt: z.string().nullable(),
  hasRedOrBlackSkull: nullableBool,
  isGuildLeader: nullableBool,
  ownsHouse: nullableBool,
  hasOpenTcMarketOffers: nullableBool,
  isOnMainContinent: nullableBool,
  visitedCalvaOrCalvera: nullableBool,
  transferType: z.enum(['regular', 'express']),
  availableEligibleTc: z.number().int().nonnegative().nullable(),
})

const cartConstraints = z.object({
  budgetGp: gp,
  transferCostGp: gp.nullable(),
  minRoi: z.number().min(-100).max(10_000),
  minConfidenceScore: z.number().min(0).max(100),
  maxQuantityPerItem: z.number().int().positive().nullable(),
  capacityOz: z.number().positive().nullable(),
  slots: z.number().int().positive().nullable(),
})

const alertRule = z.discriminatedUnion('kind', [
  z.object({ id: z.number().int(), kind: z.literal('roi_above'), params: z.object({ minRoi: z.number(), originWorld: name.optional(), destinationWorld: name.optional() }) }),
  z.object({ id: z.number().int(), kind: z.literal('item_below_price'), params: z.object({ world: name, itemId: id, itemName: z.string().max(100), maxPrice: gp }) }),
  z.object({ id: z.number().int(), kind: z.literal('tc_spread_above'), params: z.object({ world: name.optional(), minSpreadPct: z.number().min(0) }) }),
  z.object({ id: z.number().int(), kind: z.literal('stale_data'), params: z.object({ world: name, maxAgeHours: z.number().positive() }) }),
  z.object({ id: z.number().int(), kind: z.literal('route_invalid'), params: z.object({ originWorld: name, destinationWorld: name }) }),
])

const offer = z.object({
  side: z.enum(['buy', 'sell']),
  rowIndex: z.number().int().min(0),
  unitPrice: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  amount: z.number().int().positive().max(1_000_000),
  totalPrice: gp.nullable(),
  expirationText: z.string().max(64).nullable(),
  rawPriceText: z.string().max(64),
  rawAmountText: z.string().max(64),
  priceConfidence: z.number().min(0).max(1),
  amountConfidence: z.number().min(0).max(1),
  corrections: z.array(correction).max(10),
})

const v = z.void().or(z.undefined()).or(z.null())

const schemas = {
  'app.info': v,
  'app.settings.get': v,
  'app.settings.set': z.record(z.string(), z.unknown()),
  'app.backup.create': v,
  'app.backup.list': v,
  'app.backup.restore': z.object({ path: z.string().min(1).max(1_000) }),
  'app.openFolder': z.object({ target: z.enum(['data', 'evidence', 'backups', 'exports', 'logs']) }),
  'app.logs.tail': z.object({ lines: z.number().int().min(1).max(2_000) }),

  'catalog.worlds.list': z.object({ activeOnly: z.boolean() }),
  'catalog.worlds.sync': v,
  'catalog.worlds.update': z.object({ name, looserTransferConditions: nullableBool }),
  'catalog.worlds.live': v,
  'catalog.worlds.detail': z.object({ name }),
  'bosses.outlook': z.object({ world: name }),
  'bosses.history': z.object({ world: name, boss: z.string().min(1).max(64) }),
  'catalog.items.search': z.object({ q: z.string().max(100), category: z.string().max(64).nullable(), limit: z.number().int().min(1).max(500) }),
  'catalog.items.get': z.object({ id }),
  'catalog.items.byName': z.object({ names: z.array(z.string().max(100)).max(200) }),
  'catalog.items.categories': v,
  'catalog.items.update': z.object({ id, weightOz: z.number().positive().nullable(), stackSize: z.number().int().positive().nullable(), iconOverrideUrl: z.string().url().startsWith('https://').nullable() }),
  'catalog.icons.stats': v,
  'catalog.icons.prefetch': z.object({ category: z.string().max(64).nullable() }),

  'tools.boosted': z.object({ refresh: z.boolean() }),
  'tools.character': z.object({ name }),
  'tools.imbuements': v,
  'tools.imbuable': v,
  'tools.imbuements.prices': z.object({ world: name, items: z.array(z.string().max(100)).max(100) }),

  'characters.list': v,
  'characters.add': z.object({ name }),
  'characters.remove': z.object({ id }),
  'characters.events': z.object({ limit: z.number().int().min(1).max(500) }),
  'characters.refresh': v,

  'market.thirdParty.import': z.object({ world: name, itemIds: z.array(z.number().int().positive()).max(50).nullable() }),
  'market.thirdParty.worlds': v,
  'market.thirdParty.sync': z.object({ worlds: z.array(name).max(200).nullable(), force: z.boolean() }),
  'market.thirdParty.cancel': v,
  'market.thirdParty.status': v,
  'market.scans.list': z.object({ world: name.nullable(), itemId: id.nullable(), source: dataSource.nullable(), limit: z.number().int().min(1).max(1_000) }),
  'market.book': z.object({ world: name, itemId: id, includeThirdParty: z.boolean() }),
  'market.history': z.object({ world: name, itemId: id, days: z.number().int().min(1).max(365), includeThirdParty: z.boolean() }),
  'market.coverage': v,
  'market.itemsWithData': z.object({ world: name }),

  'collector.sources': v,
  'collector.selectSource': z.object({ id: z.string().min(1).max(200) }),
  'collector.save': z.object({
    png: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength < 64 * 1024 * 1024, 'imagen vacía o demasiado grande'),
    region: rect.nullable(),
    mode: z.enum(['manual', 'assisted']),
    screenType: screenType.nullable(),
    worldId: id.nullable(),
    itemId: id.nullable(),
  }),
  'collector.import': v,
  'collector.screenshots.list': z.object({ status: z.enum(['new', 'processed', 'confirmed', 'rejected']).nullable(), limit: z.number().int().min(1).max(1_000) }),
  'collector.screenshots.update': z.object({ id: uuid, screenType: screenType.nullable(), worldId: id.nullable(), itemId: id.nullable(), region: rect.nullable() }),
  'collector.screenshots.setStatus': z.object({ id: uuid, status: z.enum(['rejected', 'new']) }),
  'collector.hotkey.set': z.object({ accelerator: z.string().max(64).nullable() }),
  'collector.tibiaFolder.status': v,
  'collector.tibiaFolder.importExisting': z.object({ sinceDays: z.number().positive().max(3_650).nullable() }),
  'collector.tibiaFolder.pick': v,
  'collector.analyze': z.object({ ids: z.array(uuid).max(1_000).nullable() }),

  'watch.status': v,
  'watch.lists': v,
  'watch.lists.save': z.object({ id: id.nullable(), name: z.string().trim().min(1).max(40), notifyLogin: z.boolean(), burstThreshold: z.number().int().min(2).max(100).nullable(), burstWindowSec: z.number().int().min(30).max(3_600) }),
  'watch.lists.delete': z.object({ id }),
  'watch.entries': z.object({ listId: id.nullable() }),
  'watch.entries.add': z.object({ listId: id, kind: z.enum(['character', 'guild']), name: z.string().trim().min(2).max(40), note: z.string().max(200).nullable() }),
  'watch.entries.remove': z.object({ id }),
  'watch.online': v,
  'watch.events': z.object({ limit: z.number().int().min(1).max(1_000) }),
  'watch.scanNow': v,

  'ocr.profiles.list': v,
  'ocr.profiles.save': ocrProfileSchema,
  'ocr.profiles.delete': z.object({ id }),
  'ocr.profiles.export': z.object({ id }),
  'ocr.profiles.import': v,
  'ocr.confirmScan': z.object({
    screenshotId: uuid,
    profileId: id.nullable(),
    worldId: id,
    itemId: id,
    screenType,
    ocrVersion: z.string().max(32),
    parserVersion: z.string().max(32),
    offers: z.array(offer).max(500),
    stats: z.array(
      z.object({ side: z.enum(['buy', 'sell']), transactions: gp.nullable(), avgPrice: gp.nullable(), minPrice: gp.nullable(), maxPrice: gp.nullable(), confidence: z.number().min(0).max(1), corrections: z.array(correction).max(10) }),
    ).max(2),
    itemRead: z.object({ rect, raw: z.string().max(200) }).nullable().optional(),
  }),
  'ocr.identifyItem': z.object({ raw: z.string().max(200) }),

  'analysis.rules': v,
  'analysis.rules.history': z.object({ key: z.string().max(64) }),
  'analysis.rules.add': z.object({ key: z.enum(['market_fee', 'transfer_cost_tc', 'offer_duration_days']), value: z.unknown(), sourceUrl: z.string().max(500).nullable(), notes: z.string().max(2_000).nullable(), verifiedAt: z.string().max(40).nullable() }),
  'analysis.run': z.object({
    origin: name,
    destination: name,
    strategy: z.enum(['instant', 'historical', 'hybrid']),
    budgetGp: gp.nullable(),
    maxQuantityPerItem: z.number().int().positive().nullable(),
    includeThirdParty: z.boolean(),
    maxAgeHours: z.number().positive().nullable(),
  }),
  'analysis.runs.list': z.object({ limit: z.number().int().min(1).max(200) }),
  'analysis.runs.get': z.object({ id: uuid }),
  'analysis.matrix': z.object({ includeThirdParty: z.boolean(), maxAgeHours: z.number().positive().nullable() }),
  'analysis.export': z.object({ runId: uuid, format: z.enum(['csv', 'json']) }),

  'tc.quotes': z.object({ includeThirdParty: z.boolean() }),
  'tc.history': z.object({ world: name, days: z.number().int().min(1).max(365), includeThirdParty: z.boolean() }),

  'transfers.evaluate': z.object({ origin: name, destination: name, profileId: id.nullable() }),
  'transfers.profiles.list': v,
  'transfers.profiles.save': transferProfile,
  'transfers.profiles.delete': z.object({ id }),
  'transfers.manual.list': v,
  'transfers.manual.save': z.object({ origin: name, destination: name, status: routeStatus, reason: z.string().min(1).max(500), sourceUrl: z.string().max(500).nullable(), validUntil: z.string().max(40).nullable() }),
  'transfers.manual.delete': z.object({ id }),

  'cart.build': z.object({ runId: uuid, constraints: cartConstraints }),
  'cart.save': z.object({ name: z.string().trim().min(1).max(80), runId: uuid, cart: z.object({ lines: z.array(z.unknown()) }).passthrough(), constraints: cartConstraints }),
  'cart.list': v,
  'cart.get': z.object({ id: uuid }),
  'cart.delete': z.object({ id: uuid }),
  'cart.export': z.object({ id: uuid, format: z.enum(['csv', 'json']) }),

  'alerts.rules.list': v,
  'alerts.rules.save': z.object({ rule: alertRule, enabled: z.boolean() }),
  'alerts.rules.delete': z.object({ id }),
  'alerts.events.list': z.object({ unreadOnly: z.boolean(), limit: z.number().int().min(1).max(500) }),
  'alerts.events.markRead': z.object({ ids: z.array(id).max(1_000) }),
  'alerts.evaluate': v,
} satisfies Record<Channel, z.ZodType>

export function parseInput<C extends Channel>(channel: C, payload: unknown): In<C> {
  return (schemas[channel] as z.ZodType).parse(payload) as In<C>
}

export const CHANNELS = new Set(Object.keys(schemas))
