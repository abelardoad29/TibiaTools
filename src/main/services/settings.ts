import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings'
import { get, nowIso, run, type Db } from '../db/database'

export function getSettings(db: Db): Settings {
  const row = get<{ value_json: string }>(db, `SELECT value_json FROM app_settings WHERE key = 'settings'`)
  return row ? mergeSettings(DEFAULT_SETTINGS, JSON.parse(row.value_json)) : DEFAULT_SETTINGS
}

export function setSettings(db: Db, patch: Partial<Settings>): Settings {
  const next = mergeSettings(getSettings(db), patch)
  run(db, `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('settings', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`, [
    JSON.stringify(next),
    nowIso(),
  ])
  return next
}
