# Reglas de transferencia

Fuente: [manual oficial, sección Character World Transfer](https://www.tibia.com/gameguides/?subtopic=manual&section=products) y [FAQ](https://www.tibia.com/support/?subtopic=gethelp&entryid=55), consultados el 02-11-2026. Codificadas en [seed/transfer_rules.json](../seed/transfer_rules.json) (vigencia de 180 días; luego todo pasa a `unknown`).

## Ruta general (`evaluateRoute`)

| Regla | Evaluación |
|---|---|
| PvP | Optional → Optional. Open / Retro Open → su tipo u Optional. Hardcore / Retro Hardcore → cualquiera. Si el destino no está permitido pero podría tener "looser transfer conditions" (TibiaData no lo informa), el resultado es `unknown`, no `blocked` |
| BattlEye | A un mundo protegido **desde el lanzamiento** (`battleye_date = "release"`) solo desde otro igual. Los experimentales son excepción |
| Blocked | No se puede entrar a un mundo `blocked`; sí salir |
| Locked | Cualquiera puede ir a un mundo `locked`; desde uno `locked` solo a otros `locked` |
| Vigencia | Reglas vencidas → `unknown` |
| Manual | Una regla verificada por el usuario (con fuente y vencimiento) se suma a la evaluación |

Resultado: cualquier `fail` → `blocked`; cualquier `unknown` → `unknown` (la UI dice "No verificada"); si no, `allowed`.

## Requisitos del personaje (`characterChecklist`)

Sin red/black skull · no ser líder de guild · sin casa alquilada · sin ofertas de Market con Tibia Coins · estar en el continente principal · transferencia regular solo si no hubo otra en 6 meses (si no, Express) · Hardcore → Hardcore no permitido si visitó Calva/Calvera. Cada dato es sí / no / sin confirmar.

`finalTransferStatus` solo es `eligible` si la ruta está permitida y todo el checklist está confirmado.

## Lo que viaja con el personaje

Según el manual: banco, depot, stash, inbox, skills, hechizos y quest flags. Las ofertas abiertas del Market se cancelan (los items de sell offers van al inbox). Por eso la capacidad no limita el arbitraje.

## Costos

El manual no publica los precios en Tibia Coins. Se configuran en Ajustes → Reglas económicas (versionados con fecha). El traslado a Travora cuesta 1,000 gp.
