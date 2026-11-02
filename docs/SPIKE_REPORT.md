# Fase 0: reporte de spikes y evidencia

Fecha: 02-11-2026.

## Verificado

| Tema | Resultado | Evidencia |
|---|---|---|
| Comisión del Market | 2.5 %, mín. 20 gp, máx. 2,500,000 gp; se cobra al publicar y se pierde al cancelar; ofertas de 30 días | Manual oficial (Market) |
| Base de la comisión | **No resuelto**: el manual dice "the price of the offer" | Pendiente: probar en el cliente sin confirmar la oferta |
| Estadísticas oficiales | La vista Details muestra, en 30 días, precio promedio, veces ofertado y **vendido**, y máximo/mínimo pagado; se actualizan en el server save | Manual oficial (Market) |
| Transferencias | PvP, BattlEye, blocked/locked, 6 meses, requisitos del personaje; banco, depot, stash e inbox viajan | Manual (Products → Character World Transfer) y FAQ 55 |
| Precio de transferencia en TC | No figura en el manual | Se configura a mano |
| TibiaData | v4/v5; 90 mundos con PvP, BattlEye (`release` = desde el lanzamiento: 51 mundos), `transfer_type` (70 regular, 18 blocked, 2 locked); boosted con `image_url`; CORS abierto; sin Market | API |
| tibiamarket.top | API pública (OpenAPI). 113 mundos; 0 actualizados en 14 días, 2 en 30, 92 en 90; mediana de 59 días. 5,121 items con id, categoría, `wiki_name` y NPC. 126 nombres repetidos | API |
| Iconos | TibiaWiki BR `Special:FilePath`: 29/30 items normales y 0/5 Soul Cores en una muestra; funciona desde Electron con un User-Agent propio | Prueba con la app real |
| Imbuements | 24 imbuements con 3 materiales cada uno; los 72 materiales existen en el catálogo | Página de TibiaWiki BR (copia guardada) |
| TibiaLabs (API de la v1) | No respondió | — |
| Captura | Elegir ventana → vista en vivo → capturar → evidencia con SHA-256 → aparece en Revisión OCR (verificado con la propia ventana de la app). **Con la ventana de Tibia sale en negro** (reportado por el usuario el 02-11-2026): la app ahora lo detecta y la vía principal es importar la carpeta de screenshots del cliente | `tests/e2e/smoke.mjs`, prueba de integración del watcher |
| SQLite | `node:sqlite` disponible en Electron 45 (Node 24.22, SQLite 3.53): sin módulos nativos | Prueba directa |

## Pendiente (requiere al usuario)

1. 20–30 capturas reales del Market (Offers, Details y Tibia Coins) para calibrar perfiles y medir con `npm run ocr:eval`. **No se declara ninguna precisión del OCR hasta entonces.** El pipeline está probado con una fuente sintética (tests/ocr).
2. Calibrar un perfil sobre un screenshot `_Hotkey` del cliente (ventana completa) y confirmar que la ventana del Market aparece siempre en la misma posición.
3. Anotar el *fee* del panel de crear oferta para 2–3 combinaciones de precio × cantidad y fijar base y redondeo en Ajustes.
4. Copiar los precios de transferencia (regular / express) desde la Store.
5. Revisar si tibiamarket.top publica condiciones de uso antes de usarla de forma intensiva (hoy solo se consulta bajo demanda, con caché y ≥ 1 s entre llamadas).
