# Tibia Tools 2.0: plan de trabajo y estructura

**Fecha:** 02-11-2026
**Estado:** fases 0–14 implementadas en la rama `v2` (ver §13). Pendiente: validación con capturas reales del cliente.
**Base:** `CODEX (1).md` (Tibia Arbitrage v1.0, PySide6) + este repo (Tibia Tools v1, Flet)

---

## 0. Resumen

- Un solo producto, **Tibia Tools 2.0**: las herramientas actuales (Rashid, Boosted, Imbuements, Split Loot, Share Exp, tracker de personajes) más el módulo **Arbitrage** del CODEX.
- Plataforma: **Electron + React + TypeScript + Vite + Tailwind**, con SQLite local. El renderer se diseña para poder publicarse después como PWA "companion" (herramientas y visor, sin Collector).
- Se mantienen **todos los principios del CODEX**: no automatizar el cliente, no inventar datos, distinguir observado / inferido / estimado y no presentar como ejecutable una ruta desconocida.
- Cambia el stack (PySide6 → Electron) y se añaden dos fuentes que el CODEX no contemplaba:
  1. La API de **tibiamarket.top**, como dato de terceros etiquetado (sirve de catálogo e histórico; no de precio en vivo).
  2. La vista **Details** del Market por OCR, que da las **transacciones oficiales de 30 días**: volumen real en lugar de inferido.
- Orden de trabajo:
  1. Un spike que ataque el riesgo principal (OCR y captura).
  2. Paridad con la app actual en el nuevo stack.
  3. Catálogos con iconos y datos de terceros.
  4. Motor económico.
  5. Collector y OCR.
  6. El resto del CODEX.

---

## 1. Inventario de Tibia Tools v1

| Función | Archivo | Estado real | Destino en 2.0 |
|---|---|---|---|
| Where is Rashid | `main.py` | Funciona, pero toma el día del PC. Rashid cambia en el server save (10:00 CET/CEST), así que de 00:00 a 10:00 muestra la ciudad equivocada | `core/domain/tools/rashid.ts` con "día de servidor" |
| Boosted creature / boss | `main.py` + `api.py` (lógica duplicada) | Depende de `api.tibialabs.com`, que **no respondió** el 02-11-2026 | TibiaData `/v4/creatures` y `/v4/boostablebosses` (ambos traen `boosted`; las criaturas con `image_url`) |
| Imágenes de criaturas | `creature_gifs.json` | 1,995 nombres → GIFs de tibiawiki.com.br | Se conserva como seed y fallback de imágenes |
| Imbuements | `imbuiments_view.py` + `imbuiments.json` | Solo 3 imbuements; `update_materials()` está comentado; el total siempre es 0; la comparación con token es un placeholder; la ruta relativa `src/imbuiments.json` no coincide con el cwd que asume `main.py` | Catálogo completo, precio de materiales con datos de Market y comparación contra Gold Token |
| Split Loot | `split_loot.py` | Funciona | Parser y algoritmo en `core`, con tests (incluido el resto de la división entera) |
| Share Exp | `Exp_view.py` | **Bug de off-by-one**: usa `floor(L·2/3)` y `ceil(L·3/2)`, cuando debería ser `ceil` y `floor`. Nivel 100 → correcto 67–150; la app dice 66–150 | `core/domain/tools/share-exp.ts` corregido y con tests de bordes |
| Tracker de personajes | `ui.py` | Incompleto: importa `tibia_tools.api` (no existe), el layout está omitido y hace polling cada 5 s | Alertas locales (muerte / level up) con polling ≥ 5 min |
| Oriental Trader (Mini World Changes) | `scrapp.py` + `msedgedriver.exe` | Selenium + Edge headless scrapeando intibia.com. El `.exe` (18.7 MB) **está versionado en git** | Se elimina Selenium. La función queda pendiente de una fuente (D4) |
| Hot reload | `run_watch.py` | — | Lo reemplaza el HMR de Vite |
| Assets | `icon.png`, `Rashid.gif`, `splash_android.png` | — | `resources/` |

---

## 2. Fuentes externas verificadas el 02-11-2026

