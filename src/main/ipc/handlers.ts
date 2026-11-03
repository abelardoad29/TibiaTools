import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiMap, CaptureSource, Channel, EventMap, EventName, In, Out } from '@shared/api'
import type { Settings } from '@shared/settings'
import type { OcrProfile } from '@core/ocr/types'
import imbuementsSeed from '@seed/imbuements.json'
import { get, run, schemaVersion } from '../db/database'
import { seedInfo } from '../db/seed'
import type { AppContext } from '../context'
import * as catalog from '../services/catalog'
import * as images from '../services/images'
import * as market from '../services/market'
import * as evidence from '../services/evidence'
import * as scans from '../services/scans'
import * as analysis from '../services/analysis'
import * as tools from '../services/tools'
import * as alerts from '../services/alerts'
import * as backup from '../services/backup'
import * as bosses from '../services/bosses'
import { getSettings, setSettings } from '../services/settings'
import { tibiaData } from '../external/tibiadata'
import { tibiaMarket } from '../external/tibiamarket'
import type { TibiaFolderWatcher } from '../services/tibia-folder'
import * as marketOcr from '../services/market-ocr'
import type { MarketAnalyzer } from '../services/market-ocr'
import * as watch from '../services/watch'
import type { ScanResult, Watcher } from '../services/watch'
import type { ThirdPartySync } from '../services/third-party-sync'
import { ocrProfileSchema } from './schemas'

/** Capacidades que dependen de Electron (diálogos, captura, atajos, notificaciones). */
export interface Host {
  emit<E extends EventName>(event: E, payload: EventMap[E]): void
  openPath(path: string): Promise<void>
  pickFiles(title: string, extensions: string[]): Promise<string[]>
  pickSavePath(defaultName: string, extensions: string[]): Promise<string | null>
  captureSources(): Promise<CaptureSource[]>
  selectSource(id: string): void
  setHotkey(accelerator: string | null): boolean
  pickFolder(title: string): Promise<string | null>
  tibiaFolder: TibiaFolderWatcher
  marketOcr: MarketAnalyzer
  watcher: Watcher
  onWatchResult(r: ScanResult): void
  thirdPartySync: ThirdPartySync
  restoreBackup(path: string): Promise<void>
  notify(title: string, body: string): void
}

type Handlers = { [C in Channel]: (input: In<C>) => Out<C> | Promise<Out<C>> }

