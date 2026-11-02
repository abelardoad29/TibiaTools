# Release

## Build

```bash
npm run check
```

```bash
npm run test:e2e
```

```bash
npm run dist
```

- `npm run dist` genera `release/TibiaTools-<versión>-setup.exe` (NSIS x64, instalación por usuario, elige carpeta, acceso directo).
- `npm run dist:dir` genera solo `release/win-unpacked/` para probar. Verificado el 02-11-2026: `app.asar` ≈ 13 MB, carpeta ≈ 357 MB (casi todo es el runtime de Electron).
- Para probar el ejecutable empaquetado: `SMOKE_EXE="release/win-unpacked/Tibia Tools.exe" node tests/e2e/smoke.mjs`.
- Sin certificado de firma: Windows SmartScreen mostrará un aviso. Publica el SHA-256 del instalador junto al archivo.

## Datos y actualización

- Los datos viven en `%LOCALAPPDATA%\TibiaTools\` y **no** se borran al desinstalar (`deleteAppDataOnUninstall: false`).
- Antes de actualizar: Ajustes → Datos y respaldos → Crear respaldo.
- Al abrir una versión nueva, las migraciones se aplican solas; los seeds solo se recargan si cambiaron y nunca pisan ediciones del usuario.

## PWA companion

```bash
npm run build:web
```

`dist-web/` es estático: se puede publicar en cualquier hosting (Netlify, Vercel, GitHub Pages). Incluye un service worker que precachea la app y el catálogo, y cachea los iconos de TibiaWiki.

## Pendiente

- Prueba de instalación en un Windows limpio sin Node.
- Auto-actualización (electron-updater) si se distribuye a más personas.
