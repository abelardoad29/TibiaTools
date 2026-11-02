import { runOcr } from '@core/ocr/pipeline'
import type { OcrProfile, RgbaImage } from '@core/ocr/types'

// El OCR corre en un Web Worker para no bloquear la interfaz.
self.onmessage = (e: MessageEvent<{ image: RgbaImage; profile: OcrProfile }>) => {
  try {
    self.postMessage({ ok: true, result: runOcr(e.data.image, e.data.profile) })
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
