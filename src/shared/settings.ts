import { DEFAULT_SCORE_PARAMS, DEFAULT_WEIGHTS, type ScoreParams, type ScoreWeights } from '@core/domain/arbitrage/scoring'
import type { ImbuementTier } from '@core/domain/tools/imbuements'

/** Item imbuido creado por el usuario (p. ej. un casco con 2 slots) para calcular su costo de uso. */
export interface ImbuedItemBuild {
  id: string
  name: string
  itemId: number | null
  slots: ({ imbuement: string; tier: ImbuementTier } | null)[]
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  homeWorld: string | null
  favoriteWorlds: string[]
  analysis: {
    minSnapshots: number
    staleAfterHours: number
    historicalHaircut: number
    maxQuantityPerItem: number | null
    weights: ScoreWeights
    scoreParams: ScoreParams
  }
  collector: {
    hotkey: string | null
    assistedIntervalMs: number
    assistedDebounceMs: number
    /** Diferencia media de píxel (0–255) que cuenta como cambio. */
    assistedThreshold: number
    assistedAutoSave: boolean
    maxImportMb: number
    maxImagePixels: number
    /** Carpeta donde el cliente de Tibia guarda sus screenshots; se importan sin capturar la ventana. */
    tibiaFolder: { enabled: boolean; path: string | null; types: string[] }
  }
  ocr: { acceptThreshold: number; reviewThreshold: number }
  tracker: { pollMinutes: number; notify: boolean }
  network: { tibiaDataEnabled: boolean; thirdPartyEnabled: boolean }
  imbuements: {
    world: string | null
    /** Override de los tokens por paquete; null = usar el seed (2 / 4 / 6). */
    tokensPerTier: { Basic: number | null; Intricate: number | null; Powerful: number | null }
    manualPrices: Record<string, number>
    huntHours: number
    builds: ImbuedItemBuild[]
  }
  notifications: { enabled: boolean }
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  homeWorld: null,
  favoriteWorlds: [],
  analysis: { minSnapshots: 5, staleAfterHours: 48, historicalHaircut: 0.5, maxQuantityPerItem: null, weights: DEFAULT_WEIGHTS, scoreParams: DEFAULT_SCORE_PARAMS },
  collector: {
    hotkey: 'CommandOrControl+Shift+F12',
    assistedIntervalMs: 1000,
    assistedDebounceMs: 1500,
    assistedThreshold: 6,
    assistedAutoSave: false,
    maxImportMb: 25,
    maxImagePixels: 7680 * 4320,
    tibiaFolder: { enabled: false, path: null, types: ['Hotkey'] },
  },
  ocr: { acceptThreshold: 0.98, reviewThreshold: 0.9 },
  tracker: { pollMinutes: 5, notify: true },
  network: { tibiaDataEnabled: true, thirdPartyEnabled: true },
  imbuements: { world: null, tokensPerTier: { Basic: null, Intricate: null, Powerful: null }, manualPrices: {}, huntHours: 2, builds: [] },
  notifications: { enabled: true },
}

/** Mezcla profunda de un parche parcial sobre la configuración (solo objetos planos). */
export function mergeSettings<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : (patch as T))
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k]
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v) ? mergeSettings(cur, v) : v
  }
  return out as T
}
