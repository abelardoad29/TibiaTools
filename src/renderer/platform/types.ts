import type { ApiError, Channel, EventMap, EventName, In, Out } from '@shared/api'

// El renderer solo accede a la plataforma por esta interfaz. En Electron usa el preload;
// en el navegador (PWA companion) usa una implementación web con un subconjunto de funciones.
export interface PlatformApi {
  kind: 'electron' | 'web'
  call<C extends Channel>(channel: C, input: In<C>): Promise<Out<C>>
  on<E extends EventName>(event: E, listener: (payload: EventMap[E]) => void): () => void
  capabilities: { collector: boolean; thirdPartyImport: boolean; localDatabase: boolean }
}

export class PlatformError extends Error {
  constructor(
    readonly code: ApiError['code'],
    message: string,
  ) {
    super(message)
  }
}
