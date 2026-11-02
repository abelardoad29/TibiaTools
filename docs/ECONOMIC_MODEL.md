# Modelo económico

Todo vive en `src/core/domain` como funciones puras con pruebas en `tests/economic-scenarios/`.

## Dinero

- GP son enteros seguros (`assertGp`); multiplicaciones y sumas fallan antes de perder precisión.
- Redondeo explícito: `divRound(n, d, 'ceil' | 'floor' | 'round')`, `applyBps(valor, bps, redondeo)`.
- `parseGp` acepta `1,234,567`, `15k`, `1.5kk`, `-12,345` sin usar floats.

## Comisión del Market

`fee = clamp(mín, máx, redondeo(base × tasa))`, cobrada **solo al publicar** una oferta.

- Valores vigentes (manual, verificado el 02-11-2026): 2.5 %, mínimo 20 gp, máximo 2,500,000 gp, ofertas de 30 días.
- **Base y redondeo sin verificar**: el manual dice "the price of the offer". Por defecto se usa el total (precio × cantidad) con redondeo hacia arriba, y la UI lo advierte hasta que lo verifiques con el panel de crear oferta.
- Aceptar una oferta existente (Instant) no paga comisión.

## Compra escalonada y liquidación inmediata

`walkBook` consume niveles ordenados (sell ascendente, buy descendente), paga cada unidad al precio de su nivel y devuelve `unfilled`.

`instantArbitrage` cruza los dos libros con dos punteros:
- Modo por defecto: toma unidades mientras `buy destino > sell origen`.
- Modo cantidad fija: compra Q aunque no haya margen e informa `withoutDestinationBuyer` y `unfilledInOrigin`.
- Respeta el presupuesto con cantidades enteras.

## Historical

Precio objetivo en destino = P25 / P50 / P75 de las **sell offers observadas** (cada nivel de cada snapshot, 30 días). Ingreso = precio × cantidad; neto = ingreso − compra − comisión de publicación.

- Muestra mínima configurable (5 snapshots por defecto): 3–4 snapshots → `experimental`; menos → bloqueado.
- La cantidad son las unidades del origen que dejan margen contra P50 después de la comisión estimada.
- `minDaysToSell = cantidad / ventas oficiales por día`: es una cota inferior (suponer que vendes todo el volumen); riesgo de no venta alto si supera la mitad de la vigencia de 30 días.
- Los precios observados son ofertas, no ventas: la estimación no es una predicción.

## Hybrid

Calcula ambos y recomienda Instant si `neto_instant ≥ neto_historical × descuento` (0.5 por defecto, configurable). La UI muestra siempre los dos resultados.

## Ganancia y ROI

`neto = ingreso − compra − comisiones − transferencia − otros`

- `roiCommitted = neto / (compra + comisiones)`
- `roiPurchase = neto / compra`

El costo de transferencia es **por viaje**: se descuenta una vez a nivel de ruta y de carrito, no por item.

## Liquidez

- **Oficial**: transacciones de 30 días de la vista Details (propia o de terceros) → `officialTransactionsPerDay`.
- **Inferida**: suma de `possibly_filled` entre snapshots propios → `estimatedPossibleFillsPerDay`.
- Score logarítmico 0–100 (1/día ≈ 15, 10/día ≈ 52, 100/día = 100); lo inferido pesa la mitad.

## Score

Componentes 0–100: ROI (100 al llegar al ROI configurado; 50 % por defecto), liquidez, confianza (peor evidencia: fuente × frescura con vida media de 24 h × confianza OCR; terceros × 0.6) y estabilidad (100 × (1 − CV)). Pesos por defecto: 35 / 30 / 20 / 15. El score solo ordena; las métricas originales siempre se muestran.

## Eventos entre snapshots

Por nivel de precio: cantidad reducida → `amount_reduced` + `possibly_filled`; nivel que desaparece → `possibly_filled` (si era el mejor precio), `possibly_removed` (si no) o `expired_unknown` (si vencía antes); nivel nuevo → `first_seen`; desaparece y aparece otro con la misma cantidad → `price_changed` (confianza baja). Nunca hay "vendido confirmado".

## Imbuements

- Tarifas del santuario 7,500 / 60,000 / 250,000 gp (100 % de éxito desde el 12-06-2025); duración 20 h de uso (el tiempo corre con el item equipado y fuera de zona de protección).
- Opciones evaluadas: todos los materiales en el Market; paquetes de Yana con Gold Tokens (Basic 2, Intricate 4, Powerful 6 tokens, solo Strike / Vampirism / Void) combinados con comprar el resto en el Market; y el scroll ya inscrito si tiene precio en el Market. Se elige la más barata con todos los precios.
- **Mis items imbuidos**: solo items imbuibles, con sus slots reales (1 a 3) y los imbuements que acepta su tipo y vocación (TibiaWiki EN; las excepciones de notas se habilitan a mano). Sin imbuements repetidos en un item. Cada slot puede tener precios propios o el total pagado, que mandan sobre los globales. Costo por ciclo (20 h), por hora y por hunt.

## Tibia Coins

Comprar TC consume sell offers; vender TC consume buy offers. El costo de la transferencia en GP se calcula comprando los TC necesarios en el Market del **origen**. La app advierte que hay que confirmar que esas TC sirven en la Store.

## Cart Builder

Greedy: arma lotes por nivel de oferta (Instant) o por item (Historical), los ordena por ROI, por ganancia o por ganancia/oz, y toma unidades enteras mientras haya presupuesto, cupo por item y, si se configuran, capacidad y slots. No garantiza el óptimo. Según el manual, banco, depot, stash e inbox viajan con el personaje, así que la capacidad es opcional.
