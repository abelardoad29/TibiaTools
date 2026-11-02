// Contrato IPC entre renderer y main. Cada canal declara su entrada y salida; main valida la entrada
// con zod (src/main/ipc/schemas.ts) y el renderer solo habla con main a través de PlatformApi.

import type { Opportunity, Strategy } from '@core/domain/arbitrage/opportunity'
import type { Cart, CartConstraints } from '@core/domain/cart/greedy'
import type { MarketFeeRule } from '@core/domain/money/market-fee'
import type { PriceStats } from '@core/domain/pricing/stats'
import type { TcQuote } from '@core/domain/tc/tc'
import type { ChecklistItem, FinalStatus, TransferProfile } from '@core/domain/transfers/checklist'
import type { RouteEvaluation, RouteStatus, TransferRuleSet } from '@core/domain/transfers/rules'
import type { AlertRule } from '@core/domain/alerts/rules'
import type { CharacterSnapshot } from '@core/domain/tools/characters'
import type { ImbuementDef, ImbuementTier, TierDef } from '@core/domain/tools/imbuements'
import type { OcrProfile, Rect, ScreenType } from '@core/ocr/types'
import type { DataSource } from './provenance'
import type { Settings } from './settings'

// ---------- Entidades ----------

export interface World {
  id: number
  name: string
  region: string | null
  pvpType: string | null
  battleyeProtected: boolean | null
  battleyeDate: string | null
  transferType: string | null
  gameWorldType: string | null
  premiumOnly: boolean | null
  isActive: boolean
  looserTransferConditions: boolean | null
  source: string | null
  verifiedAt: string | null
  updatedAt: string
}

export interface ItemSummary {
  id: number
  tibiaItemId: number | null
  name: string
  category: string | null
  tier: number | null
  iconUrl: string
}

export interface NpcTrade {
  name: string
  location: string
  price: number
  currencyId: number
}

export interface ItemDetail extends ItemSummary {
  wikiName: string | null
  weightOz: number | null
  stackSize: number | null
  npcBuy: NpcTrade[]
  npcSell: NpcTrade[]
  iconStatus: string
  source: string | null
}

export interface OfferView {
  unitPrice: number
  amount: number
  totalPrice: number | null
  expiresAt: string | null
  priceConfidence: number | null
  amountConfidence: number | null
}

export interface BookView {
  scanId: string
  side: 'buy' | 'sell'
  source: DataSource
  observedAt: string
  confidence: number | null
  offers: OfferView[]
}

export interface StatsRow {
  side: 'buy' | 'sell'
  window: '30d' | '1d'
  transactions: number | null
  avgPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  source: DataSource
  observedAt: string
}

export interface EventRow {
  id: number
  type: string
  side: string
  price: number | null
  quantity: number | null
  confidence: number
  note: string
  detectedAt: string
}

export interface ScanSummary {
  id: string
  world: string
  itemId: number
  itemName: string
  scanType: string
  source: DataSource
  observedAt: string
  reviewStatus: string
  confidence: number | null
  offers: number
}

export interface Screenshot {
  id: string
  url: string
  capturedAtUtc: string
  capturedAtLocal: string
  width: number
  height: number
  sha256: string
  sourceMode: 'manual' | 'assisted' | 'import'
  region: Rect | null
  screenType: ScreenType | null
  worldId: number | null
  itemId: number | null
  status: 'new' | 'processed' | 'confirmed' | 'rejected'
}

export interface TibiaFolderStatus {
  path: string
  exists: boolean
  watching: boolean
  imported: number
  lastFile: string | null
  matchingFiles: number
  error: string | null
}

export interface CaptureSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
}