| Fuente | Qué ofrece | Qué no ofrece / limitaciones | Uso en 2.0 |
|---|---|---|---|
| **TibiaData** (`api.tibiadata.com`, v4 y v5) | `/v4/worlds`: 90 mundos con `location`, `pvp_type`, `battleye_protected`, `battleye_date`, `transfer_type` y `game_world_type`. `/v4/creatures` y `/v4/boostablebosses` con `boosted`. `/v4/character/{name}` | Ningún endpoint de Market ni de items | Catálogo de mundos, boosted, tracker, Share Exp |
| **Tibia Market** (`api.tibiamarket.top`, OpenAPI pública) | `/item_metadata`: 5,121 items con id de cliente, categoría, tier, nombre, `wiki_name` y precios NPC de compra/venta. `/world_data`: 113 mundos con su último escaneo. `/market_values`: mejor buy/sell, número de ofertas y estadísticas de día y mes (vendidos, comprados, promedio, máx/mín). `/market_board`: order book con cantidad, precio y `time`. `/item_comparison`: un item en todos los mundos. También `/item_history`, `/item_activity` y `/events` | **Frescura baja**: 0 mundos actualizados en los últimos 14 días, 2 en 30 días, 92 en 90 días; la mediana es de 59 días. No documenta términos de uso ni rate limit. El vendedor aparece como "Anonymous" | **Catálogo de items** (IDs, categorías, NPC). Datos de mercado **de terceros, con badge y antigüedad**, para sembrar históricos y priorizar qué capturar. **Nunca** como precio en vivo |
| **TibiaWiki BR** | `https://www.tibiawiki.com.br/wiki/Special:FilePath/<Nombre>.gif` redirige al GIF. En una muestra, **29 de 30 items** normales resolvieron con `wiki_name` (el que falló no tiene `wiki_name`) y **0 de 5 Soul Cores** | — | Iconos de items con caché en disco. Las Soul Cores (835 items) llevan un icono genérico o un mapeo propio |
| tibia.fandom.com, static.tibia.com | Responden **403** a peticiones fuera de un navegador | — | No depender de ellos; se pueden probar desde el Chromium de Electron como fuente secundaria |
| **tibiawiki-sql** (Galarzaa90) | Genera un SQLite desde TibiaWiki con peso (oz), stackable, etc. | Cambió su esquema entre versiones | Script offline para sembrar `weight_oz` y `stack_size` (F-018). No es dependencia en tiempo de ejecución |
| **Manual oficial del Market** | Comisión de 2.5 %, mínimo 20 gp, máximo 2,500,000 gp. Se cobra al **publicar** una oferta y se pierde al cancelarla. Las ofertas duran 30 días. La vista **Details** muestra estadísticas de 30 días (precio promedio, cuántas veces se ofertó y **se vendió**, máximo y mínimo pagado), que se actualizan una vez al día en el server save | **No aclara** si el 2.5 % se aplica al precio unitario o al total (precio × cantidad) | Regla versionada; la base se verifica en Fase 0. Capturar Details por OCR da transacciones **oficiales** |
| TibiaLabs | No respondió | — | Se retira |

### Consecuencias para el diseño

1. **Liquidez real.** Capturar la vista Details resuelve la mayor debilidad del CODEX: que el volumen solo se infería por desapariciones de ofertas. Para eso se añade la tabla `market_stats`, separada de las ofertas.
2. **Tibiamarket no sirve como precio en vivo**, porque sus datos tienen una mediana de 59 días. Se modela con `source = third_party` y nunca se mezcla en silencio con las capturas propias.
3. **ID de item único.** El id de cliente que expone tibiamarket se guarda como `tibia_item_id` y une catálogo, iconos y datos de terceros.
4. **Precedencia de fuentes**: captura propia confirmada > estadística oficial capturada > terceros > inferido. Ninguna cifra combina fuentes sin mostrar el desglose.

---

## 3. Decisión de plataforma

| Requisito | PWA | **Electron** | PySide6 (CODEX) |
|---|---|---|---|
| Capturar la ventana de Tibia sin pedir permiso en cada sesión | No: `getDisplayMedia` pide elegir fuente cada vez | **Sí**: `desktopCapturer` | Sí: MSS |
| Overlay para elegir región + atajo global de captura | No | **Sí**: ventana transparente + `globalShortcut` | Sí |
| Guardar evidencia (capturas) en disco sin cuota | Limitado: OPFS con cuota, puede ser desalojado | **Sí** | Sí |
| SQLite fiable | sqlite-wasm + OPFS (viable, más frágil) | **better-sqlite3** | Nativo |
| UI con miles de iconos, tablas y gráficas | Excelente | **Excelente** | Más trabajo con Qt widgets |
| Tu stack actual (React, Vite, TS, Tailwind, TanStack, zod, recharts) | Sí | **Sí** | No |
| Uso en el celular | Sí | No (lo cubre la PWA companion de la Fase 14) | No |

**Decisión: Electron.** La razón de ser del módulo Arbitrage es el Collector, que necesita capturar sin fricción, un overlay de región y un atajo global; una PWA no permite nada de eso. PySide6 encaja con el CODEX, pero te obliga a dejar el stack web que ya usas en tus otros proyectos y encarece una UI llena de iconos. La PWA queda como objetivo secundario: el renderer accede a la plataforma solo a través de la interfaz `PlatformApi`, que tendrá dos implementaciones (Electron y web).

### Desviaciones respecto al CODEX