export function createHandlers(ctx: AppContext, host: Host): Handlers {
  const { db } = ctx
  const settings = (): Settings => getSettings(db)
  const count = (sql: string) => get<{ n: number }>(db, sql)?.n ?? 0

  return {
    'app.info': () => {
      const seeds = seedInfo(db)
      return {
        version: ctx.version,
        platform: 'electron',
        dataDir: ctx.paths.root,
        dbPath: ctx.paths.db,
        schemaVersion: schemaVersion(db),
        counts: {
          worlds: count('SELECT COUNT(*) AS n FROM worlds WHERE is_active = 1'),
          items: count('SELECT COUNT(*) AS n FROM items'),
          scans: count(`SELECT COUNT(*) AS n FROM market_scans WHERE review_status = 'accepted'`),
          screenshots: count('SELECT COUNT(*) AS n FROM screenshots'),
          ownScans: count(`SELECT COUNT(*) AS n FROM market_scans WHERE source = 'own_capture' AND review_status = 'accepted'`),
          thirdPartyScans: count(`SELECT COUNT(*) AS n FROM market_scans WHERE source = 'third_party'`),
        },
        seeds: { items: seeds.items ?? null, worlds: seeds.worlds ?? null, imbuements: imbuementsSeed.parsedAt },
      }
    },
    'app.settings.get': () => settings(),
    'app.settings.set': (patch) => {
      const next = setSettings(db, patch)
      if ('collector' in patch) {
        host.setHotkey(next.collector.hotkey)
        host.tibiaFolder.restart()
      }
      if ('watch' in patch) host.watcher.restart()
      if ('network' in patch) host.thirdPartySync.reschedule()
      return next
    },
    'app.backup.create': () => ({ path: backup.createBackup(db, ctx.paths) }),
    'app.backup.list': () => backup.listBackups(ctx.paths),
    'app.backup.restore': async ({ path }) => {
      backup.validateBackup(path)
      await host.restoreBackup(path)
      return { restarted: true }
    },
    'app.openFolder': ({ target }) => host.openPath(target === 'data' ? ctx.paths.root : ctx.paths[target === 'evidence' ? 'evidence' : target]),
    'app.logs.tail': ({ lines }) => ctx.log.tail(lines),

    'catalog.worlds.list': ({ activeOnly }) => catalog.listWorlds(db, activeOnly),
    'catalog.worlds.sync': () => catalog.syncWorlds(ctx),
    'catalog.worlds.update': ({ name, looserTransferConditions }) => catalog.setLooserConditions(db, name, looserTransferConditions),
    'catalog.worlds.live': () => catalog.liveWorlds(ctx),
    'catalog.worlds.detail': ({ name }) => catalog.worldDetail(ctx, name),
    'bosses.outlook': ({ world }) => bosses.bossesOutlook(ctx, world),
    'bosses.history': ({ world, boss }) => bosses.bossHistory(ctx, world, boss),
    'catalog.items.search': ({ q, category, limit }) => catalog.searchItems(db, q, category, limit),
    'catalog.items.get': ({ id }) => catalog.getItem(db, id),
    'catalog.items.byName': ({ names }) => catalog.itemsByName(db, names),
    'catalog.items.categories': () => catalog.categories(db),
    'catalog.items.update': ({ id, ...patch }) => catalog.updateItem(db, id, patch),
    'catalog.icons.stats': () => images.iconStats(ctx),
    'catalog.icons.prefetch': ({ category }) => ({ queued: images.prefetchIcons(ctx, category, (done, total) => host.emit('icons.progress', { done, total })) }),

    'tools.boosted': ({ refresh }) => tools.boosted(ctx, refresh),
    'tools.character': ({ name }) => tibiaData(ctx.http).character(name),
    'tools.imbuements': () => tools.imbuements(),
    'tools.imbuable': () => tools.imbuable(db),
    'tools.imbuements.prices': ({ world, items }) => tools.imbuementPrices(db, world, items),

    'characters.list': () => tools.listCharacters(db),
    'characters.add': ({ name }) => tools.addCharacter(ctx, name),
    'characters.remove': ({ id }) => tools.removeCharacter(db, id),
    'characters.events': ({ limit }) => tools.characterEvents(db, limit),
    'characters.refresh': async () => {
      const r = await tools.refreshCharacters(ctx)
      if (r.messages.length) host.emit('characters.updated', { events: r.messages.length })
      return { checked: r.checked, events: r.messages.length }
    },

    'market.thirdParty.import': ({ world, itemIds }) => {
      if (!settings().network.thirdPartyEnabled) throw new Error('Los datos de terceros están desactivados en Ajustes')
      return market.importThirdParty(ctx, world, itemIds)
    },
    'market.thirdParty.worlds': () => tibiaMarket(ctx.http).worlds(),
    'market.thirdParty.sync': ({ worlds, force }) => {
      if (!settings().network.thirdPartyEnabled) throw new Error('Los datos de terceros están desactivados en Ajustes')
      return host.thirdPartySync.start({ worlds, force })
    },
    'market.thirdParty.cancel': () => host.thirdPartySync.cancel(),
    'market.thirdParty.status': () => ({ status: host.thirdPartySync.status(), worlds: host.thirdPartySync.worlds() }),
    'market.scans.list': (f) => market.listScans(db, f),
    'market.book': ({ world, itemId, includeThirdParty }) => market.bookView(db, world, itemId, includeThirdParty),
    'market.history': ({ world, itemId, days, includeThirdParty }) => market.history(db, world, itemId, days, includeThirdParty),
    'market.coverage': () => market.coverage(db),
    'market.itemsWithData': ({ world }) => market.itemsWithData(db, world),

    'collector.sources': () => host.captureSources(),
    'collector.selectSource': ({ id }) => host.selectSource(id),
    'collector.save': ({ png, region, mode, screenType, worldId, itemId }) =>
      evidence.saveEvidence(ctx, png, { mode, ext: '.png', region, screenType, worldId, itemId, maxPixels: settings().collector.maxImagePixels }),
    'collector.import': async () => {
      const files = await host.pickFiles('Importar capturas del Market', ['png', 'jpg', 'jpeg', 'bmp'])
      const s = settings().collector
      return evidence.importFiles(ctx, files, s.maxImportMb, s.maxImagePixels)
    },
    'collector.screenshots.list': ({ status, limit }) => evidence.listScreenshots(db, status, limit),
    'collector.screenshots.update': ({ id, ...patch }) => evidence.updateScreenshot(db, id, patch),
    'collector.screenshots.setStatus': ({ id, status }) => evidence.setScreenshotStatus(db, id, status),
    'collector.hotkey.set': ({ accelerator }) => {
      const registered = host.setHotkey(accelerator)
      setSettings(db, { collector: { ...settings().collector, hotkey: accelerator } })
      return { registered }
    },

    'collector.tibiaFolder.status': () => host.tibiaFolder.status(),
    'collector.tibiaFolder.importExisting': ({ sinceDays }) => host.tibiaFolder.importExisting(sinceDays),
    'collector.analyze': ({ ids }) => host.marketOcr.analyze(ids),
    'collector.tibiaFolder.pick': async () => {
      const path = await host.pickFolder('Carpeta de screenshots de Tibia')
      if (!path) return null
      const c = settings().collector
      setSettings(db, { collector: { ...c, tibiaFolder: { ...c.tibiaFolder, path } } })
      host.tibiaFolder.restart()
      return { path }
    },

    'watch.status': () => host.watcher.status(),
    'watch.lists': () => watch.listWatchLists(db),
    'watch.lists.save': (l) => watch.saveWatchList(db, l),
    'watch.lists.delete': ({ id }) => void run(db, 'DELETE FROM watch_lists WHERE id = ?', [id]),
    'watch.entries': ({ listId }) => watch.listWatchEntries(db, listId),
    'watch.entries.add': async (e) => {
      const entry = await watch.addWatchEntry(ctx, e)
      // Arranca la vigilancia si era la primera entrada.
      if (!host.watcher.status().running) host.watcher.restart()
      return entry
    },
    'watch.entries.remove': ({ id }) => void run(db, 'DELETE FROM watch_entries WHERE id = ?', [id]),
    'watch.online': () => watch.listWatchOnline(db),
    'watch.events': ({ limit }) => watch.listWatchEvents(db, limit),
    'watch.scanNow': async () => {
      const r = await host.watcher.scan()
      host.onWatchResult(r)
      return { logins: r.logins, logouts: r.logouts, bursts: r.bursts }
    },

    'ocr.profiles.list': () => scans.listProfiles(db),
    'ocr.profiles.save': (p) => scans.saveProfile(db, p),
    'ocr.profiles.delete': ({ id }) => scans.deleteProfile(db, id),
    'ocr.profiles.export': async ({ id }) => {
      const p = scans.getProfile(db, id)
      if (!p) throw new Error('Perfil no encontrado')
      const target = await host.pickSavePath(join(ctx.paths.exports, `perfil-ocr-${p.name.replace(/[^\w-]+/g, '_')}-v${p.version}.json`), ['json'])
      if (!target) return null
      writeFileSync(target, JSON.stringify({ format: 'tibia-tools-ocr-profile', ...p }, null, 2), 'utf8')
      return { path: target }
    },
    'ocr.profiles.import': async () => {
      const [file] = await host.pickFiles('Importar perfil OCR', ['json'])
      if (!file) return null
      const parsed = ocrProfileSchema.parse({ ...JSON.parse(readFileSync(file, 'utf8')), id: null }) as OcrProfile
      return scans.saveProfile(db, parsed)
    },
    'ocr.confirmScan': (input) => {
      const profile = input.profileId ? scans.getProfile(db, input.profileId) : null
      const sides = profile ? [...new Set(profile.tables.map((t) => t.side))] : [...new Set(input.offers.map((o) => o.side))]
      const r = scans.confirmScan(db, input, sides.length ? sides : ['sell'])
      // El usuario confirmó el item: si el OCR no leyó bien su nombre, se aprenden esas letras para la próxima.
      if (input.itemRead && input.profileId) {
        const name = get<{ name: string }>(db, 'SELECT name FROM items WHERE id = ?', [input.itemId])?.name
        if (name && name !== input.itemRead.raw) {
          try {
            marketOcr.learnItemName(db, input.profileId, input.screenshotId, input.itemRead.rect, name)
          } catch (e) {
            ctx.log.warn('No se pudieron aprender letras del item', e)
          }
        }
      }
      const fired = alerts.runAlerts(ctx)
      if (fired.length) {
        host.emit('alerts.fired', { count: fired.length, messages: fired })
        if (settings().notifications.enabled) host.notify('Tibia Tools', fired.slice(0, 3).join('\n'))
      }
      return r
    },

    'ocr.identifyItem': ({ raw }) => marketOcr.identify(db, raw),

    'analysis.rules': () => analysis.rulesBundle(db),
    'analysis.rules.history': ({ key }) => analysis.ruleHistory(db, key),
    'analysis.rules.add': ({ key, value, sourceUrl, notes, verifiedAt }) => analysis.addRule(db, key, value, sourceUrl, notes, verifiedAt),
    'analysis.run': (req) => analysis.runAnalysis(ctx, req, settings()),
    'analysis.runs.list': ({ limit }) => analysis.listRuns(db, limit),
    'analysis.runs.get': ({ id }) => analysis.getRun(db, id),
    'analysis.matrix': ({ includeThirdParty, maxAgeHours }) => analysis.routeMatrix(ctx, includeThirdParty, maxAgeHours),
    'analysis.export': ({ runId, format }) => ({ path: analysis.exportRun(ctx, runId, format) }),

    'tc.quotes': ({ includeThirdParty }) => analysis.tcQuotes(ctx, includeThirdParty),
    'tc.history': ({ world, days, includeThirdParty }) => analysis.tcHistory(ctx, world, days, includeThirdParty),

    'transfers.evaluate': ({ origin, destination, profileId }) => analysis.evaluateTransfer(ctx, origin, destination, profileId),
    'transfers.profiles.list': () => analysis.listTransferProfiles(db),
    'transfers.profiles.save': (p) => analysis.saveTransferProfile(db, p),
    'transfers.profiles.delete': ({ id }) => void run(db, 'DELETE FROM transfer_profiles WHERE id = ?', [id]),
    'transfers.manual.list': () => analysis.listManualRules(db),
    'transfers.manual.save': (r) => analysis.saveManualRule(db, r),
    'transfers.manual.delete': ({ id }) => void run(db, 'DELETE FROM transfer_rules WHERE id = ?', [id]),

    'cart.build': ({ runId, constraints }) => analysis.buildCarts(ctx, runId, constraints),
    'cart.save': ({ name, runId, cart, constraints }) => ({ id: analysis.saveCart(db, name, runId, cart as unknown as ApiMap['cart.save']['in']['cart'], constraints) }),
    'cart.list': () => analysis.listCarts(db),
    'cart.get': ({ id }) => analysis.getCart(db, id),
    'cart.delete': ({ id }) => void run(db, 'DELETE FROM saved_carts WHERE id = ?', [id]),
    'cart.export': ({ id, format }) => ({ path: analysis.exportCart(ctx, id, format) }),

    'alerts.rules.list': () => alerts.listAlertRules(db),
    'alerts.rules.save': ({ rule, enabled }) => alerts.saveAlertRule(db, rule, enabled),
    'alerts.rules.delete': ({ id }) => void run(db, 'DELETE FROM alert_rules WHERE id = ?', [id]),
    'alerts.events.list': ({ unreadOnly, limit }) => alerts.listAlertEvents(db, unreadOnly, limit),
    'alerts.events.markRead': ({ ids }) => {
      for (const id of ids) run(db, 'UPDATE alert_events SET read_at = COALESCE(read_at, ?) WHERE id = ?', [new Date().toISOString(), id])
    },
    'alerts.evaluate': () => {
      const fired = alerts.runAlerts(ctx)
      if (fired.length) host.emit('alerts.fired', { count: fired.length, messages: fired })
      return { fired: fired.length }
    },
  }
}

