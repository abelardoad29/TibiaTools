import type { OcrProfile, OcrResult, RgbaImage } from '@core/ocr/types'

export async function loadImage(url: string): Promise<RgbaImage> {
  const blob = await (await fetch(url)).blob()
  const bmp = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height)
  return { width: d.width, height: d.height, data: d.data }
}

export function runOcrInWorker(image: RgbaImage, profile: OcrProfile): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' })
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('El OCR tardó demasiado'))
    }, 30_000)
    worker.onmessage = (e: MessageEvent<{ ok: true; result: OcrResult } | { ok: false; error: string }>) => {
      clearTimeout(timeout)
      worker.terminate()
      if (e.data.ok) resolve(e.data.result)
      else reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      clearTimeout(timeout)
      worker.terminate()
      reject(new Error(e.message))
    }
    worker.postMessage({ image, profile })
  })
}