export interface TrackedCharacter {
  id: number
  name: string
  world: string | null
  level: number | null
  vocation: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

export interface CharacterEventRow {
  id: number
  character: string
  type: string
  message: string
  occurredAt: string | null
  detectedAt: string
}

export interface RuleVersion<T = unknown> {
  id: number
  key: string
  value: T
  sourceUrl: string | null
  effectiveFrom: string | null
  verifiedAt: string | null
  notes: string | null
  createdAt: string
}

export interface AlertEventRow {
  id: number
  ruleId: number
  message: string
  firedAt: string
  readAt: string | null
}

export interface StoredAlertRule {
  rule: AlertRule
  enabled: boolean
  createdAt: string
}

export interface ConfirmOfferInput {
  side: 'buy' | 'sell'
  rowIndex: number
  unitPrice: number
  amount: number
  totalPrice: number | null
  expirationText: string | null
  rawPriceText: string
  rawAmountText: string
  priceConfidence: number
  amountConfidence: number
  corrections: { field: string; raw: string; ocrValue: string; corrected: string }[]
}

export interface ConfirmStatsInput {
  side: 'buy' | 'sell'
  transactions: number | null
  avgPrice: number | null
  minPrice: number | null
  maxPrice: number | null
  confidence: number
  corrections: { field: string; raw: string; ocrValue: string; corrected: string }[]
}

export interface ConfirmScanInput {
  screenshotId: string
  profileId: number | null
  worldId: number
  itemId: number
  screenType: ScreenType
  ocrVersion: string
  parserVersion: string
  offers: ConfirmOfferInput[]
  stats: ConfirmStatsInput[]
}

export interface AnalysisRequest {
  origin: string
  destination: string
  strategy: Strategy
  budgetGp: number | null
  maxQuantityPerItem: number | null
  /** Incluir datos de tibiamarket (etiquetados). */
  includeThirdParty: boolean
  /** Ignorar snapshots más viejos que esto (horas); null = sin límite. */
  maxAgeHours: number | null
}

export interface TransferCostEstimate {
  tc: number | null
  type: 'regular' | 'express'
  gp: number | null
  method: string
  observedAt: string | null
  warnings: string[]
}

export interface AnalysisResult {
  runId: string
  origin: string
  destination: string
  strategy: Strategy
  startedAt: string
  itemsConsidered: number
  opportunities: Opportunity[]
  route: RouteEvaluation
  transferCost: TransferCostEstimate
  feeRule: MarketFeeRule
  warnings: string[]
}

export interface RouteMatrixCell {
  origin: string
  destination: string
  status: RouteStatus
  commonItems: number
  bestInstantProfit: number | null
  opportunities: number
}

export interface TcWorldQuote extends TcQuote {
  world: string
  observedAt: string | null
  source: DataSource | null
  buyDepth: number
  sellDepth: number
}

export interface SavedCartSummary {
  id: string
  name: string
  runId: string | null
  createdAt: string
  netProfit: number | null
  lines: number
}

export interface ImbuementCatalog {
  tiers: TierDef[]
  imbuements: ImbuementDef[]
  tokenTradeable: string[]
  tokensPerTier: Record<ImbuementTier, number>
  durationHours: number
  source: string
  notes: string
}

export interface BoostedInfo {
  creature: { name: string; imageUrl: string | null } | null
  boss: { name: string; imageUrl: string | null } | null
  fetchedAt: string | null
  source: string
  error: string | null
}

export interface AppInfo {
  version: string
  platform: 'electron' | 'web'
  dataDir: string
  dbPath: string
  schemaVersion: number
  counts: { worlds: number; items: number; scans: number; screenshots: number; ownScans: number; thirdPartyScans: number }
  seeds: { items: string | null; worlds: string | null; imbuements: string | null }
}

export interface ImportResult {
  scans: number
  offers: number
  stats: number
  skipped: number
  errors: string[]
}

// ---------- Mapa de canales ----------

export interface ApiMap {
  'app.info': { in: void; out: AppInfo }
  'app.settings.get': { in: void; out: Settings }
  'app.settings.set': { in: Partial<Settings>; out: Settings }
  'app.backup.create': { in: void; out: { path: string } }
  'app.backup.list': { in: void; out: { name: string; path: string; size: number; createdAt: string }[] }
  'app.backup.restore': { in: { path: string }; out: { restarted: boolean } }
  'app.openFolder': { in: { target: 'data' | 'evidence' | 'backups' | 'exports' | 'logs' }; out: void }
  'app.logs.tail': { in: { lines: number }; out: string[] }