| CODEX | 2.0 | Motivo |
|---|---|---|
| PySide6 | Electron + React | Ver tabla anterior |
| SQLAlchemy 2 + Alembic | better-sqlite3 + Drizzle ORM + migraciones con drizzle-kit | Tipado de punta a punta, SQL explícito |
| Pydantic | zod | Validación en IPC, APIs externas y seeds |
| `Decimal` | GP como enteros (`number` con guardia `Number.isSafeInteger`; `bigint` en sumas grandes) y redondeo explícito | JavaScript no tiene `Decimal`. El oro siempre es entero: un precio de 10⁹ × 64,000 unidades sigue siendo menor que 2⁵³ |
| MSS | `desktopCapturer` (Windows Graphics Capture) | — |
| OpenCV + Tesseract | **Matcher de glifos** de la fuente bitmap de Tibia + tesseract.js como respaldo | Tibia dibuja los números con una fuente de píxeles fija, y el template matching suele superar a Tesseract en texto pequeño pixelado. **Se mide en la Fase 0, no se asume** |
| QThread workers | `worker_threads` / `utilityProcess` | — |
| pytest / pytest-qt | Vitest / Testing Library / Playwright (Electron) | — |
| Ruff / mypy | ESLint + Prettier / `tsc --strict` + dependency-cruiser | dependency-cruiser hace cumplir las capas |
| PyInstaller + Inno Setup | electron-builder (NSIS x64) | — |
| "Históricos: solo observaciones propias" | Propias + terceros etiquetados | Decisión abierta **D1** |

---

## 4. Stack

| Capa | Tecnología |
|---|---|
| Shell de escritorio | Electron (última estable al iniciar) + electron-vite |
| UI | React 19, React Router, Tailwind 4, lucide-react |
| Datos en la UI | TanStack Query (sobre IPC) |
| Tablas | TanStack Table + TanStack Virtual |
| Formularios | react-hook-form + zod |
| Gráficas | Recharts. Si el histórico con miles de puntos va lento, uPlot |
| Base de datos | SQLite (better-sqlite3) con WAL y `foreign_keys=ON`; Drizzle ORM |
| OCR | Matcher propio en un worker; tesseract.js como fallback |
| HTTP | `fetch` de Node con timeout, reintentos limitados, rate limit por host, caché y User-Agent identificable |
| Tests | Vitest, Testing Library, Playwright para Electron |
| Calidad | TypeScript strict, ESLint, Prettier, dependency-cruiser |
| Empaquetado | electron-builder (NSIS x64) |
| Gestor de paquetes | npm |

---

## 5. Estructura del repositorio

