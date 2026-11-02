# Base de datos

SQLite local (`%LOCALAPPDATA%\TibiaTools\tibia_tools.db`) con `journal_mode=WAL`, `foreign_keys=ON` y `quick_check` al abrir. La versión del esquema está en `PRAGMA user_version`; las migraciones viven en [src/main/db/migrations.ts](../src/main/db/migrations.ts) y nunca se editan una vez publicadas.

GP y cantidades son `INTEGER` (64 bits). Los cálculos usan enteros seguros en JavaScript (`assertGp`).

## Tablas

Se adopta el esquema del CODEX (§6) con estos cambios:

| Tabla | Diferencia con el CODEX | Motivo |
|---|---|---|
| `worlds` | `+ battleye_protected, battleye_date, transfer_type, game_world_type, premium_only, is_active, looser_transfer_conditions, last_seen_in_tibiadata_at` | Datos de TibiaData; mundos fusionados/cerrados quedan inactivos |
| `items` | `tibia_item_id` UNIQUE; `normalized_name` **no** es único; `+ wiki_name, tier, icon_status, icon_override_url, npc_buy_json, npc_sell_json` | El catálogo tiene 126 nombres repetidos con distinto id |
| `capture_sessions` | `world_id` nullable | Se puede capturar antes de asignar el mundo |
| `screenshots` | `+ region_json, screen_type, world_id, item_id` | Metadatos editables hasta confirmar |
| `market_scans` | `+ source (own_capture/third_party/manual), source_ref, observed_at_utc, profile_id, supersedes_scan_id`; `scan_type` admite `details`; `screenshot_id` nullable | Terceros sin captura; la hora del dato no es la de importación |
| `market_offers` | `+ total_price_gp` | Validación cruzada del OCR |
| `market_stats` (nueva) | Estadísticas agregadas por ventana (`30d`/`1d`) y lado | Vista Details oficial o terceros, separadas de las ofertas |
| `market_quotes` (nueva) | Mejor precio sin profundidad | `/market_values` de terceros: filtra candidatos sin inventar cantidades |
| `ocr_field_reviews` | `+ ocr_value, stats_id` | Auditoría de correcciones también en estadísticas |
| `market_events` | `+ note`; tipos `first_seen, amount_reduced, amount_increased, price_changed, possibly_filled, possibly_removed, expired_unknown` | No existe "vendido confirmado" |
| `tc_rates` | `+ source` | — |
| `arbitrage_runs` | `+ result_json` | Reabrir y exportar un análisis tal como se calculó |
| `transfer_profiles` | `+ is_on_main_continent, visited_calva` | Requisitos del manual oficial |
| `tracked_characters`, `character_events` (nuevas) | — | Tracker de la v1 |
| `external_fetch_log`, `http_cache` (nuevas) | — | Procedencia, caché y rate limit |
| `alert_rules`, `alert_events` (nuevas) | `UNIQUE(rule_id, dedupe_key)` | Alertas sin duplicados |
| `seed_versions` (nueva) | — | Recargar seeds solo cuando cambian |

## Inmutabilidad

- Una captura `confirmed` no se puede editar ni rechazar.
- Un scan confirmado no se sobrescribe. El esquema ya tiene `supersedes_scan_id` y el estado `superseded` para corregir creando un scan nuevo; **ese flujo todavía no tiene UI** (pendiente).
- Las correcciones del OCR quedan en `ocr_field_reviews` (valor crudo, valor OCR y valor corregido).

## Respaldo y restauración

- **Respaldo**: `VACUUM INTO` (consistente aunque haya WAL), con la versión del esquema en el nombre (`tibia_tools-v1-manual-<fecha>.db`).
- **Restauración**: valida integridad, versión (`1..última`) y tablas esperadas; crea antes un respaldo `pre-restore`, reemplaza la base y reinicia la app. Pide confirmación en la UI.
- Las capturas originales (`evidence/`) nunca se borran automáticamente.
