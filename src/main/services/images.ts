import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wikiFileName } from '@core/domain/catalog/names'
import { all, get, run } from '../db/database'
import type { AppContext } from '../context'

// Iconos de items: TibiaWiki BR (Special:FilePath/<Nombre>.gif) con caché en disco.
// Orden: override manual → wiki_name → name. Si nada resuelve, el renderer muestra un placeholder.
const WIKI = 'https://www.tibiawiki.com.br/wiki/Special:FilePath/'
const RETRY_FAILED_AFTER_MS = 7 * 86_400_000

interface IconRow {
  id: number
  name: string
  wiki_name: string | null
  icon_status: string
  icon_override_url: string | null
  image_path: string | null
}

const inflight = new Map<number, Promise<Uint8Array | null>>()
let active = 0
const queue: (() => void)[] = []
const MAX_CONCURRENT = 4

// LIFO: lo último que pidió la UI (lo que está en pantalla) se descarga primero.
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r))
  active++
  try {
    return await fn()
  } finally {
    active--
    queue.pop()?.()
  }
}

function cacheFile(ctx: AppContext, id: number): string {
  const dir = join(ctx.paths.imageCache, 'items')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${id}.img`)
}

export function candidateUrls(row: Pick<IconRow, 'name' | 'wiki_name' | 'icon_override_url'>): string[] {
  const urls = [row.icon_override_url, row.wiki_name ? WIKI + encodeURIComponent(wikiFileName(row.wiki_name)) + '.gif' : null, WIKI + encodeURIComponent(wikiFileName(row.name)) + '.gif']
  return [...new Set(urls.filter((u): u is string => !!u))]
}

/** Devuelve los bytes del icono (desde caché o descargándolo) o null si no hay icono. */
export function itemIcon(ctx: AppContext, id: number): Promise<Uint8Array | null> {
  const file = cacheFile(ctx, id)
  if (existsSync(file)) return Promise.resolve(new Uint8Array(readFileSync(file)))
  const pending = inflight.get(id)
  if (pending) return pending
  const p = slot(async () => {
    const row = get<IconRow & { verified_at: string | null }>(ctx.db, 'SELECT id, name, wiki_name, icon_status, icon_override_url, image_path, verified_at FROM items WHERE id = ?', [id])
    if (!row) return null
    if (row.icon_status === 'failed' && row.image_path && Date.now() - Number(row.image_path) < RETRY_FAILED_AFTER_MS) return null
    for (const url of candidateUrls(row)) {
      try {
        const res = await ctx.http.getBytes(url)
        if (!res.contentType?.startsWith('image/') || res.bytes.length === 0) continue
        writeFileSync(file, res.bytes)
        run(ctx.db, `UPDATE items SET icon_status = CASE WHEN icon_override_url IS NOT NULL THEN 'override' ELSE 'cached' END, image_path = ? WHERE id = ?`, [file, id])
        return res.bytes
      } catch {
        // probar el siguiente candidato
      }
    }
    // image_path guarda el instante del fallo para reintentar más tarde.
    run(ctx.db, `UPDATE items SET icon_status = 'failed', image_path = ? WHERE id = ?`, [String(Date.now()), id])
    return null
  }).finally(() => inflight.delete(id))
  inflight.set(id, p)
  return p
}

export function iconStats(ctx: AppContext) {
  const rows = all<{ icon_status: string; n: number }>(ctx.db, 'SELECT icon_status, COUNT(*) AS n FROM items GROUP BY icon_status')
  const n = (s: string) => rows.find((r) => r.icon_status === s)?.n ?? 0
  return { total: rows.reduce((s, r) => s + r.n, 0), cached: n('cached') + n('override'), failed: n('failed'), unknown: n('unknown') }
}

/** Precarga iconos en segundo plano (cola limitada); informa progreso. */
export function prefetchIcons(ctx: AppContext, category: string | null, onProgress: (done: number, total: number) => void): number {
  const ids = all<{ id: number }>(ctx.db, `SELECT id FROM items WHERE icon_status = 'unknown' ${category ? 'AND category = ?' : ''}`, category ? [category] : []).map((r) => r.id)
  let done = 0
  for (const id of ids) {
    void itemIcon(ctx, id).finally(() => {
      done++
      if (done % 10 === 0 || done === ids.length) onProgress(done, ids.length)
    })
  }
  return ids.length
}