```text
TibiaTools/                          # mismo repo, rama v2; la v1 (Flet) queda en el tag flet-v1
├── CODEX.md                         # spec adaptado a 2.0 (reemplaza al de PySide6)
├── README.md
├── package.json
├── electron.vite.config.ts          # main / preload / renderer
├── vite.web.config.ts               # build PWA (Fase 14)
├── electron-builder.yml
├── drizzle.config.ts
├── tsconfig.json (+ tsconfig.node.json, tsconfig.web.json)
├── vitest.config.ts
├── playwright.config.ts
├── .dependency-cruiser.cjs          # prohíbe los imports que rompen capas
├── resources/                       # icono de la app, Rashid.gif, placeholders, icono genérico de Soul Core
├── seed/                            # datos versionados que se cargan a SQLite
│   ├── rashid.json
│   ├── imbuements.json              # catálogo completo (migra imbuiments.json)
│   ├── creature_gifs.json           # migrado tal cual
│   ├── items.json                   # snapshot de /item_metadata (funciona sin red)
│   ├── items_physical.json          # peso/stack desde tibiawiki-sql
│   ├── economic_rules.json          # market fee con fuente y fecha de verificación
│   ├── transfer_rules.json          # reglas verificadas manualmente
│   └── ocr-profiles/                # perfiles por resolución y escala
├── src/
│   ├── shared/                      # tipos y contrato IPC; sin lógica
│   │   ├── ipc-contract.ts          # canales + schemas zod de request/response
│   │   └── provenance.ts            # own_capture | official_stats | third_party | inferred | estimated | manual | unknown
│   ├── core/                        # TypeScript puro: sin electron, react, node:fs ni red
│   │   ├── domain/
│   │   │   ├── money/               # Gp, sumas seguras, redondeo, market fee
│   │   │   ├── catalog/             # World, Item, normalización de nombres
│   │   │   ├── market/              # Offer, OrderBook, Snapshot, MarketStats, diff → eventos
│   │   │   ├── pricing/             # percentiles, IQR, volatilidad, media ponderada
│   │   │   ├── liquidity/           # volumen oficial vs. turnover inferido
│   │   │   ├── tc/                  # cotizaciones TC, conversión según el lado del mercado
│   │   │   ├── transfers/           # world_route_status, checklist, final_status
│   │   │   ├── arbitrage/           # instant, historical, hybrid, scoring
│   │   │   ├── cart/                # greedy + restricciones
│   │   │   ├── alerts/              # reglas y deduplicación
│   │   │   └── tools/               # migrado de v1: rashid, share-exp, split-loot, imbuements
│   │   ├── application/
│   │   │   ├── ports/               # interfaces: repositorios, MarketDataSource, CatalogSource, ImageStore, Clock, Capture
│   │   │   ├── usecases/            # un archivo por caso de uso
│   │   │   └── dto/
│   │   └── ocr/                     # pipeline puro sobre buffers RGBA
│   │       ├── image.ts             # recorte, escala de grises, umbral, componentes conexos
│   │       ├── glyphs/              # atlas de dígitos y letras de la fuente de Tibia por escala
│   │       ├── matcher.ts
│   │       ├── layout.ts            # perfil → regiones → filas y columnas
│   │       ├── parsers/             # offers, details (statistics), tc
│   │       └── validate.ts          # p. ej. cantidad × precio unitario = total; orden de precios
│   ├── main/                        # proceso principal = infraestructura
│   │   ├── index.ts
│   │   ├── bootstrap.ts             # composición de dependencias
│   │   ├── paths.ts                 # %LOCALAPPDATA%\TibiaTools
│   │   ├── security.ts              # CSP, permisos, allowlist de hosts
│   │   ├── logging.ts
│   │   ├── db/
│   │   │   ├── schema/              # tablas Drizzle
│   │   │   ├── migrations/
│   │   │   ├── repositories/        # implementan core/application/ports
│   │   │   └── backup.ts            # backup consistente (API de backup de SQLite) + restore
│   │   ├── capture/
│   │   │   ├── sources.ts           # desktopCapturer: pantallas y ventanas
│   │   │   ├── region-overlay.ts    # ventana transparente para elegir la región
│   │   │   ├── hotkey.ts            # atajo global configurable; solo dispara una captura en esta app
│   │   │   └── assisted.ts          # Fase 12: detección de cambios + debounce
│   │   ├── evidence/                # originales intactos, sha256, recortes
│   │   ├── external/
│   │   │   ├── http.ts              # timeout, reintentos, rate limit, caché, UA
│   │   │   ├── tibiadata.ts
│   │   │   ├── tibiamarket.ts
│   │   │   └── tibiawiki-images.ts
│   │   ├── image-cache/             # protocolo tt-img:// → disco, con descarga perezosa
│   │   ├── workers/                 # OCR y análisis fuera del hilo principal
│   │   ├── ipc/                     # handlers validados con zod
│   │   └── notifications.ts
│   ├── preload/
│   │   └── index.ts                 # contextBridge: expone PlatformApi tipada
│   └── renderer/
│       ├── main.tsx
│       ├── app/                     # router, layout con sidebar, tema oscuro/claro
│       ├── platform/                # PlatformApi: electron.ts | web.ts (PWA)
│       ├── components/
│       │   ├── ItemIcon.tsx         # icono por tibia_item_id, con fallback
│       │   ├── ItemPicker.tsx       # búsqueda difusa con iconos
│       │   ├── WorldPicker.tsx
│       │   ├── Gp.tsx               # formato de oro (1,234,567 / 1.2kk)
│       │   ├── ProvenanceBadge.tsx  # Propio / Oficial / Terceros / Inferido / Estimado / Desconocido (texto + icono, no solo color)
│       │   └── Freshness.tsx        # hora del dato + antigüedad
│       └── features/
│           ├── overview/            # Rashid, boosted, estado de la DB, oportunidades recientes
│           ├── tools/               # share-exp, split-loot, imbuements, characters
│           ├── catalog/             # items y mundos
│           ├── collector/
│           ├── ocr-review/
│           ├── market-explorer/
│           ├── price-history/
│           ├── tc-market/
│           ├── arbitrage/
│           ├── transfers/
│           ├── cart/
│           └── settings/            # perfiles OCR, reglas, fuentes, backups, logs
├── scripts/
│   ├── seed-tibiawiki-sql.py        # offline: peso/stack → seed/items_physical.json
│   ├── fetch-item-metadata.ts       # actualiza seed/items.json
│   └── ocr-eval.ts                  # mide la exactitud contra el dataset anotado
├── spikes/                          # código desechable de la Fase 0
├── tests/
│   ├── unit/                        # espejo de src/core
│   ├── economic-scenarios/          # ganancia, pérdida, parciales, datos incompletos
│   ├── ocr/
│   │   ├── fixtures/                # capturas reales (de uso permitido)
│   │   └── expected/                # anotaciones manuales en JSON
│   ├── integration/                 # main + SQLite en memoria, migraciones, backup/restore
│   └── e2e/                         # Playwright sobre Electron
└── docs/
    ├── PLAN.md                      # este documento
    ├── ARCHITECTURE.md
    ├── DATABASE.md
    ├── DATA_SOURCES.md
    ├── OCR_CALIBRATION.md
    ├── ECONOMIC_MODEL.md
    ├── TRANSFER_RULES.md
    └── RELEASE.md
```

### Reglas de capas

- `core` no importa de `main`, `renderer`, `electron`, `react` ni `node:*`. dependency-cruiser lo verifica en `npm run check`.
- `main` implementa los puertos de `core/application/ports`.
- `renderer` solo habla con `main` a través de `PlatformApi` (preload). Sin `nodeIntegration`, con `contextIsolation` y `sandbox` activos.
- El OCR y los análisis pesados corren en workers; el renderer solo recibe resultados.
- La lógica económica vive únicamente en `core/domain`; nunca en componentes React ni en SQL.