  'catalog.worlds.list': { in: { activeOnly: boolean }; out: World[] }
  'catalog.worlds.sync': { in: void; out: { updated: number; fetchedAt: string } }
  'catalog.worlds.update': { in: { name: string; looserTransferConditions: boolean | null }; out: World }
  'catalog.items.search': { in: { q: string; category: string | null; limit: number }; out: ItemSummary[] }
  'catalog.items.get': { in: { id: number }; out: ItemDetail | null }
  'catalog.items.byName': { in: { names: string[] }; out: ItemSummary[] }
  'catalog.items.categories': { in: void; out: { category: string; count: number }[] }
  'catalog.items.update': { in: { id: number; weightOz: number | null; stackSize: number | null; iconOverrideUrl: string | null }; out: ItemDetail }
  'catalog.icons.stats': { in: void; out: { total: number; cached: number; failed: number; unknown: number } }
  'catalog.icons.prefetch': { in: { category: string | null }; out: { queued: number } }

  'tools.boosted': { in: { refresh: boolean }; out: BoostedInfo }
  'tools.character': { in: { name: string }; out: CharacterSnapshot | null }
  'tools.imbuements': { in: void; out: ImbuementCatalog }
  'tools.imbuements.prices': { in: { world: string; items: string[] }; out: Record<string, { price: number; observedAt: string; source: DataSource } | null> }

  'characters.list': { in: void; out: TrackedCharacter[] }
  'characters.add': { in: { name: string }; out: TrackedCharacter }
  'characters.remove': { in: { id: number }; out: void }
  'characters.events': { in: { limit: number }; out: CharacterEventRow[] }
  'characters.refresh': { in: void; out: { checked: number; events: number } }

  'market.thirdParty.import': { in: { world: string; itemIds: number[] | null }; out: ImportResult }
  'market.thirdParty.worlds': { in: void; out: { world: string; lastUpdate: string }[] }
  'market.scans.list': { in: { world: string | null; itemId: number | null; source: DataSource | null; limit: number }; out: ScanSummary[] }
  'market.book': { in: { world: string; itemId: number; includeThirdParty: boolean }; out: { sell: BookView | null; buy: BookView | null; stats: StatsRow[] } }
  'market.history': {
    in: { world: string; itemId: number; days: number; includeThirdParty: boolean }
    out: {
      points: { observedAt: string; bestSell: number | null; bestBuy: number | null; source: DataSource }[]
      sellStats: PriceStats
      buyStats: PriceStats
      official: StatsRow[]
      events: EventRow[]
    }
  }
  'market.coverage': { in: void; out: { world: string; scans: number; items: number; ownScans: number; thirdPartyScans: number; lastObservedAt: string | null }[] }
  'market.itemsWithData': { in: { world: string }; out: ItemSummary[] }

  'collector.sources': { in: void; out: CaptureSource[] }
  'collector.selectSource': { in: { id: string }; out: void }
  'collector.save': { in: { png: Uint8Array; region: Rect | null; mode: 'manual' | 'assisted'; screenType: ScreenType | null; worldId: number | null; itemId: number | null }; out: Screenshot }
  'collector.import': { in: void; out: { imported: Screenshot[]; errors: string[] } }
  'collector.screenshots.list': { in: { status: Screenshot['status'] | null; limit: number }; out: Screenshot[] }
  'collector.screenshots.update': { in: { id: string; screenType: ScreenType | null; worldId: number | null; itemId: number | null; region: Rect | null }; out: Screenshot }
  'collector.screenshots.setStatus': { in: { id: string; status: 'rejected' | 'new' }; out: Screenshot }
  'collector.hotkey.set': { in: { accelerator: string | null }; out: { registered: boolean } }
  'collector.tibiaFolder.status': { in: void; out: TibiaFolderStatus }
  'collector.tibiaFolder.importExisting': { in: { sinceDays: number | null }; out: { imported: Screenshot[]; skipped: number; errors: string[] } }
  'collector.tibiaFolder.pick': { in: void; out: { path: string } | null }

  'ocr.profiles.list': { in: void; out: OcrProfile[] }
  'ocr.profiles.save': { in: OcrProfile; out: OcrProfile }
  'ocr.profiles.delete': { in: { id: number }; out: void }
  'ocr.profiles.export': { in: { id: number }; out: { path: string } | null }
  'ocr.profiles.import': { in: void; out: OcrProfile | null }
  'ocr.confirmScan': { in: ConfirmScanInput; out: { scanIds: string[]; events: number } }

