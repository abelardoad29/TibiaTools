# Arquitectura

```text
┌───────────────────────── renderer (React, sandbox) ─────────────────────────┐
│ features/*  ·  components (ItemIcon, ProvenanceBadge, Freshness…)            │
│ lib/api.ts (TanStack Query)  →  platform/ (PlatformApi: electron | web)       │
│ ocr.worker.ts (Web Worker) → core/ocr                                         │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ window.tibia.invoke('api', canal, payload)   (preload, contextBridge)
┌───────────────▼────────────────────── main (Node 24 dentro de Electron) ─────┐
│ ipc/schemas.ts (zod por canal) → ipc/handlers.ts → services/*                 │
│ services: catalog · images · market · evidence · scans · analysis · tools ·   │
│           alerts · backup · settings                                           │
│ external: http (caché, rate limit, UA) · tibiadata · tibiamarket              │
│ db: node:sqlite (WAL, foreign_keys) · migrations · seed                        │
│ protocolos: tt-img:// (iconos en caché) · tt-evidence:// (capturas)           │
│ captura: desktopCapturer + setDisplayMediaRequestHandler · globalShortcut     │
└───────────────┬──────────────────────────────────────────────────────────────┘
                │ funciones puras
┌───────────────▼────────────────────── core (TypeScript puro) ────────────────┐
│ domain: money · market · pricing · liquidity · tc · transfers · arbitrage ·    │
│         cart · alerts · tools (rashid, share-exp, split-loot, imbuements)      │
│ ocr: image · glyphs · pipeline · types                                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| SQLite | `node:sqlite` (incluido en Node 24 / Electron 45), SQL explícito y migraciones propias | Sin módulos nativos que recompilar; las mismas pruebas corren en Vitest y en Electron. Reemplaza a better-sqlite3 + Drizzle del plan |
| IPC | Un canal `api` con nombre de operación; entrada validada con zod; errores serializados (`ApiError`) | Superficie mínima en el preload y validación centralizada |
| Captura | El renderer pide `getDisplayMedia`; main responde con la fuente elegida en `setDisplayMediaRequestHandler` | Sin diálogos repetidos en Electron; el mismo código sirve en navegador (con diálogo) |
| Región | Se dibuja sobre la vista en vivo dentro de la app | Reemplaza la "ventana overlay" del plan: más simple y sin ventanas transparentes encima del juego |
| OCR | Plantillas de glifos aprendidas de capturas etiquetadas, en un Web Worker | La fuente del Market es bitmap; tesseract.js queda como opción si las mediciones lo justifican (no incluido) |
| Iconos | main descarga de TibiaWiki BR y guarda en disco; cola LIFO de 4 descargas, ≤ 8 req/s | Funciona sin red tras la primera carga; lo que está en pantalla se carga primero |
| PWA | Mismo renderer con `platform/web.ts` | Herramientas, catálogo y TibiaData en el celular; Collector y análisis solo en escritorio |

## Seguridad

- `contextIsolation`, `sandbox`, sin `nodeIntegration`; CSP en `index.html` (en desarrollo se permite el script inline de React Refresh).
- Se verifica el origen de cada llamada IPC; se bloquea la navegación fuera de la app; los enlaces externos se abren en el navegador.
- Permisos: solo `media` (captura de pantalla) para la propia app.
- Importación de imágenes: extensiones permitidas, tamaño máximo configurable, límite de píxeles, SHA-256 para deduplicar.
- No se deserializan formatos ejecutables; los perfiles importados se validan con zod.
- El log no guarda datos sensibles.
