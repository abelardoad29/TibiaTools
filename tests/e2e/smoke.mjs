// Smoke test: arranca la app compilada (out/) con un directorio de datos temporal,
// recorre todas las secciones y falla si hay errores de consola o de página.
// Uso: npm run test:e2e   (requiere `npm run build` antes; lo hace el script)
import { _electron as electron } from 'playwright'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shots = process.env.SMOKE_SHOTS ?? join(tmpdir(), 'tt-smoke-shots')
mkdirSync(shots, { recursive: true })
const localAppData = mkdtempSync(join(tmpdir(), 'tt-smoke-data-'))
const errors = []

// SMOKE_EXE=release/win-unpacked/Tibia Tools.exe prueba la app empaquetada en vez de out/.
const exe = process.env.SMOKE_EXE
const app = await electron.launch({ ...(exe ? { executablePath: exe, args: [] } : { args: ['.'] }), env: { ...process.env, LOCALAPPDATA: localAppData, ELECTRON_RENDERER_URL: '' } })
const page = await app.firstWindow()
try {
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await page.waitForSelector('nav[aria-label="Secciones"]', { timeout: 30_000 })
  const sections = ['Inicio', 'Herramientas', 'Hunted', 'Catálogo', 'Collector', 'Revisión OCR', 'Market', 'Histórico', 'Tibia Coins', 'Arbitraje', 'Transferencias', 'Carrito', 'Alertas', 'Ajustes']
  for (const name of sections) {
    await page.getByRole('link', { name, exact: true }).click()
    await page.waitForTimeout(700)
    const title = await page.locator('h1').first().textContent()
    console.log(`✓ ${name} → h1="${title}"`)
    await page.screenshot({ path: join(shots, `${name.replace(/\s+/g, '_')}.png`) })
  }
  // Interacciones básicas sin red: búsqueda de items y Share Exp por nivel.
  await page.getByRole('link', { name: 'Catálogo', exact: true }).click()
  await page.getByPlaceholder('nombre, iniciales (gmp)…').fill('vampire teeth')
  await page.waitForSelector('text=Vampire Teeth', { timeout: 10_000 })
  console.log('✓ búsqueda de catálogo')
  // Icono real desde TibiaWiki BR vía tt-img:// (depende de la red: no es fatal).
  const iconOk = await page
    .waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.alt.toLowerCase() === 'vampire teeth' && i.complete && i.naturalWidth > 0), null, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false)
  console.log(iconOk ? '✓ icono de item descargado y cacheado' : '⚠ icono de item no cargó (¿sin red?)')
  await page.screenshot({ path: join(shots, 'catalog-search.png') })
  await page.getByRole('link', { name: 'Herramientas', exact: true }).click()
  await page.locator('input[inputmode="numeric"]').first().fill('100')
  await page.getByRole('button', { name: 'Calcular' }).click()
  await page.waitForSelector('text=67', { timeout: 5_000 })
  console.log('✓ share exp 100 → 67–150')
  await page.getByRole('tab', { name: 'Imbuements' }).click()
  await page.waitForSelector('text=Cómo conseguirlo', { timeout: 10_000 })
  await page.waitForSelector('text=Mis items imbuidos', { timeout: 10_000 })
  console.log('✓ imbuements: opciones de compra e items imbuidos')
  await page.getByRole('link', { name: 'Catálogo', exact: true }).click()
  await page.getByPlaceholder('nombre, iniciales (gmp)…').fill('terra mantle')
  await page.getByRole('button', { name: /terra mantle/i }).first().click()
  await page.waitForSelector('text=NPCs que lo compran (le vendes)', { timeout: 10_000 })
  const rashidRows = await page.locator('li', { hasText: 'Rashid' }).count()
  if (rashidRows !== 1) throw new Error(`Rashid aparece ${rashidRows} veces en la ficha`)
  console.log('✓ ficha del item: Rashid en una sola fila')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Cerrar' }).click()
  await page.screenshot({ path: join(shots, 'share-exp.png') })

  // Captura real: se elige la ventana de la propia app (no el escritorio del usuario).
  await page.getByRole('link', { name: 'Collector', exact: true }).click()
  await page.getByRole('button', { name: 'Elegir fuente' }).click()
  const own = page.locator('button', { hasText: 'Ventana' }).filter({ hasText: 'Tibia Tools' }).first()
  await own.waitFor({ timeout: 15_000 })
  await own.click()
  await page.waitForFunction(() => (document.querySelector('video')?.videoWidth ?? 0) > 0, null, { timeout: 15_000 })
  await page.getByRole('button', { name: /^Capturar/ }).click()
  await page.waitForSelector('text=Última captura', { timeout: 15_000 })
  console.log('✓ captura de ventana guardada como evidencia')
  await page.screenshot({ path: join(shots, 'collector-capture.png') })
  await page.getByRole('link', { name: 'Revisión OCR', exact: true }).click()
  await page.waitForSelector('text=Pendientes (1)', { timeout: 10_000 })
  console.log('✓ la captura aparece en Revisión OCR')
} catch (e) {
  await page.screenshot({ path: join(shots, 'failure.png') }).catch(() => undefined)
  console.error('Alertas en pantalla:', await page.locator('[role=alert]').allTextContents().catch(() => []))
  console.error('Errores de consola:', errors.slice(-5))
  throw e
} finally {
  await app.close()
  rmSync(localAppData, { recursive: true, force: true })
}
// Fallos de red externos (TibiaData, iconos) no cuentan: el smoke test no depende de internet.
const relevant = errors.filter((e) => !/net::|Failed to load resource|ERR_|TibiaData/.test(e))
if (relevant.length) {
  console.error('Errores:\n' + relevant.join('\n'))
  process.exit(1)
}
console.log(`OK · capturas en ${shots}${errors.length ? ` · ${errors.length} errores de red ignorados` : ''}`)