### Datos locales

Se guardan en `%LOCALAPPDATA%\TibiaTools\`, forzando `app.setPath('userData', …)`. Electron usa `%APPDATA%` (Roaming) por defecto, y no queremos que se sincronicen gigas de capturas.

```text
tibia_tools.db
backups/
evidence/YYYY/MM/
image-cache/items/  image-cache/creatures/
exports/
logs/
```

---

## 6. Iconos e imágenes de items

1. A partir de `items.wiki_name` (de `/item_metadata`) se construye `https://www.tibiawiki.com.br/wiki/Special:FilePath/<Wiki_Name>.gif`.
2. El renderer pide `tt-img://item/<tibia_item_id>`. El proceso `main` lo sirve desde `image-cache/items/<id>.gif` o, si no está, lo descarga (en una cola con concurrencia limitada) y lo guarda.
3. Si no hay `wiki_name` o da 404, se prueba con `name`. Si tampoco funciona, se usa un placeholder por categoría (las Soul Cores llevan un icono genérico). Cada item admite un override manual.
4. Criaturas: primero el `image_url` de TibiaData; si falla, `creature_gifs.json`.
5. En Settings: "Precargar todos los iconos" (opcional) y un reporte de cobertura real.

Se usan en ItemPicker, Catálogo, Market Explorer, Arbitrage, Cart Builder e Imbuements. Como experimento opcional en la Fase 7, se puede sugerir el item de una captura comparando su icono de 32×32 con los iconos en caché.

---

## 7. Modelo de datos: cambios sobre CODEX §6

Se adopta el esquema del CODEX con estos cambios:

| Tabla | Cambio | Por qué |
|---|---|---|
| `worlds` | Se añaden `transfer_type`, `battleye_date`, `game_world_type`, `is_active` y `last_seen_in_tibiadata_at` | TibiaData los ofrece. Tibiamarket lista 113 mundos y TibiaData 90 activos, así que hay mundos fusionados o cerrados |
| `items` | `external_item_id` pasa a ser `tibia_item_id` (UNIQUE). Se añaden `wiki_name`, `tier`, `npc_buy_json`, `npc_sell_json` e `icon_status` | Une catálogo, iconos y terceros |
| `market_scans` | Se añaden `source` (`own_capture` / `third_party` / `manual`), `source_ref` y `observed_at_utc`. `screenshot_id` pasa a ser nullable | Los datos de terceros no tienen captura, y la hora del dato no es la hora de importación |
| `market_offers` | Se añade `expires_at_utc` cuando el dato viene de terceros | En `/market_board`, `time` parece ser el vencimiento: la oferta más reciente vence unos 30 días después del escaneo. Hay que confirmarlo |
| **`market_stats`** (nueva) | Mundo, item, ventana (`30d`/`1d`), lado, `transactions`, precio `avg`/`min`/`max`, `source`, `observed_at_utc` y `scan_id` | Estadísticas oficiales (de Details) o de terceros, separadas de las ofertas |
| `economic_rule_versions` | La regla `market_fee` lleva `basis: 'unit' \| 'total'` | El manual no aclara la base |
| **`tracked_characters`**, **`character_events`** (nuevas) | Nombre, mundo, último nivel, muertes vistas | Migración del tracker |
| **`external_fetch_log`** (nueva) | Host, endpoint, `fetched_at`, status, etag/hash y duración | Caché, rate limit y procedencia |
| **`alert_rules`**, **`alert_events`** (nuevas) | Regla, último disparo y clave de deduplicación | F-020 sin alertas duplicadas |

---

## 8. Plan por fases

Tamaños relativos: **S** < **M** < **L**. Cada fase termina con `npm run check` en verde (tsc + lint + tests + dependency-cruiser) y su documentación al día.

```text
F0 spike ─────────────────────────► F6 Collector ─► F7 OCR ─► F8 Snapshots ─► F10 Explorer ─► F11 Cart
F1 esqueleto ─► F2 paridad v1                                     ▲              ▲
F1 ─► F3 catálogos ─► F4 terceros ─► F5 motor económico ──────────┴─► F9 TC/transfers
F8 ─► F12 asistida        (F13 empaquetado al final; F14 PWA después de F2/F10)
```

### Hito A: Fundaciones y paridad

**Fase 0: Spikes y evidencia** (M). Ataca primero el mayor riesgo; el resto del plan da valor aunque el OCR resulte difícil.
- **OCR**: con 20 a 30 capturas reales tuyas (Offers buy/sell, Details y TC) a tu resolución y escala, comparar el matcher de glifos contra tesseract.js en precio y cantidad, y medir la exactitud por campo.
- **Captura**: probar `desktopCapturer` sobre el cliente de Tibia en modo ventana y en pantalla completa. El riesgo es obtener frames negros por la aceleración de GPU.
- **Comisión**: en el panel de crear oferta, escribir precio y cantidad y anotar el *fee* que muestra el cliente, **sin confirmar**. Así se cierra la base (unitaria o total) y el redondeo.
- **Transferencias**: confirmar en el FAQ oficial qué viaja con el personaje (depot, inbox, stash, banco). Si el depot viaja, la capacidad deja de ser la restricción principal del Cart Builder.
- **Tibiamarket**: revisar sus condiciones antes de usarla de forma sistemática.
- **Entregable**: `docs/SPIKE_REPORT.md` con métricas medidas, las decisiones D1 a D6 cerradas y un CLI `ocr-eval` que procesa una imagen y devuelve JSON.

