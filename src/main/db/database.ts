import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Db = DatabaseSync
type Value = SQLInputValue | boolean | undefined
export type Params = Record<string, Value> | Value[]

/** node:sqlite no acepta boolean ni undefined: se convierten a 0/1 y NULL. */
function bind(params: Params | undefined): Record<string, SQLInputValue> | SQLInputValue[] {
  const conv = (v: Value): SQLInputValue => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)
  if (params === undefined) return []
  if (Array.isArray(params)) return params.map(conv)
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, conv(v)]))
}

function call<T>(db: Db, sql: string, params: Params | undefined, fn: 'all' | 'get' | 'run'): T {
  const stmt = db.prepare(sql)
  const b = bind(params)
  const r = Array.isArray(b) ? (stmt[fn] as (...a: SQLInputValue[]) => unknown)(...b) : (stmt[fn] as (a: Record<string, SQLInputValue>) => unknown)(b)
  return r as T
}

export const all = <T>(db: Db, sql: string, params?: Params): T[] => call<T[]>(db, sql, params, 'all')
export const get = <T>(db: Db, sql: string, params?: Params): T | undefined => call<T | undefined>(db, sql, params, 'get')
export const run = (db: Db, sql: string, params?: Params): { changes: number | bigint; lastInsertRowid: number | bigint } =>
  call(db, sql, params, 'run')

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function schemaVersion(db: Db): number {
  return (get<{ user_version: number }>(db, 'PRAGMA user_version')?.user_version ?? 0)
}

export function migrate(db: Db): number {
  const current = schemaVersion(db)
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    tx(db, () => {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.version}`)
    })
  }
  return schemaVersion(db)
}

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path)
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL')
  const integrity = get<{ quick_check: string }>(db, 'PRAGMA quick_check')
  if (integrity?.quick_check !== 'ok') throw new Error(`Integridad SQLite: ${integrity?.quick_check ?? 'desconocida'}`)
  migrate(db)
  return db
}

/** Copia consistente de la base (VACUUM INTO funciona aunque haya WAL). */
export function backupTo(db: Db, target: string): void {
  db.prepare('VACUUM INTO ?').run(target)
}

export const nowIso = () => new Date().toISOString()
export const bool = (v: number | null | undefined): boolean | null => (v === null || v === undefined ? null : v !== 0)
export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}
