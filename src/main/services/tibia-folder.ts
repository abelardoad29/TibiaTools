import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { Screenshot, TibiaFolderStatus } from '@shared/api'
import type { AppContext } from '../context'
import { saveEvidenceDetailed } from './evidence'
import { getSettings } from './settings'

// Importa los screenshots que el propio cliente de Tibia guarda en su carpeta. Es la vía recomendada:
// capturar la ventana del juego puede salir en negro por la aceleración de GPU.
// Nombre de archivo del cliente: 2026-11-02_094500772_<Personaje>_<Tipo>.png (Tipo: Hotkey, LevelUp, …).

export const DEFAULT_TIBIA_SCREENSHOTS = join(process.env.LOCALAPPDATA ?? '', 'Tibia', 'packages', 'Tibia', 'screenshots')
const NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(\d{3})_(.+)_([A-Za-z]+)\.png$/i

export interface TibiaScreenshotName {
  takenAt: Date
  character: string
  type: string
}

export function parseTibiaScreenshot(file: string): TibiaScreenshotName | null {
  const m = NAME.exec(file)
  if (!m) return null
  const [, y, mo, d, h, mi, s, ms, character, type] = m
  // La hora del nombre es la hora local del equipo donde corre el cliente.
  return { takenAt: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms)), character: character!, type: type! }
}

export interface TibiaFolderWatcher {
  restart(): void
  stop(): void
  status(): TibiaFolderStatus
  importExisting(sinceDays: number | null): { imported: Screenshot[]; skipped: number; errors: string[] }
}

const waitStable = async (file: string) => {
  // El cliente escribe el PNG en varios pasos: se espera a que el tamaño deje de cambiar.
  let last = -1
  for (let i = 0; i < 20; i++) {
    const size = existsSync(file) ? statSync(file).size : -1
    if (size > 0 && size === last) return true
    last = size
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

export function createTibiaFolderWatcher(ctx: AppContext, onImported: (shots: Screenshot[]) => void): TibiaFolderWatcher {
  let watcher: FSWatcher | null = null
  let imported = 0
  let lastFile: string | null = null
  let error: string | null = null
  const pending = new Set<string>()

  const config = () => {
    const c = getSettings(ctx.db).collector.tibiaFolder
    return { ...c, path: c.path ?? DEFAULT_TIBIA_SCREENSHOTS }
  }
  const wanted = (file: string, types: string[]) => {
    const n = parseTibiaScreenshot(file)
    return n && (types.length === 0 || types.some((t) => t.toLowerCase() === n.type.toLowerCase())) ? n : null
  }
  /** Devuelve la captura si es nueva, o null si ya estaba importada (mismo SHA-256). */
  const importFile = (dir: string, file: string, n: TibiaScreenshotName): Screenshot | null => {
    const s = getSettings(ctx.db).collector
    const { shot, created } = saveEvidenceDetailed(ctx, new Uint8Array(readFileSync(join(dir, file))), {
      mode: 'import',
      ext: '.png',
      region: null,
      screenType: null,
      worldId: null,
      itemId: null,
      maxPixels: s.maxImagePixels,
      capturedAt: n.takenAt,
      notes: `Tibia: ${n.character} · ${n.type} · ${file}`,
    })
    if (!created) return null
    imported++
    lastFile = file
    return shot
  }

  return {
    restart() {
      watcher?.close()
      watcher = null
      error = null
      const c = config()
      if (!c.enabled) return
      if (!existsSync(c.path)) {
        error = 'La carpeta no existe'
        return
      }
      try {
        watcher = watch(c.path, (_event, filename) => {
          if (!filename || pending.has(filename)) return
          const n = wanted(filename, config().types)
          if (!n) return
          pending.add(filename)
          void waitStable(join(c.path, filename))
            .then((ok) => {
              if (!ok) return
              const shot = importFile(c.path, filename, n)
              if (shot) onImported([shot])
            })
            .catch((e) => ctx.log.warn(`No se pudo importar ${filename}`, e))
            .finally(() => pending.delete(filename))
        })
        watcher.on('error', (e) => {
          error = e.message
          ctx.log.warn('Watcher de screenshots de Tibia', e)
        })
      } catch (e) {
        error = e instanceof Error ? e.message : String(e)
      }
    },
    stop() {
      watcher?.close()
      watcher = null
    },
    status() {
      const c = config()
      const exists = existsSync(c.path)
      return {
        path: c.path,
        exists,
        watching: watcher !== null,
        imported,
        lastFile,
        matchingFiles: exists ? readdirSync(c.path).filter((f) => wanted(f, c.types)).length : 0,
        error,
      }
    },
    importExisting(sinceDays) {
      const c = config()
      if (!existsSync(c.path)) return { imported: [], skipped: 0, errors: [`No existe la carpeta ${c.path}`] }
      const since = sinceDays === null ? 0 : Date.now() - sinceDays * 86_400_000
      const out: Screenshot[] = []
      const errors: string[] = []
      let skipped = 0
      for (const file of readdirSync(c.path)) {
        const n = wanted(file, c.types)
        if (!n || n.takenAt.getTime() < since) continue
        try {
          const shot = importFile(c.path, file, n)
          if (shot) out.push(shot)
          else skipped++
        } catch (e) {
          errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      if (out.length) onImported(out)
      return { imported: out, skipped, errors }
    },
  }
}