**Fase 1: Esqueleto** (M)
- Rama `v2` y tag `flet-v1`; sacar `msedgedriver.exe` del tracking.
- electron-vite + React + TS strict + Tailwind. Layout con sidebar y todas las secciones vacías; tema oscuro por defecto.
- Contrato IPC con zod, `PlatformApi` y hardening de Electron (contextIsolation, sandbox, CSP, allowlist de hosts).
- SQLite + Drizzle + migración inicial con todas las tablas de §7, más backup y restore.
- Paths, logging, manejo de errores, dependency-cruiser, Vitest y un smoke test con Playwright.
- **Aceptación**: la app abre, crea la DB y navega; pasan las pruebas de migración y de backup/restore.

**Fase 2: Migración de Tibia Tools v1** (S)
- Overview con Rashid (día de servidor) y Boosted creature/boss (TibiaData).
- Share Exp (corregido), Split Loot, Imbuements (catálogo completo y total, con precios manuales por ahora) y Personajes (el tracker pasa a generar eventos).
- Tests de bordes: Share Exp (nivel 100 → 67–150), Split Loot con un texto real del Party Hunt Analyzer, y Rashid antes y después de las 10:00 CET.
- **Entregable**: paridad funcional con la v1 más las correcciones. Desde aquí ya se puede usar a diario.

### Hito B: Catálogos y datos

**Fase 3: Catálogos con iconos** (M)
- Sincronización de mundos con TibiaData, guardando fuente y fecha; edición manual.
- Items desde el seed de `/item_metadata` con refresco manual; peso y stack desde tibiawiki-sql.
- Caché de imágenes con `tt-img://`, más `ItemIcon`, `ItemPicker` (búsqueda difusa) y `WorldPicker`.
- Pantalla Catálogo: items por categoría con icono, precios NPC y cobertura de iconos.
- **Aceptación**: el catálogo funciona sin red; se muestra la cobertura real de iconos.

**Fase 4: Datos de terceros (tibiamarket)** (S/M)
- Adaptador `MarketDataSource` para `market_values`, `market_board`, `item_comparison` y `world_data`. Funciona bajo demanda (por item o por mundo), con caché y un rate limit conservador.
- Los datos se importan con `source = third_party` y con el `observed_at` del dato, no el de la importación.
- Primera versión de Market Explorer y Price History con estos datos, mostrando la antigüedad y el badge "Terceros".
- Imbuements: precio sugerido de materiales (editable).
- **Aceptación**: ningún dato de terceros aparece sin badge ni antigüedad, y la app sigue funcionando si la API cae.

**Fase 5: Motor económico** (L)
- Funciones puras en `core`:
  - Recorrido del order book: compra escalonada, liquidación inmediata y `unfilled_quantity`.
  - Comisión versionada, con la base que se haya confirmado en la Fase 0.
  - Estrategias Instant, Historical (P25/P50/P75 con muestra mínima) y Hybrid.
  - Conversión GP/TC según el lado del mercado.
  - ROI con sus dos denominadores y score con pesos configurables.
- Escenarios en `tests/economic-scenarios/`: ganancia, pérdida, llenado parcial, sin contraparte, muestra insuficiente, comisión mínima y máxima, y límites de enteros.
- **Aceptación**: escenarios reproducibles en verde y ningún `float` para dinero (regla de lint).

### Hito C: MVP Arbitrage con datos propios

**Fase 6: Collector manual** (M)
- Selección de pantalla o ventana, overlay de región, captura con atajo global configurable e importación PNG/JPG/BMP con límites de tamaño.
- Evidencia: original intacto, sha256 (para deduplicar), dimensiones y timestamps local y UTC.
- El usuario asocia mundo, item y tipo de pantalla (offers / details / tc) con los pickers visuales.
- Perfiles OCR por resolución y escala, con un editor visual de regiones sobre una captura.
- **Aceptación**: captura e importación funcionando con el cliente real; nunca se envía input al cliente.

**Fase 7: OCR + Review** (L)
- Pipeline en un worker: perfil → recortes → preprocesado → glifos → filas → validación, guardando `raw_text`, valor normalizado y confianza por campo.
- Validación cruzada: cantidad × precio unitario = total (si la vista muestra el total) y precios ordenados según el lado.
- Parsers de Offers, Details y TC.
- Pantalla OCR Review: captura, recortes y tabla editable. Las correcciones se auditan en `ocr_field_reviews`, y al confirmar se crea un snapshot inmutable.
- **Aceptación**: exactitud medida con `ocr-eval` sobre al menos 200 filas anotadas; los umbrales se fijan con esa medición.

