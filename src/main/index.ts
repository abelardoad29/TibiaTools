import { readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, Notification, protocol, session, shell } from 'electron'
import type { ApiError, Channel, EventMap, EventName } from '@shared/api'
import { openDatabase, type Db } from './db/database'
import { loadSeeds } from './db/seed'
import { makePaths, type AppContext } from './context'
import { createLogger } from './logging'
import { createHttpClient, ExternalError } from './external/http'
import { createHandlers, type Host } from './ipc/handlers'
import { CHANNELS, parseInput } from './ipc/schemas'
import { itemIcon } from './services/images'
import { screenshotPath } from './services/evidence'
import { getSettings } from './services/settings'
import { refreshCharacters } from './services/tools'
import { runAlerts } from './services/alerts'
import { restoreBackup } from './services/backup'

// Datos en %LOCALAPPDATA%\TibiaTools (no en Roaming: las capturas pueden pesar mucho).
// La caché de Chromium va en una subcarpeta aparte para no mezclarla con los datos.
const DATA_ROOT = join(process.env.LOCALAPPDATA ?? app.getPath('appData'), 'TibiaTools')
app.setPath('userData', join(DATA_ROOT, 'electron'))
app.setAppUserModelId('com.abelardoad29.tibiatools')

protocol.registerSchemesAsPrivileged([
  { scheme: 'tt-img', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'tt-evidence', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

if (!app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let db: Db | null = null
let selectedSourceId: string | null = null
let currentHotkey: string | null = null
const timers: NodeJS.Timeout[] = []

const DEV_URL = process.env.ELECTRON_RENDERER_URL

function isAppUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (DEV_URL) return u.origin === new URL(DEV_URL).origin
    return u.protocol === 'file:'
  } catch {
    return false
  }
}

function emit<E extends EventName>(event: E, payload: EventMap[E]): void {
  win?.webContents.send('event', event, payload)
}

function setHotkey(accelerator: string | null): boolean {
  if (currentHotkey) globalShortcut.unregister(currentHotkey)
  currentHotkey = null
  if (!accelerator) return true
  try {
    // El atajo solo dispara una captura en esta app; no envía nada al cliente de Tibia.
    const ok = globalShortcut.register(accelerator, () => emit('hotkey.capture', undefined))
    if (ok) currentHotkey = accelerator
    return ok
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f1115',
    title: 'Tibia Tools',
    icon: app.isPackaged ? join(process.resourcesPath, 'resources', 'icon.png') : join(app.getAppPath(), 'resources', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // La captura asistida sigue muestreando aunque la ventana no tenga foco.
      backgroundThrottling: false,
    },
  })
  w.once('ready-to-show', () => w.show())
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  if (DEV_URL) void w.loadURL(DEV_URL)
  else void w.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return w
}

function toApiError(e: unknown): ApiError {
  if (e && typeof e === 'object' && 'issues' in e) {
    const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues
    return { code: 'validation', message: issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ') }
  }
  if (e instanceof ExternalError) return { code: 'external', message: e.message }
  return { code: 'internal', message: e instanceof Error ? e.message : String(e) }
}

async function boot(): Promise<void> {
  const paths = makePaths(DATA_ROOT)
  const log = createLogger(paths.logs)
  process.on('uncaughtException', (e) => log.error('uncaughtException', e))
  process.on('unhandledRejection', (e) => log.error('unhandledRejection', e))

  db = openDatabase(paths.db)
  loadSeeds(db)
  const ctx: AppContext = { db, paths, http: createHttpClient(db, log), log, version: app.getVersion(), now: () => new Date() }
  log.info(`Tibia Tools ${ctx.version} iniciado; datos en ${paths.root}`)

  const host: Host = {
    emit,
    openPath: async (p) => void (await shell.openPath(p)),
    pickFiles: async (title, extensions) => {
      const r = await dialog.showOpenDialog(win!, { title, properties: ['openFile', 'multiSelections'], filters: [{ name: 'Archivos', extensions }] })
      return r.canceled ? [] : r.filePaths
    },
    pickSavePath: async (defaultPath, extensions) => {
      const r = await dialog.showSaveDialog(win!, { defaultPath, filters: [{ name: 'Archivos', extensions }] })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    captureSources: async () => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
      return sources.map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen') ? 'screen' : 'window', thumbnail: s.thumbnail.toDataURL() }))
    },
    selectSource: (id) => {
      selectedSourceId = id
    },
    setHotkey,
    restoreBackup: async (file) => {
      const current = ctx.db
      restoreBackup(paths, file, () => current.close(), current)
      log.info(`Respaldo restaurado desde ${file}; reiniciando`)
      app.relaunch()
      app.exit(0)
    },
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
    },
  }
  const handlers = createHandlers(ctx, host)

  ipcMain.handle('api', async (event, channel: unknown, payload: unknown) => {
    if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) return { ok: false, error: { code: 'validation', message: 'Origen no permitido' } }
    if (typeof channel !== 'string' || !CHANNELS.has(channel)) return { ok: false, error: { code: 'validation', message: `Canal desconocido: ${String(channel)}` } }
    try {
      const input = parseInput(channel as Channel, payload)
      const handler = handlers[channel as Channel] as (i: unknown) => unknown
      return { ok: true, data: await handler(input) }
    } catch (e) {
      const err = toApiError(e)
      if (err.code !== 'validation') log.warn(`IPC ${channel}: ${err.message}`)
      return { ok: false, error: err }
    }
  })

  protocol.handle('tt-img', async (req) => {
    const url = new URL(req.url)
    const id = Number(url.pathname.replace(/^\//, ''))
    if (url.host !== 'item' || !Number.isInteger(id)) return new Response(null, { status: 404 })
    const bytes = await itemIcon(ctx, id)
    if (!bytes) return new Response(null, { status: 404 })
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
    return new Response(bytes, { headers: { 'Content-Type': isPng ? 'image/png' : 'image/gif', 'Cache-Control': 'max-age=86400' } })
  })
  protocol.handle('tt-evidence', (req) => {
    const url = new URL(req.url)
    const id = url.pathname.replace(/^\//, '')
    const file = url.host === 'shot' ? screenshotPath(ctx.db, id) : null
    if (!file) return new Response(null, { status: 404 })
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.bmp': 'image/bmp' }[extname(file).toLowerCase()] ?? 'application/octet-stream'
    return new Response(readFileSync(file), { headers: { 'Content-Type': type } })
  })

  // Solo se permite capturar pantalla (getDisplayMedia) desde la propia app; nada más.
  const allowed = new Set(['display-capture', 'media'])
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.has(permission) && isAppUrl(wc.getURL())))
  session.defaultSession.setPermissionCheckHandler((wc, permission) => allowed.has(permission) && !!wc && isAppUrl(wc.getURL()))
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
    const source = sources.find((s) => s.id === selectedSourceId) ?? sources.find((s) => s.id.startsWith('screen'))
    if (source) callback({ video: source })
    else callback({})
  })

  win = createWindow()
  setHotkey(getSettings(ctx.db).collector.hotkey)

  const trackerTick = async () => {
    const s = getSettings(ctx.db)
    const r = await refreshCharacters(ctx)
    if (r.messages.length) {
      emit('characters.updated', { events: r.messages.length })
      if (s.tracker.notify && s.notifications.enabled) host.notify('Personajes', r.messages.slice(0, 3).join('\n'))
    }
  }
  const pollMinutes = Math.max(2, getSettings(ctx.db).tracker.pollMinutes)
  timers.push(setInterval(() => void trackerTick().catch((e) => log.warn('tracker', e)), pollMinutes * 60_000))
  timers.push(
    setInterval(() => {
      try {
        const fired = runAlerts(ctx)
        if (fired.length) {
          emit('alerts.fired', { count: fired.length, messages: fired })
          if (getSettings(ctx.db).notifications.enabled) host.notify('Tibia Tools', fired.slice(0, 3).join('\n'))
        }
      } catch (e) {
        log.warn('alertas', e)
      }
    }, 15 * 60_000),
  )
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(boot).catch((e) => {
  dialog.showErrorBox('Tibia Tools no pudo iniciar', e instanceof Error ? e.message : String(e))
  app.exit(1)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  for (const t of timers) clearInterval(t)
  try {
    db?.close()
  } catch {
    // ya cerrada
  }
})

app.on('window-all-closed', () => app.quit())
