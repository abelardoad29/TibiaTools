import type { ApiError } from '@shared/api'
import { PlatformError, type PlatformApi } from './types'
import { createWebPlatform } from './web'

export { PlatformError, type PlatformApi }

interface Bridge {
  invoke(channel: string, payload: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: ApiError }>
  on(event: string, listener: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    tibia?: Bridge
  }
}

function createElectronPlatform(bridge: Bridge): PlatformApi {
  return {
    kind: 'electron',
    async call(channel, input) {
      const r = await bridge.invoke(channel, input)
      if (!r.ok) throw new PlatformError(r.error.code, r.error.message)
      return r.data as never
    },
    on: (event, listener) => bridge.on(event, listener as (p: unknown) => void),
    capabilities: { collector: true, thirdPartyImport: true, localDatabase: true },
  }
}

export const platform: PlatformApi = window.tibia ? createElectronPlatform(window.tibia) : createWebPlatform()
