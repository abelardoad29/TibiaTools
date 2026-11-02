import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db/database'
import type { HttpClient } from './external/http'
import type { Logger } from './logging'

export interface Paths {
  root: string
  db: string
  backups: string
  evidence: string
  imageCache: string
  exports: string
  logs: string
}

export function makePaths(root: string): Paths {
  const p: Paths = {
    root,
    db: join(root, 'tibia_tools.db'),
    backups: join(root, 'backups'),
    evidence: join(root, 'evidence'),
    imageCache: join(root, 'image-cache'),
    exports: join(root, 'exports'),
    logs: join(root, 'logs'),
  }
  for (const dir of [p.root, p.backups, p.evidence, p.imageCache, p.exports, p.logs]) mkdirSync(dir, { recursive: true })
  return p
}

/** Dependencias compartidas por los servicios. Los servicios no importan electron. */
export interface AppContext {
  db: Db
  paths: Paths
  http: HttpClient
  log: Logger
  version: string
  now: () => Date
}