**Fase 8: Snapshots, eventos e histórico propio** (M)
- Consultas por mundo e item. El diff entre snapshots genera los estados `observed`, `possibly_filled`, `possibly_removed` y `expired_unknown`.
- Estadísticas con su metodología documentada. La liquidez combina estadísticas oficiales y eventos inferidos, etiquetados por separado.
- Instant sobre capturas propias de dos mundos, mostrando la evidencia (ofertas y timestamps usados).
- **Este es el MVP del CODEX**: capturar, corregir, guardar y consultar snapshots de dos mundos, y calcular Instant de forma reproducible.

### Hito D: Completo

- **Fase 9: TC y transferencias** (M)
  - Cotizaciones de TC por mundo (OCR y terceros), con spread e histórico.
  - Reglas dirigidas origen → destino. Los atributos de TibiaData generan *candidatos*, como "bloqueado por PvP", citando la regla oficial. Lo que no se pueda derivar queda en `unknown`.
  - Checklist del personaje y costos versionados. `final_status` solo puede ser `eligible` si todo está verificado.
- **Fase 10: Arbitrage Explorer, alertas y exportación** (M)
  - Matriz de rutas y rankings separados: Best Profit, ROI, Liquidity y Risk Adjusted.
  - Detalle de la evidencia de cada resultado y filtros por antigüedad y fuente.
  - Alertas locales con deduplicación y notificaciones de Windows.
  - Exportación a CSV y JSON, y reporte de simulación.
- **Fase 11: Cart Builder** (M)
  - Heurística greedy documentada (sin afirmar que sea óptima).
  - Restricciones: presupuesto en GP, TC elegibles y capacidad/slots (solo si aplican según la Fase 0).
  - Comparación de carritos.
- **Fase 12: Captura asistida** (S/M)
  - Observa solo la región seleccionada, con diff o pHash y debounce.
  - Muestra un preview antes de guardar y permite pausar y detener al instante.
- **Fase 13: Empaquetado** (S)
  - electron-builder NSIS x64, icono, versión y rutas de producción.
  - Prueba en un Windows limpio y documentación de backup y actualización.
- **Fase 14: PWA companion** (M, opcional)
  - Build web del renderer con `platform/web.ts`.
  - Incluye las herramientas (Rashid, boosted, Share Exp, Split Loot, Imbuements) y un visor de análisis exportados. Sin Collector.

---

## 9. Riesgos técnicos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La captura del cliente sale negra (GPU o pantalla completa) | Bloquea el Collector | Spike en Fase 0, modo ventana y la importación manual como respaldo |
| El escalado de Windows o la escala de la GUI de Tibia cambia el tamaño de los glifos | El OCR falla | Perfiles por escala, atlas de glifos por escala entera y detección de escala |
| El OCR confunde dígitos (8/0/6, 1/7) o separadores | Precios erróneos generan oportunidades falsas | Revisión obligatoria bajo el umbral y validaciones cruzadas (total y orden) |
| Tibiamarket cambia, cae o limita | Se pierden catálogo y datos de terceros | Seed local del catálogo; todo bajo demanda y con caché; nada depende de ella para funcionar |
| Nombres de la wiki que no coinciden | Faltan iconos | Fallback por nombre, placeholder por categoría y override manual |
| better-sqlite3 (módulo nativo) contra la versión de Electron | Build roto | `electron-builder install-app-deps` y versiones fijadas |
| Cambian las reglas del juego (comisión, transferencias) | Cálculos erróneos | Reglas versionadas con fuente y fecha, y alerta de "regla vencida" |
| Reglas de CipSoft sobre herramientas externas | Riesgo para la cuenta | Solo captura de pantalla y análisis. El atajo global actúa únicamente sobre esta app y nunca se envía input al cliente. Revisar las reglas antes de distribuir |

---

## 10. Decisiones abiertas

| # | Decisión | Recomendación |
|---|---|---|
| D1 | ¿Usar tibiamarket como fuente de terceros? (el CODEX decía "solo observaciones propias") | Sí, etiquetada, con su antigüedad visible y sin mezclarla nunca con otras fuentes sin desglose |
| D2 | ¿Migrar en este repo o en uno nuevo? | En este repo, rama `v2`, con el tag `flet-v1` sobre el estado actual |
| D3 | ¿Reescribir el historial de git para quitar `msedgedriver.exe`? | Basta con dejar de versionarlo; reescribir el historial solo si te importa el tamaño del clone |
| D4 | ¿Se mantiene Mini World Changes / Oriental Trader? | Aplazarlo hasta tener una fuente que no requiera Selenium |
| D5 | Idioma de la UI | Español, con los términos del juego en inglés (Market, Buy/Sell offers, Tibia Coins) |
| D6 | ¿Qué dos mundos se usan para el MVP? | Tu mundo actual y el destino más probable |

### Lo que necesito de ti para la Fase 0

