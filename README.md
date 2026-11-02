# Tibia Tools 2.0

App de escritorio local (Windows) con las herramientas de Tibia Tools v1 y un módulo de **arbitraje del Market entre mundos**, más una **PWA companion** con las herramientas para el celular.

> Uso personal. La app solo **lee la pantalla** (capturas que tú decides) y datos públicos. No hace clics, no envía teclas, no lee memoria del cliente y no guarda credenciales.

## Qué incluye

| Sección | Qué hace |
|---|---|
| Inicio | Rashid (con el día de servidor), boosted creature/boss (TibiaData), estado de los datos, cobertura del Market |
| Herramientas | Share Exp (corregido), Split Loot, Imbuements (24, la opción más barata entre materiales, Gold Tokens y scrolls; items imbuidos con costo por hora y por hunt), seguimiento de personajes |
| Hunted | Listas de personajes o guilds enteras; avisa cuando alguien se conecta y cuando se conectan varios de golpe (por defecto 5 en 60 s). Lee la lista de conectados de Tibia cada minuto |
| Catálogo | 5,121 items con ID de cliente, categoría, precios NPC e iconos de TibiaWiki BR (caché local); 90 mundos con PvP/BattlEye/transferencia |
| Collector | Importa sola cada captura de la tecla de screenshot de Tibia (carpeta del cliente); también captura de pantalla con región, atajo global, importación manual y captura asistida |
| Revisión OCR | OCR por plantillas de glifos en un worker, tabla editable, correcciones auditadas, snapshots inmutables; editor de perfiles y calibración |
| Market / Histórico | Order books por mundo e item con procedencia y antigüedad; P25/P50/P75, volatilidad y eventos inferidos (nunca "vendido confirmado") |
| Tibia Coins | Cotizaciones por mundo, spread e histórico, sin mezclar lados del mercado |
| Arbitraje | Instant / Historical / Hybrid, rankings separados, evidencia por resultado, matriz de rutas, exportación CSV/JSON |
| Transferencias | Reglas oficiales (PvP, BattlEye, blocked/locked), checklist del personaje, reglas manuales con vencimiento |
| Carrito | Heurística greedy (sin prometer óptimo), presupuesto, costo de transferencia, comparación de carritos |
| Alertas | ROI, precio, spread de TC, datos vencidos, rutas inválidas; notificaciones de Windows opcionales |
| Ajustes | Reglas económicas versionadas, pesos del score, umbrales OCR, respaldos y restauración, log |

## Desarrollo

Requisitos: Node 24+ y Windows 10/11 x64.

```bash
npm install
```

```bash
npm run dev
```

| Comando | Para qué |
|---|---|
| `npm run check` | TypeScript (node + web), ESLint, dependency-cruiser (capas) y Vitest |
| `npm test` | Pruebas unitarias, de integración (SQLite real), escenarios económicos y OCR |
| `npm run test:e2e` | Compila y recorre todas las secciones en la app Electron real |
| `npm run build` | Compila main, preload y renderer en `out/` |
| `npm run dist` | Instalador NSIS en `release/` (`npm run dist:dir` para solo la carpeta) |
| `npm run build:web` / `npm run dev:web` | PWA companion en `dist-web/` |
| `npm run seed:fetch` | Regenera `seed/items.json` y `seed/worlds.json` desde tibiamarket.top y TibiaData |
| `npm run seed:imbuements -- <pagina-guardada>` | Regenera `seed/imbuements.json` desde una copia guardada de la página de TibiaWiki |
| `npm run ocr:eval -- --dataset <carpeta>` | Exactitud del OCR contra capturas anotadas |
| `npm run icon` | Regenera el icono (emblema de Lumbre) desde `resources/brand/logo-lumbre.png` |

## Datos locales

Todo vive en `%LOCALAPPDATA%\TibiaTools\`: `tibia_tools.db` (SQLite, WAL), `evidence\` (capturas originales intactas), `image-cache\`, `backups\`, `exports\` y `logs\`. Nada de eso se versiona.

## Documentación

- [docs/PLAN.md](docs/PLAN.md): plan por fases y estado de implementación
- [CODEX.md](CODEX.md): instrucciones permanentes para quien modifique el código
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md), [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
- [docs/OCR_CALIBRATION.md](docs/OCR_CALIBRATION.md), [docs/ECONOMIC_MODEL.md](docs/ECONOMIC_MODEL.md), [docs/TRANSFER_RULES.md](docs/TRANSFER_RULES.md)
- [docs/RELEASE.md](docs/RELEASE.md), [docs/SPIKE_REPORT.md](docs/SPIKE_REPORT.md), [docs/NABBOT_REVIEW.md](docs/NABBOT_REVIEW.md)
- La v1 en Flet queda en el tag `flet-v1`. La especificación original (PySide6) está en [docs/CODEX-v1-pyside.md](docs/CODEX-v1-pyside.md).
