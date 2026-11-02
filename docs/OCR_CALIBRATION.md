# Calibración del OCR

El Market de Tibia dibuja números con una fuente bitmap. En lugar de un OCR genérico, la app **aprende los glifos de tus propias capturas** y los compara píxel a píxel (similitud de Jaccard sobre la tinta). No hay coordenadas universales: cada perfil sirve para una resolución, una escala de la GUI y una región concretas.

## De dónde salen las capturas

- **Recomendado: la tecla de screenshot del propio Tibia.** El cliente guarda los archivos en `%LOCALAPPDATA%\Tibia\packages\Tibia\screenshots` con el nombre `AAAA-MM-DD_HHMMSSmmm_<Personaje>_Hotkey.png`. Con «Importar automáticamente» (Collector) cada captura nueva entra sola, con la hora real tomada del nombre. Por defecto solo se importan las `_Hotkey` (no las automáticas de LevelUp, SkillUp…).
- Capturar la **ventana** de Tibia desde la app puede salir en negro (aceleración por GPU): la app detecta el frame negro y no lo guarda. Alternativa: elegir **Pantalla** y marcar la región del Market.

## Crear un perfil (Revisión OCR → Crear)

1. Usa siempre el mismo tipo de captura para un perfil: los screenshots del cliente son de la ventana completa (p. ej. 1920×1080), así que el perfil se dibuja sobre una de ellas. Mantén la ventana del Market en el mismo lugar y no cambies la escala de la GUI entre capturas.
2. **Ofertas**: dibuja el área de cada tabla (Sell / Buy offers) **sin la cabecera**, y luego cada columna que quieras leer: Cantidad, Precio unidad, Total (recomendado: permite validar `cantidad × precio = total`) y Vence.
3. **Details**: dibuja cada valor (transacciones, máximo, promedio, mínimo) de cada lado.
4. **Calibrar glifos**: elige «Calibrar glifos», dibuja un rectángulo ajustado a **una sola línea** (por ejemplo un precio), revisa la vista binarizada y escribe el texto exacto. Repite hasta cubrir `0–9` y la coma. Si la cantidad de glifos no coincide con el texto, ajusta el umbral (`otsu` o un número 0–255) o el recorte.
5. Guarda. Cada guardado sube la versión del perfil; los scans guardan qué versión usaron.

Opciones: alto de fila fijo (si la detección automática falla), texto oscuro sobre fondo claro, separación mínima entre palabras.

## Revisión

- Cada campo muestra el texto crudo, el valor normalizado y la confianza (peor glifo del campo, rebajada si la segunda opción está muy cerca).
- Umbrales configurables: ≥ 0.98 aceptación sugerida, 0.90–0.979 revisar, < 0.90 revisión obligatoria (hay que marcar «Revisado» o corregir). **No son precisión garantizada.**
- Validaciones: valores positivos, total coherente y orden de precios por lado (sell ascendente, buy descendente).
- Un glifo desconocido deja el campo ilegible en vez de adivinar.

## Medir la exactitud

1. Guarda capturas reales en `tests/ocr/fixtures/private/` (no se versionan) con un JSON por imagen:

```json
{ "profile": "perfil.json", "rows": [{ "side": "sell", "amount": 25, "unitPrice": 1000, "totalPrice": 25000 }] }
```

2. Exporta el perfil desde la app y ejecuta:

```bash
npm run ocr:eval -- --dataset tests/ocr/fixtures/private
```

El CODEX pide al menos 200 filas anotadas (resoluciones, separadores, cantidades de 1 a 4+ dígitos, filas parciales, UI superpuesta) antes de fijar el umbral de aceptación.