1. Entre 20 y 30 capturas del Market: Offers (buy y sell), Details y el mercado de Tibia Coins, a tu resolución y escala habituales. Lo ideal es incluir algunas con números grandes, cantidades de 1 a 4 dígitos y listas largas.
2. Tu resolución, el escalado de Windows y si juegas en ventana o en pantalla completa.
3. El *fee* que muestra el panel de crear oferta para 2 o 3 combinaciones de precio y cantidad, sin confirmar la oferta.
4. Tus respuestas a D1–D6.

---

## 11. Definition of Done

Se hereda el §15 del CODEX y se añade:

- `npm run check` en verde: tsc, ESLint, Vitest y dependency-cruiser.
- Ningún dato visible sin badge de procedencia ni antigüedad.
- Ningún `float` para dinero.
- Ninguna automatización del cliente.
- La documentación de la fase está actualizada.

---

## 12. Fuentes consultadas (02-11-2026)

- Manual del Market: https://www.tibia.com/gameguides/?section=controls_trading&subtopic=manual
- FAQ de transferencias: https://www.tibia.com/support/?subtopic=gethelp&entryid=55 (se verifica en la Fase 0)
- TibiaData: https://docs.tibiadata.com/ y https://docs.tibiadata.com/swagger.json
- Tibia Market API: https://api.tibiamarket.top/openapi.json
- TibiaWiki BR: https://www.tibiawiki.com.br/
- tibiawiki-sql: https://github.com/Galarzaa90/tibiawiki-sql

---

## 13. Estado de implementación (02-11-2026)

| Fase | Estado | Qué quedó / qué falta |
|---|---|---|
| 0 Spikes | Parcial | Reglas, fuentes y APIs verificadas ([SPIKE_REPORT.md](SPIKE_REPORT.md)); CLI `npm run ocr:eval`. **Falta**: capturas reales, medir el OCR, base del fee, captura con el cliente de Tibia abierto |
| 1 Esqueleto | Hecho | Electron 45 + React 19 + Vite 8 + TS 6 + Tailwind 4; IPC validado con zod; SQLite con migraciones; backup/restore; logging; dependency-cruiser |
| 2 Migración v1 | Hecho | Rashid (día de servidor), boosted (TibiaData + fallback de GIFs de la v1), Share Exp corregido, Split Loot, 24 imbuements, tracker de personajes |
| 3 Catálogos | Hecho | 5,121 items + 90 mundos activos; iconos de TibiaWiki BR en caché; ItemPicker/WorldPicker; peso/stack vía tibiawiki-sql (script; seed vacío hasta que lo generes) |
| 4 Terceros | Hecho | Importación de tibiamarket bajo demanda (quotes, stats, order books) etiquetada como terceros |
| 5 Motor económico | Hecho | Instant, Historical, Hybrid, comisión versionada, TC, ROI, score; escenarios con pruebas |
| 6 Collector | Hecho | Fuente sin diálogo, región sobre la vista en vivo, atajo global, importación, evidencia con SHA-256 |
| 7 OCR + Review | Hecho* | Matcher de glifos en Web Worker, editor de perfiles, calibración, tabla editable, auditoría. *Sin medición real |
| 8 Snapshots/eventos | Hecho | Snapshots inmutables, eventos inferidos, estadísticas e histórico |
| 9 TC y transferencias | Hecho | Cotizaciones/spread/histórico; reglas oficiales; checklist; reglas manuales; costo vía TC del origen |
| 10 Explorer/alertas/export | Hecho | Rankings separados, evidencia por resultado, matriz de rutas, alertas con deduplicación, CSV/JSON |
| 11 Cart Builder | Hecho | Greedy con tres órdenes, guardado y exportación |
| 12 Captura asistida | Hecho | Detección de cambios + debounce + preview o guardado automático, pausa y stop |
| 13 Empaquetado | Hecho* | `npm run dist` (NSIS x64); `win-unpacked` probado con el smoke test. *Falta Windows limpio y firma |
| 14 PWA companion | Hecho | `npm run build:web`; herramientas, catálogo y TibiaData; responsive; offline con service worker |

### Desviaciones respecto a este plan

| Plan | Implementado | Motivo |
|---|---|---|
| better-sqlite3 + Drizzle | `node:sqlite` + SQL explícito + migraciones propias | Electron 45 trae Node 24 con SQLite integrado: sin módulos nativos ni recompilación |
| Ventana overlay transparente para la región | Región dibujada sobre la vista en vivo dentro de la app | Más simple; no pone ventanas encima del juego |
| tesseract.js como respaldo | No incluido | Se decide con las mediciones reales; el pipeline admite otro reconocedor |
| react-hook-form, TanStack Table | Formularios controlados y tabla propia ordenable | Menos dependencias; TanStack Table v9 cambió su API |
| Seed de imbuements descargado por script | Parser de una copia guardada de la página | TibiaWiki rechaza `api.php` a clientes que no son navegadores; no se falsea el User-Agent |
| Corrección post-confirmación como scan nuevo | Esquema listo (`supersedes_scan_id`), sin UI | Pendiente |