  'analysis.rules': { in: void; out: { marketFee: RuleVersion<MarketFeeRule>; offerDurationDays: RuleVersion<number>; transferCostTc: RuleVersion<{ regular: number | null; express: number | null }>; transferRules: TransferRuleSet } }
  'analysis.rules.history': { in: { key: string }; out: RuleVersion[] }
  'analysis.rules.add': { in: { key: 'market_fee' | 'transfer_cost_tc' | 'offer_duration_days'; value: unknown; sourceUrl: string | null; notes: string | null; verifiedAt: string | null }; out: RuleVersion }
  'analysis.run': { in: AnalysisRequest; out: AnalysisResult }
  'analysis.runs.list': { in: { limit: number }; out: { id: string; origin: string; destination: string; strategy: string; startedAt: string; opportunities: number }[] }
  'analysis.runs.get': { in: { id: string }; out: AnalysisResult | null }
  'analysis.matrix': { in: { includeThirdParty: boolean; maxAgeHours: number | null }; out: RouteMatrixCell[] }
  'analysis.export': { in: { runId: string; format: 'csv' | 'json' }; out: { path: string } | null }

  'tc.quotes': { in: { includeThirdParty: boolean }; out: TcWorldQuote[] }
  'tc.history': { in: { world: string; days: number; includeThirdParty: boolean }; out: { observedAt: string; bestBuy: number | null; bestSell: number | null; source: DataSource }[] }

  'transfers.evaluate': { in: { origin: string; destination: string; profileId: number | null }; out: { route: RouteEvaluation; checklist: ChecklistItem[]; final: FinalStatus; cost: TransferCostEstimate } }
  'transfers.profiles.list': { in: void; out: (TransferProfile & { id: number })[] }
  'transfers.profiles.save': { in: TransferProfile & { id: number | null }; out: TransferProfile & { id: number } }
  'transfers.profiles.delete': { in: { id: number }; out: void }
  'transfers.manual.list': { in: void; out: { id: number; origin: string; destination: string; status: RouteStatus; reason: string; sourceUrl: string | null; verifiedAt: string; validUntil: string | null }[] }
  'transfers.manual.save': { in: { origin: string; destination: string; status: RouteStatus; reason: string; sourceUrl: string | null; validUntil: string | null }; out: void }
  'transfers.manual.delete': { in: { id: number }; out: void }

  'cart.build': { in: { runId: string; constraints: CartConstraints }; out: Cart[] }
  'cart.save': { in: { name: string; runId: string; cart: Cart; constraints: CartConstraints }; out: { id: string } }
  'cart.list': { in: void; out: SavedCartSummary[] }
  'cart.get': { in: { id: string }; out: { summary: SavedCartSummary; cart: Cart; constraints: CartConstraints } | null }
  'cart.delete': { in: { id: string }; out: void }
  'cart.export': { in: { id: string; format: 'csv' | 'json' }; out: { path: string } | null }

  'alerts.rules.list': { in: void; out: StoredAlertRule[] }
  'alerts.rules.save': { in: { rule: AlertRule; enabled: boolean }; out: StoredAlertRule }
  'alerts.rules.delete': { in: { id: number }; out: void }
  'alerts.events.list': { in: { unreadOnly: boolean; limit: number }; out: AlertEventRow[] }
  'alerts.events.markRead': { in: { ids: number[] }; out: void }
  'alerts.evaluate': { in: void; out: { fired: number } }
}

export type Channel = keyof ApiMap
export type In<C extends Channel> = ApiMap[C]['in']
export type Out<C extends Channel> = ApiMap[C]['out']

/** Eventos que main envía al renderer. */
export interface EventMap {
  'hotkey.capture': void
  'alerts.fired': { count: number; messages: string[] }
  'characters.updated': { events: number }
  'icons.progress': { done: number; total: number }
  'collector.imported': { count: number }
}
export type EventName = keyof EventMap

/** Error serializable devuelto por IPC. */
export interface ApiError {
  code: 'validation' | 'not_found' | 'unavailable' | 'external' | 'internal'
  message: string
}
