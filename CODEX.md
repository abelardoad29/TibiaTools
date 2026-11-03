# CODEX: instrucciones permanentes (Tibia Tools 2.0)

Este archivo reemplaza a la especificación original en PySide6 ([docs/CODEX-v1-pyside.md](docs/CODEX-v1-pyside.md)). Sus **principios** siguen vigentes; el stack cambió a Electron + React + TypeScript (ver [docs/PLAN.md §3](docs/PLAN.md)).

## Principios no negociables

1. **No automatizar el cliente de Tibia.** Solo se leen capturas de pantalla elegidas por el usuario. Nada de clics, teclas, lectura de memoria, inyección ni paquetes. El atajo global solo dispara una captura en esta app.
2. **No inventar datos.** Si falta un precio, una regla o un peso, el resultado es `null`/`unknown` con una advertencia; nunca un 0 ni un valor por defecto silencioso.
3. **Observado ≠ inferido ≠ estimado.** Toda cifra visible lleva su procedencia (`ProvenanceBadge`) y su antigüedad (`Freshness`). Una oferta que desaparece nunca es una "venta confirmada".
4. **Las rutas desconocidas no son ejecutables.** Cualquier regla `unknown` o vencida produce `unverified`.
5. **Dinero en enteros.** GP son enteros seguros (`assertGp`); redondeo explícito (`divRound`, `applyBps`); nada de `float` para dinero.
6. **Reglas externas versionadas.** Comisión, costos de transferencia y reglas de mundos llevan fuente y fecha de verificación (`economic_rule_versions`, `seed/transfer_rules.json`).
7. **No sobrestimar el OCR.** Ninguna precisión se declara sin un dataset anotado (`npm run ocr:eval`).
8. **Datos de terceros etiquetados.** Lo de tibiamarket.top se guarda como `third_party`, con la hora del dato, y nunca se mezcla sin desglose.

## Capas (las verifica `npm run depcruise`)

- `src/core`: TypeScript puro (dominio, OCR). No importa `electron`, `react`, `node:*` ni otras capas.
- `src/main`: proceso principal = infraestructura (SQLite `node:sqlite`, HTTP, captura, protocolos, IPC).
- `src/preload`: un único puente `window.tibia` (invoke + eventos).
- `src/renderer`: React. Solo habla con main a través de `PlatformApi` (`src/renderer/platform`).
- `src/shared`: contrato IPC (`api.ts`), procedencia y ajustes.

## Antes de modificar código

1. Lee este archivo y la sección relevante de [docs/PLAN.md](docs/PLAN.md).
2. Identifica la fase y el requisito.
3. Implementa solo ese alcance. Toda entrada IPC nueva necesita su schema zod en `src/main/ipc/schemas.ts`.
4. Corre `npm run check` (y `npm run test:e2e` si tocaste UI o main).
5. Actualiza la documentación de `docs/`.
6. Resume cambios, comandos, resultados y riesgos. No marques como terminado lo que no probaste.
