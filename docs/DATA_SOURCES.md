# Fuentes de datos

| Fuente | Uso | Procedencia en la app | Límites respetados |
|---|---|---|---|
| Capturas propias + OCR revisado | Order books y estadísticas oficiales (vista Details) | `own_capture` / `official_stats` | — |
| [TibiaData](https://docs.tibiadata.com) v4 | Mundos, boosted creature/boss, personajes | metadatos | Caché de 30–60 min; ≥ 250 ms entre llamadas; sin datos de Market |
| [tibiamarket.top](https://api.tibiamarket.top/openapi.json) | Catálogo de items (ids, categorías, NPC), precios y estadísticas de terceros, order books bajo demanda | `third_party` con la hora del dato | Caché 30 min; ≥ 1 s entre llamadas; solo bajo demanda. Al 02-11-2026 la mediana de antigüedad era de 59 días: **no es precio en vivo** |
| TibiaWiki BR (`Special:FilePath`) | Iconos de items | — | Caché permanente en disco; ≤ 8 req/s; cola de 4 descargas |
| `seed/creature_gifs.json` (v1) | Imagen de respaldo para criaturas | — | Local |
| tibiawiki-sql | Peso y apilable (`seed/items_physical.json`) | metadatos | Offline: lo genera el usuario |
| Manual oficial de Tibia | Comisión, duración de ofertas, reglas de transferencia | reglas versionadas | Revisar al cambiar |

Todas las peticiones usan el User-Agent `TibiaTools/2.0 (personal desktop app; +https://github.com/abelardoad29/TibiaTools)` y quedan en `external_fetch_log`. La app nunca se hace pasar por un navegador. TibiaWiki rechaza a clientes que no son navegadores en su `api.php`: por eso el catálogo de imbuements se genera desde una copia de la página guardada a mano (`npm run seed:imbuements -- <archivo>`).

## Seeds versionados (`seed/`)

| Archivo | Origen | Regenerar |
|---|---|---|
| `items.json` | `/item_metadata` de tibiamarket | `npm run seed:fetch` |
| `worlds.json` | TibiaData `/v4/worlds` + mundos que solo lista tibiamarket | `npm run seed:fetch` |
| `imbuements.json` | Página Imbuements de TibiaWiki BR (24 imbuements; todos los materiales existen en el catálogo) | `npm run seed:imbuements -- <pagina>` |
| `economic_rules.json` | Manual oficial (comisión 2.5 %, mín. 20, máx. 2.5M; 30 días) | a mano, con fuente |
| `transfer_rules.json` | Manual oficial, sección Character World Transfer | a mano, con fuente |
| `items_physical.json` | tibiawiki-sql | `python scripts/seed-tibiawiki-sql.py tibiawiki.db` |
| `creature_gifs.json` | Tibia Tools v1 | — |
