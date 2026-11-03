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
  // tibiamarket.top anuncia X-Ratelimit-Limit: 1 y Retry-After: 5 → una consulta cada 5 s.
  'api.tibiamarket.top': 5_100,
  // Iconos: ~8 req/s como máximo; cada icono se descarga una sola vez y queda en caché.
  'www.tibiawiki.com.br': 120,
}

// tibiamarket cuenta los 5 s desde que termina de procesar la consulta anterior (medido: 5,1 s entre
// inicios todavía da 429 tras una respuesta grande), así que ahí el intervalo empieza al llegar la respuesta.
const AFTER_RESPONSE = new Set(['api.tibiamarket.top'])

/** Espera antes de reintentar: Retry-After (segundos o fecha HTTP) con tope de 60 s, o 1 s · 2^intento. */
export function retryDelayMs(retryAfter: string | null, attempt: number, now = Date.now()): number {
  const fallback = 1_000 * 2 ** attempt
  if (!retryAfter) return fallback
  const secs = Number(retryAfter)
  const ms = Number.isFinite(secs) ? secs * 1_000 : Date.parse(retryAfter) - now
  return Number.isFinite(ms) && ms > 0 ? Math.min(60_000, Math.max(fallback, ms + 250)) : fallback
}

/** `intervalOverrides` cambia el intervalo mínimo por host (los tests usan 0 para no esperar). */
export function createHttpClient(db: Db, log: Logger, fetchImpl: typeof fetch = fetch, intervalOverrides: Record<string, number> = {}): HttpClient {
  const lastCall = new Map<string, Promise<void>>()
  const intervals = { ...MIN_INTERVAL_MS, ...intervalOverrides }

  // Serializa las llamadas por host respetando el intervalo mínimo. Devuelve la función que avisa que
  // llegó la respuesta (solo importa en los hosts de AFTER_RESPONSE).
  async function throttle(host: string): Promise<() => void> {
    const interval = intervals[host] ?? 200
    const prev = lastCall.get(host) ?? Promise.resolve()
    let release = () => undefined as void
    const answered = AFTER_RESPONSE.has(host) ? new Promise<void>((r) => (release = r)) : Promise.resolve()
    const next = prev.then(() => answered).then(() => new Promise<void>((r) => setTimeout(r, interval)))
    lastCall.set(host, next.catch(() => undefined))
    await prev
    return release
  }

  async function request(url: string, timeoutMs: number, retries: number): Promise<Response> {
    const host = new URL(url).host
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      const answered = await throttle(host)
      const started = Date.now()
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, image/*;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) }).finally(answered)
        run(db, 'INSERT INTO external_fetch_log (host, endpoint, fetched_at, status, duration_ms, bytes, error) VALUES (?,?,?,?,?,?,NULL)', [
          host,
          new URL(url).pathname,
          nowIso(),
          res.status,
          Date.now() - started,
          Number(res.headers.get('content-length') ?? 0),
        ])
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ExternalError(res.status === 429 ? `${host} limitó las consultas (429); prueba de nuevo en unos segundos` : `${host} respondió ${res.status}`, res.status)
          // Si el servidor dice cuánto esperar (Retry-After), se respeta; si no, espera exponencial.
          if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs(res.headers.get('retry-after'), attempt)))
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
