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
  const sections = ['Inicio', 'Herramientas', 'Hunted', 'Bosses', 'Mundos', 'Collector', 'Revisión OCR', 'Market', 'Histórico', 'Tibia Coins', 'Arbitraje', 'Transferencias', 'Carrito', 'Alertas', 'Ajustes']
  for (const name of sections) {
    await page.getByRole('link', { name, exact: true }).click()
    await page.waitForTimeout(700)
    const title = await page.locator('h1').first().textContent()
    console.log(`✓ ${name} → h1="${title}"`)
    await page.screenshot({ path: join(shots, `${name.replace(/\s+/g, '_')}.png`) })
  }
  // Mundos: la estrella agrega el mundo a "Mis mundos" y lo pone primero en todos los selectores.
  await page.getByRole('link', { name: 'Mundos', exact: true }).click()
  await page.getByPlaceholder('Nombre del mundo').fill('Antica')
  await page.getByRole('button', { name: 'Agregar Antica a mis mundos' }).click()
  await page.getByRole('button', { name: 'Quitar Antica de mis mundos' }).waitFor({ timeout: 5_000 })
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click()
  await page.waitForSelector('optgroup[label="Mis mundos"] > option[value="Antica"]', { state: 'attached', timeout: 5_000 })
  console.log('✓ mis mundos: Antica sale primero en los selectores')
  // Boss hunter: el primer mundo propio se abre solo; la tabla sale aunque no haya red (usa el seed).
  await page.getByRole('link', { name: 'Bosses', exact: true }).click()
  await page.waitForSelector('text=/Antica: [0-9]+ bosses/', { timeout: 60_000 })
  await page.getByRole('checkbox', { name: 'Ocultar los que no tienen chance' }).uncheck()
  await page.getByRole('cell', { name: 'Ferumbras', exact: true }).click()
  await page.waitForSelector('text=Probabilidad diaria según días sin aparecer', { timeout: 10_000 })
  console.log('✓ bosses: probabilidades de Antica y ficha de Ferumbras')
  await page.screenshot({ path: join(shots, 'boss-detail.png') })
  await page.getByRole('button', { name: 'Cerrar' }).click()
  // Datos en vivo de tibia.com vía TibiaData (dependen de la red: no son fatales).
  await page.getByRole('link', { name: 'Mundos', exact: true }).click()
  const liveOk = await page
    .waitForFunction(() => document.body.innerText.includes('actualizado'), null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false)
  if (liveOk) {
    await page.getByRole('cell', { name: 'Antica', exact: true }).click()
    const detailOk = await page.waitForSelector('text=Online ahora', { timeout: 20_000 }).then(() => true).catch(() => false)
    console.log(detailOk ? '✓ ficha del mundo con datos en vivo' : '⚠ la ficha del mundo no cargó (¿sin red?)')
    await page.screenshot({ path: join(shots, 'world-detail.png') })
    await page.getByRole('button', { name: 'Cerrar' }).click()
  } else console.log('⚠ conectados en vivo no cargaron (¿sin red?)')
  await page.getByRole('link', { name: 'Herramientas', exact: true }).click()
  await page.locator('input[inputmode="numeric"]').first().fill('100')
  await page.getByRole('button', { name: 'Calcular' }).click()
  await page.waitForSelector('text=67', { timeout: 5_000 })
  console.log('✓ share exp 100 → 67–150')
  await page.getByRole('tab', { name: 'Imbuements' }).click()
  await page.waitForSelector('text=Cómo conseguirlo', { timeout: 10_000 })
  await page.waitForSelector('text=Mis items imbuidos', { timeout: 10_000 })
  console.log('✓ imbuements: opciones de compra e items imbuidos')
  await page.screenshot({ path: join(shots, 'share-exp.png') })

  // Market: la descarga masiva de tibiamarket.top está disponible y su estado se puede leer (sin descargar).
  await page.getByRole('link', { name: 'Market', exact: true }).click()
  await page.getByRole('button', { name: 'Actualizar todos los mundos' }).waitFor({ timeout: 10_000 })
  const tp = await page.evaluate(() => window.tibia.invoke('market.thirdParty.status', undefined))
  if (!tp.ok || tp.data.status.running || !tp.data.status.nextAutoAt || tp.data.worlds.length < 50) throw new Error(`estado de terceros inesperado: ${JSON.stringify(tp).slice(0, 300)}`)
  console.log(`✓ precios de terceros: ${tp.data.worlds.length} mundos, revisión automática programada`)

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
  // El OCR y el editor de perfiles leen la captura con fetch(): debe funcionar (CORS del protocolo).
  const fetched = await page.evaluate(async () => {
    const list = await window.tibia.invoke('collector.screenshots.list', { status: null, limit: 1 })
    const res = await fetch(list.data[0].url)
    const bmp = await createImageBitmap(await res.blob())
    return { status: res.status, width: bmp.width }
  })
  if (fetched.status !== 200 || !fetched.width) throw new Error(`fetch de la captura falló: ${JSON.stringify(fetched)}`)
  console.log('✓ la captura se puede leer para el OCR')
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
