import { get, nowIso, run, type Db } from '../db/database'
import type { Logger } from '../logging'

// Cliente HTTP compartido: timeout, reintentos limitados, intervalo mínimo por host, caché en SQLite
// y User-Agent identificable. Nunca se hace pasar por un navegador.

export const USER_AGENT = 'TibiaTools/2.0 (personal desktop app; +https://github.com/abelardoad29/TibiaTools)'

export interface HttpOptions {
  /** Segundos de validez en caché; 0 = sin caché. */
  cacheSeconds?: number
  timeoutMs?: number
  retries?: number
  /** Si la red falla, devolver la copia en caché aunque esté vencida. */
  staleOnError?: boolean
}

export interface HttpResult<T> {
  data: T
  fetchedAt: string
  fromCache: boolean
  stale: boolean
}

export interface HttpClient {
  getJson<T>(url: string, opts?: HttpOptions): Promise<HttpResult<T>>
  getBytes(url: string, opts?: { timeoutMs?: number }): Promise<{ bytes: Uint8Array; contentType: string | null; finalUrl: string }>
}

export class ExternalError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

const MIN_INTERVAL_MS: Record<string, number> = {
  'api.tibiadata.com': 250,
  'api.tibiamarket.top': 1_000,
  // Iconos: ~8 req/s como máximo; cada icono se descarga una sola vez y queda en caché.
  'www.tibiawiki.com.br': 120,
}

export function createHttpClient(db: Db, log: Logger, fetchImpl: typeof fetch = fetch): HttpClient {
  const lastCall = new Map<string, Promise<void>>()

  // Serializa las llamadas por host respetando el intervalo mínimo.
  async function throttle(host: string): Promise<void> {
    const interval = MIN_INTERVAL_MS[host] ?? 200
    const prev = lastCall.get(host) ?? Promise.resolve()
    const next = prev.then(() => new Promise<void>((r) => setTimeout(r, interval)))
    lastCall.set(host, next.catch(() => undefined))
    await prev
  }

  async function request(url: string, timeoutMs: number, retries: number): Promise<Response> {
    const host = new URL(url).host
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      await throttle(host)
      const started = Date.now()
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, image/*;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) })
        run(db, 'INSERT INTO external_fetch_log (host, endpoint, fetched_at, status, duration_ms, bytes, error) VALUES (?,?,?,?,?,?,NULL)', [
          host,
          new URL(url).pathname,
          nowIso(),
          res.status,
          Date.now() - started,
          Number(res.headers.get('content-length') ?? 0),
        ])
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ExternalError(`${host} respondió ${res.status}`, res.status)
          if (attempt < retries) await new Promise((r) => setTimeout(r, 1_000 * 2 ** attempt))
          continue
        }
        if (!res.ok) throw new ExternalError(`${host} respondió ${res.status}`, res.status)
        return res
      } catch (e) {
        if (e instanceof ExternalError && e.status !== null && e.status < 500 && e.status !== 429) throw e
        lastErr = e
        run(db, 'INSERT INTO external_fetch_log (host, endpoint, fetched_at, status, duration_ms, bytes, error) VALUES (?,?,?,NULL,?,0,?)', [
          host,
          new URL(url).pathname,
          nowIso(),
          Date.now() - started,
          e instanceof Error ? e.message : String(e),
        ])
      }
    }
    throw lastErr instanceof Error ? lastErr : new ExternalError(String(lastErr), null)
  }

  return {
    async getJson<T>(url: string, opts: HttpOptions = {}): Promise<HttpResult<T>> {
      const { cacheSeconds = 0, timeoutMs = 15_000, retries = 2, staleOnError = true } = opts
      const cached = cacheSeconds > 0 ? get<{ body: string; fetched_at: string; expires_at: string }>(db, 'SELECT body, fetched_at, expires_at FROM http_cache WHERE key = ?', [url]) : undefined
      if (cached && cached.expires_at > nowIso()) return { data: JSON.parse(cached.body) as T, fetchedAt: cached.fetched_at, fromCache: true, stale: false }
      try {
        const res = await request(url, timeoutMs, retries)
        const body = await res.text()
        const data = JSON.parse(body) as T
        const fetchedAt = nowIso()
        if (cacheSeconds > 0) {
          run(db, 'INSERT INTO http_cache (key, url, body, fetched_at, expires_at) VALUES (?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at', [
            url,
            url,
            body,
            fetchedAt,
            new Date(Date.now() + cacheSeconds * 1_000).toISOString(),
          ])
        }
        return { data, fetchedAt, fromCache: false, stale: false }
      } catch (e) {
        if (cached && staleOnError) {
          log.warn(`Usando caché vencida de ${url}`, e)
          return { data: JSON.parse(cached.body) as T, fetchedAt: cached.fetched_at, fromCache: true, stale: true }
        }
        throw e
      }
    },
    async getBytes(url, opts = {}) {
      const res = await request(url, opts.timeoutMs ?? 15_000, 1)
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type'), finalUrl: res.url || url }
    },
  }
}
