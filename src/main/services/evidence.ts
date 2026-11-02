import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Screenshot } from '@shared/api'
import type { Rect, ScreenType } from '@core/ocr/types'
import { all, get, nowIso, parseJson, run, type Db } from '../db/database'
import type { AppContext } from '../context'

// Evidencia: la captura original se guarda tal cual (nunca se modifica) con su SHA-256.

export const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.bmp'] as const

/** Lee ancho/alto de la cabecera sin decodificar la imagen. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; format: 'png' | 'jpeg' | 'bmp' } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: dv.getUint32(16), height: dv.getUint32(20), format: 'png' }
  }
  if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)), format: 'bmp' }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      const marker = bytes[i + 1]!
      const len = dv.getUint16(i + 2)
      // SOF0..SOF15 salvo DHT(C4), JPG(C8) y DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7), format: 'jpeg' }
      }
      i += 2 + len
    }
  }
  return null
}

interface ScreenshotRow {
  id: string
  original_path: string
  captured_at_utc: string
  captured_at_local: string
  sha256: string
  width: number
  height: number
  region_json: string | null
  screen_type: ScreenType | null
  world_id: number | null
  item_id: number | null
  processing_status: Screenshot['status']
  source_mode: Screenshot['sourceMode'] | null
}

const SELECT = `SELECT sc.*, cs.source_mode FROM screenshots sc LEFT JOIN capture_sessions cs ON cs.id = sc.session_id`

const toScreenshot = (r: ScreenshotRow): Screenshot => ({
  id: r.id,
  url: `tt-evidence://shot/${r.id}`,
  capturedAtUtc: r.captured_at_utc,
  capturedAtLocal: r.captured_at_local,
  width: r.width,
  height: r.height,
  sha256: r.sha256,
  sourceMode: r.source_mode ?? 'manual',
  region: parseJson<Rect | null>(r.region_json, null),
  screenType: r.screen_type,
  worldId: r.world_id,
  itemId: r.item_id,
  status: r.processing_status,
})

export function getScreenshot(db: Db, id: string): Screenshot | null {
  const r = get<ScreenshotRow>(db, `${SELECT} WHERE sc.id = ?`, [id])
  return r ? toScreenshot(r) : null
}

export function screenshotPath(db: Db, id: string): string | null {
  return get<{ original_path: string }>(db, 'SELECT original_path FROM screenshots WHERE id = ?', [id])?.original_path ?? null
}

function localIso(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19)
  return `${local}${sign}${pad(off / 60)}:${pad(off % 60)}`
}

export interface SaveOptions {
  mode: 'manual' | 'assisted' | 'import'
  ext: string
  region: Rect | null
  screenType: ScreenType | null
  worldId: number | null
  itemId: number | null
  maxPixels: number
}

/** Guarda una captura. Si ya existe (mismo SHA-256) devuelve la existente sin duplicar. */
export function saveEvidence(ctx: AppContext, bytes: Uint8Array, o: SaveOptions): Screenshot {
  const size = imageSize(bytes)
  if (!size) throw new Error('Formato de imagen no reconocido (PNG, JPG o BMP)')
  if (size.width * size.height > o.maxPixels) throw new Error(`Imagen demasiado grande: ${size.width}×${size.height}`)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const existing = get<{ id: string }>(ctx.db, 'SELECT id FROM screenshots WHERE sha256 = ?', [sha256])
  if (existing) return getScreenshot(ctx.db, existing.id)!

  const now = ctx.now()
  const id = randomUUID()
  const dir = join(ctx.paths.evidence, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}${o.ext}`)
  writeFileSync(file, bytes, { flag: 'wx' })

  const sessionId = randomUUID()
  run(ctx.db, 'INSERT INTO capture_sessions (id, source_mode, world_id, item_id, started_at, ended_at) VALUES (?,?,?,?,?,?)', [sessionId, o.mode, o.worldId, o.itemId, now.toISOString(), now.toISOString()])
  run(
    ctx.db,
    `INSERT INTO screenshots (id, session_id, original_path, captured_at_utc, captured_at_local, sha256, width, height, region_json, screen_type, world_id, item_id, processing_status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'new',?)`,
    [id, sessionId, file, now.toISOString(), localIso(now), sha256, size.width, size.height, o.region ? JSON.stringify(o.region) : null, o.screenType, o.worldId, o.itemId, nowIso()],
  )
  return getScreenshot(ctx.db, id)!
}

export function importFiles(ctx: AppContext, files: string[], maxMb: number, maxPixels: number): { imported: Screenshot[]; errors: string[] } {
  const imported: Screenshot[] = []
  const errors: string[] = []
  for (const f of files) {
    try {
      const ext = extname(f).toLowerCase()
      if (!(ALLOWED_EXT as readonly string[]).includes(ext)) throw new Error('extensión no permitida')
      const st = statSync(f)
      if (!st.isFile()) throw new Error('no es un archivo')
      if (st.size > maxMb * 1024 * 1024) throw new Error(`supera ${maxMb} MB`)
      imported.push(saveEvidence(ctx, new Uint8Array(readFileSync(f)), { mode: 'import', ext: ext === '.jpeg' ? '.jpg' : ext, region: null, screenType: null, worldId: null, itemId: null, maxPixels }))
    } catch (e) {
      errors.push(`${f}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { imported, errors }
}

export function listScreenshots(db: Db, status: Screenshot['status'] | null, limit: number): Screenshot[] {
  return all<ScreenshotRow>(db, `${SELECT} ${status ? 'WHERE sc.processing_status = ?' : ''} ORDER BY sc.captured_at_utc DESC LIMIT ?`, status ? [status, limit] : [limit]).map(toScreenshot)
}

export function updateScreenshot(db: Db, id: string, p: { screenType: ScreenType | null; worldId: number | null; itemId: number | null; region: Rect | null }): Screenshot {
  const cur = getScreenshot(db, id)
  if (!cur) throw new Error('Captura no encontrada')
  if (cur.status === 'confirmed') throw new Error('La captura ya está confirmada: su evidencia es inmutable')
  run(db, 'UPDATE screenshots SET screen_type = ?, world_id = ?, item_id = ?, region_json = ? WHERE id = ?', [p.screenType, p.worldId, p.itemId, p.region ? JSON.stringify(p.region) : null, id])
  return getScreenshot(db, id)!
}

export function setScreenshotStatus(db: Db, id: string, status: 'rejected' | 'new'): Screenshot {
  const cur = getScreenshot(db, id)
  if (!cur) throw new Error('Captura no encontrada')
  if (cur.status === 'confirmed') throw new Error('Una captura confirmada no se puede rechazar; corrige el scan con una revisión')
  run(db, 'UPDATE screenshots SET processing_status = ? WHERE id = ?', [status, id])
  return getScreenshot(db, id)!
}
