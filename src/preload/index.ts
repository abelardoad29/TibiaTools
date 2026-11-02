import { contextBridge, ipcRenderer } from 'electron'

// Puente mínimo: un único canal "api" (validado en main) y suscripción a eventos.
// El renderer no tiene acceso a Node ni a ipcRenderer directamente.
contextBridge.exposeInMainWorld('tibia', {
  invoke: (channel: string, payload: unknown) => ipcRenderer.invoke('api', channel, payload),
  on: (event: string, listener: (payload: unknown) => void) => {
    const wrapped = (_e: unknown, name: string, payload: unknown) => {
      if (name === event) listener(payload)
    }
    ipcRenderer.on('event', wrapped)
    return () => ipcRenderer.removeListener('event', wrapped)
  },
})
