import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { backupTo, schemaVersion, type Db } from '../db/database'
import { MIGRATIONS } from '../db/migrations'
import type { Paths } from '../context'

export function createBackup(db: Db, paths: Paths, label = 'manual'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(paths.backups, `tibia_tools-v${schemaVersion(db)}-${label}-${stamp}.db`)
  backupTo(db, file)
  return file
}

export function listBackups(paths: Paths) {
  return readdirSync(paths.backups)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const p = join(paths.backups, f)
      const st = statSync(p)
      return { name: f, path: p, size: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Verifica que un archivo sea una base de Tibia Tools restaurable (íntegra y de esquema conocido). */
export function validateBackup(file: string): number {
  if (!existsSync(file)) throw new Error('El archivo no existe')
  const probe = new DatabaseSync(file, { readOnly: true })
  try {
    const ok = probe.prepare('PRAGMA quick_check').get() as { quick_check: string }
    if (ok.quick_check !== 'ok') throw new Error('El respaldo está dañado')
    const v = (probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    const latest = MIGRATIONS.at(-1)!.version
    if (v < 1 || v > latest) throw new Error(`Versión de esquema ${v} no compatible (esta app: 1–${latest})`)
    if (!probe.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'market_scans'`).get()) throw new Error('No parece una base de Tibia Tools')
    return v
  } finally {
    probe.close()
  }
}

/**
 * Reemplaza la base actual por el respaldo. Antes guarda un respaldo de seguridad del estado actual.
 * La base debe estar cerrada; quien llama reabre (o reinicia la app).
 */
export function restoreBackup(paths: Paths, file: string, closeCurrent: () => void, current: Db): string {
  validateBackup(file)
  const safety = createBackup(current, paths, 'pre-restore')
  closeCurrent()
  for (const suffix of ['-wal', '-shm']) rmSync(paths.db + suffix, { force: true })
  copyFileSync(file, paths.db)
  return basename(safety)
}
