# Tibia Arbitrage --- Especificación técnica definitiva

**Versión:** 1.0\
**Fecha:** 31 de octubre de 2026\
**Plataforma:** Windows 10/11 x64\
**Propietario:** uso personal\
**Estado:** especificación base para desarrollo asistido por Codex

------------------------------------------------------------------------

## 1. Resumen ejecutivo

Tibia Arbitrage es una aplicación local de escritorio para analizar
diferencias de precios del Market de Tibia entre mundos y estimar
oportunidades de arbitraje mediante transferencia de personaje.

La aplicación recopila ofertas visibles mediante capturas de pantalla y
OCR, conserva observaciones históricas, calcula indicadores de liquidez
y compara dos estrategias:

1.  **Instant:** comprar en el mundo origen y liquidar contra ofertas de
    compra observadas en el destino.
2.  **Historical:** comprar en origen y publicar/vender en destino con
    base en estadísticas históricas, escenarios y tiempo estimado de
    salida.

También analiza Tibia Coins (TC), costos de Market, costos de
transferencia, restricciones de mundos y capacidad de transporte
configurada por el usuario.

### Decisiones cerradas

  -----------------------------------------------------------------------
  Área                                Decisión
  ----------------------------------- -----------------------------------
  Usuarios                            Un usuario local; sin registro ni
                                      multiusuario

  Plataforma                          Windows 10/11 x64

  Interfaz                            PySide6

  Captura                             Manual y asistida; el usuario
                                      controla el cliente

  OCR                                 OpenCV + Tesseract

  Backend                             No hay backend remoto en el MVP

  Persistencia                        SQLite local

  Catálogo de mundos                  Sincronización opcional con
                                      TibiaData

  Históricos                          Observaciones propias, no scraping
                                      de precios externos

  Análisis                            Python, NumPy/Pandas cuando aporte
                                      valor

  Empaquetado                         PyInstaller

  Distribución                        Ejecutable/instalador local

  Estrategias                         Instant, Historical y Hybrid

  Cobertura                           Todos los mundos conocidos;
                                      cobertura efectiva según capturas
                                      propias
  -----------------------------------------------------------------------

**Principio de diseño:** el sistema nunca debe presentar una estimación
como una transacción confirmada ni una ruta teórica como una
transferencia legalmente disponible.

------------------------------------------------------------------------

## 2. Objetivos y límites

### 2.1 Objetivos funcionales

-   Capturar una pantalla o región seleccionada manualmente.
-   Procesar imágenes importadas desde disco.
-   Reconocer mundo, objeto, tipo de oferta, precio, cantidad y
    vencimiento cuando sea legible.
-   Permitir corregir manualmente cualquier dato OCR.
-   Guardar captura original, recortes, texto OCR y resultado
    normalizado.
-   Mantener snapshots inmutables de ofertas observadas.
-   Reconstruir cambios entre snapshots sin afirmar ventas no
    verificadas.
-   Mantener catálogo local de mundos y objetos.
-   Registrar cotizaciones de TC por mundo y tipo de oferta.
-   Mantener reglas y costos de transferencia con fuente y fecha de
    verificación.
-   Calcular arbitraje instantáneo, histórico e híbrido.
-   Simular cantidades, presupuesto, capacidad y costos.
-   Construir carritos sugeridos.
-   Mostrar frescura, cobertura, confianza y procedencia de cada dato.
-   Exportar resultados a CSV y JSON.
-   Realizar respaldos y restauraciones de la base de datos.

### 2.2 No objetivos del MVP

-   Comprar, vender, ofertar o transferir dentro del juego.
-   Automatizar clics, teclado, navegación o interacción con el cliente.
-   Leer memoria del proceso, inyectar código, inspeccionar paquetes
    privados o eludir protecciones.
-   Guardar credenciales de Tibia.
-   Garantizar precios futuros o ventas.
-   Obtener datos de todos los mundos en tiempo real.
-   Publicar una API pública o servicio multiusuario.
-   Usar datos de terceros como si fueran capturas propias verificadas.

### 2.3 Límites de cumplimiento

El Collector es una herramienta de captura y análisis. El usuario debe
navegar manualmente el cliente y decidir cuándo capturar. El modo
asistido puede detectar cambios visuales en la región seleccionada y
sugerir/tomar capturas, pero no debe emitir entradas al juego ni
manipular el cliente.

Antes de distribuir o automatizar cualquier comportamiento nuevo,
revisar las reglas vigentes de CipSoft. No implementar funciones que
jueguen por el usuario.

------------------------------------------------------------------------

## 3. Arquitectura

### 3.1 Arquitectura lógica

``` text
┌─────────────────────────────────────────────────────┐
│                  PySide6 Desktop UI                 │
│ Dashboard | Collector | OCR Review | Explorer       │
│ History | TC Market | Transfers | Cart Builder      │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│                  Application Layer                  │
│ Use cases | DTOs | validation | orchestration       │
└───────────────┬──────────────────────┬──────────────┘
                │                      │
┌───────────────▼─────────────┐ ┌──────▼───────────────┐
│       Domain Services       │ │   Collector Pipeline │
│ pricing | arbitrage         │ │ MSS/manual import    │
│ liquidity | transfer rules  │ │ OpenCV | Tesseract   │
│ cart optimization           │ │ parser | review      │
└───────────────┬─────────────┘ └──────┬───────────────┘
                │                      │
                └──────────┬───────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│             Infrastructure / Repositories           │
│ SQLAlchemy | SQLite | file storage | TibiaData      │
└─────────────────────────────────────────────────────┘
```

### 3.2 Stack

  Capa               Tecnología
  ------------------ ----------------------------------------------------
  Lenguaje           Python 3.12+
  UI                 PySide6
  Capturas           MSS
  Imágenes           OpenCV, Pillow
  OCR                Tesseract OCR
  Persistencia       SQLite
  ORM/migraciones    SQLAlchemy 2 + Alembic
  Validación         Pydantic
  Cálculo            Decimal, NumPy; Pandas solo para análisis tabular
  Gráficas           PyQtGraph o Qt Charts; elegir una durante el spike
  Catálogo público   TibiaData API, solo metadatos compatibles
  Pruebas            pytest, pytest-qt
  Calidad            Ruff, mypy
  Empaquetado        PyInstaller
  Instalador         Inno Setup (opcional)

No introducir FastAPI, Supabase, Docker, Redis, Celery ni Vercel en el
MVP. Si más adelante se requiere sincronización remota, definir un
adaptador de repositorio/API sin acoplar el dominio a SQLite.

### 3.3 Capas y dependencias

-   `domain`: entidades, value objects, reglas económicas puras. No
    importa PySide6, SQLAlchemy ni OpenCV.
-   `application`: casos de uso, comandos, consultas y DTOs.
-   `infrastructure`: SQLite, filesystem, OCR, captura, clientes HTTP.
-   `presentation`: ventanas, widgets, modelos Qt y navegación.
-   `bootstrap`: configuración, composición de dependencias y arranque.

Las dependencias apuntan hacia el dominio. Evitar lógica económica
dentro de widgets o consultas SQL.

------------------------------------------------------------------------

## 4. Estructura del repositorio

``` text
tibia-arbitrage/
├── CODEX.md
├── README.md
├── pyproject.toml
├── requirements.lock
├── .gitignore
├── src/
│   └── tibia_arbitrage/
│       ├── main.py
│       ├── bootstrap.py
│       ├── config/
│       │   ├── settings.py
│       │   └── paths.py
│       ├── domain/
│       │   ├── entities/
│       │   ├── value_objects/
│       │   ├── enums.py
│       │   ├── pricing/
│       │   ├── arbitrage/
│       │   ├── liquidity/
│       │   ├── transfers/
│       │   └── cart/
│       ├── application/
│       │   ├── dto/
│       │   ├── commands/
│       │   ├── queries/
│       │   └── services/
│       ├── infrastructure/
│       │   ├── database/
│       │   │   ├── models/
│       │   │   ├── repositories/
│       │   │   └── migrations/
│       │   ├── capture/
│       │   ├── image_processing/
│       │   ├── ocr/
│       │   ├── importers/
│       │   ├── external/
│       │   └── storage/
│       ├── presentation/
│       │   ├── windows/
│       │   ├── widgets/
│       │   ├── dialogs/
│       │   ├── viewmodels/
│       │   └── resources/
│       └── reporting/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── ui/
│   ├── fixtures/
│   │   ├── screenshots/
│   │   └── expected_ocr/
│   └── economic_scenarios/
├── data/
│   └── .gitkeep
├── scripts/
│   ├── dev.ps1
│   ├── test.ps1
│   └── build.ps1
└── docs/
    ├── ARCHITECTURE.md
    ├── DATABASE.md
    ├── OCR_CALIBRATION.md
    ├── ECONOMIC_MODEL.md
    ├── TRANSFER_RULES.md
    └── RELEASE.md
```

### 4.1 Datos locales

Usar directorios de usuario de Windows mediante `QStandardPaths` o
`platformdirs`; nunca guardar datos persistentes junto al ejecutable.

``` text
%LOCALAPPDATA%/TibiaArbitrage/
├── tibia_arbitrage.db
├── backups/
├── screenshots/
│   └── YYYY/MM/
├── processed/
├── exports/
├── logs/
└── config/
```

No versionar la base de datos, capturas privadas, logs ni configuración
local.

------------------------------------------------------------------------

## 5. Especificación funcional

### F-001 --- Inicio y configuración

Al iniciar, la aplicación debe: - Crear directorios locales si no
existen. - Verificar integridad y versión de SQLite. - Ejecutar
migraciones pendientes. - Cargar configuración y catálogo local. -
Mostrar advertencias si faltan datos o dependencias OCR. - No bloquear
el hilo principal durante tareas pesadas.

### F-002 --- Captura manual

El usuario puede: - Seleccionar monitor/ventana o región de pantalla. -
Tomar una captura completa o de región. - Importar PNG/JPG/BMP. -
Asociar manualmente mundo, objeto y tipo de pantalla. - Guardar la
captura original sin alterarla. - Previsualizar recortes y resultados.

El sistema no debe hacer clic ni enviar teclas al cliente.

### F-003 --- Captura asistida

El usuario inicia/detiene una sesión. Mientras está activa: - Observar
únicamente la región seleccionada. - Detectar cambios visuales por
diferencia de imagen/perceptual hash. - Aplicar debounce configurable
para evitar capturas repetidas. - Mostrar una notificación/preview antes
de persistir, salvo que el usuario habilite explícitamente guardar
automáticamente las capturas detectadas. - No interactuar con Tibia ni
cambiar pantallas. - Permitir pausar y detener inmediatamente.

### F-004 --- Perfiles de OCR

Un perfil define: - Resolución y escala. - Región de encabezado/mundo. -
Región del nombre del objeto. - Columnas de precio, cantidad y
vencimiento. - Regiones separadas para buy offers y sell offers. -
Preprocesamiento y configuración Tesseract. - Versión y fecha del
perfil.

Los perfiles son editables y exportables. No asumir coordenadas
universales.

### F-005 --- OCR y revisión

Pipeline: 1. Cargar captura. 2. Aplicar perfil. 3. Recortar regiones. 4.
Preprocesar por columna. 5. Ejecutar Tesseract. 6. Parsear tokens y
filas. 7. Validar estructura y rangos. 8. Mostrar resultado editable. 9.
Guardar resultado confirmado.

Cada campo conserva `raw_text`, `normalized_value` y `confidence`. El
usuario puede corregirlo. La corrección manual debe prevalecer sobre el
resultado OCR y quedar auditada.

Umbrales iniciales configurables: - `>= 0.98`: aceptación sugerida. -
`0.90–0.979`: revisión recomendada. - `< 0.90`: revisión obligatoria.

No interpretar estos umbrales como precisión garantizada. Medir
precisión exacta por campo con un dataset de capturas reales.

### F-006 --- Snapshots de Market

Un snapshot representa lo visible en un instante para un
mundo/objeto/pantalla. Es inmutable después de confirmarse; las
correcciones se registran como revisiones/auditoría, no sobrescribiendo
silenciosamente la evidencia.

Guardar: - Mundo y objeto. - Fecha/hora local y UTC. - Tipo de oferta. -
Filas observadas. - Captura original y recortes. - Perfil OCR y versión
del parser. - Confianza. - Fuente: manual, assisted o import. - Estado
de revisión.

### F-007 --- Detección de eventos

Comparar snapshots consecutivos del mismo mundo/objeto/tipo: - Oferta
vista por primera vez. - Precio modificado. - Cantidad reducida. -
Oferta ausente. - Oferta posiblemente expirada. - Posible ejecución
parcial/total.

La identidad de una oferta es probabilística. No existe garantía de que
precio+cantidad identifique una oferta única. Una desaparición no
demuestra venta. Usar estados `observed`, `possibly_filled`,
`possibly_removed`, `expired_unknown`; nunca `sold_confirmed` sin
evidencia independiente.

### F-008 --- Histórico y estadísticas

Calcular por mundo/objeto/ventana: - Mejor precio sell observado. -
Mejor precio buy observado. - Mediana y percentiles. - Media ponderada
por cantidad, claramente etiquetada. - Rango intercuartílico. -
Volatilidad. - Número de snapshots. - Número de observaciones. - Volumen
inferido con metodología y confianza. - Antigüedad del último dato.

No presentar "volumen vendido" si solo se dispone de desapariciones
inferidas. Etiquetar como volumen potencial/inferido.

### F-009 --- Tibia Coins

Registrar por mundo: - Buy offers de TC. - Sell offers de TC. - Precio
unitario. - Cantidad. - Fecha de observación. - Tipo/condición de TC, si
la pantalla y reglas permiten identificarlo. - Fuente y confianza.

No asumir que todas las TC, saldos o monedas tienen la misma
elegibilidad para transferencias o pagos. La calculadora debe permitir
configurar el método real de financiación y mostrar advertencias cuando
la elegibilidad no esté confirmada.

### F-010 --- Catálogo de mundos

Mantener todos los mundos conocidos, incluso sin datos de Market.
Campos: nombre, región, tipo PvP, estado, protección BattlEye inicial si
se conoce, bloqueos de transferencia, fecha de sincronización y fuente.

TibiaData puede utilizarse como fuente comunitaria para metadatos
disponibles, con caché y tolerancia a fallos. No es fuente de ofertas
del Market. El usuario debe poder editar y corregir metadatos.

### F-011 --- Reglas de transferencia

Mantener reglas dirigidas `origen → destino` con: - permitido / no
permitido / desconocido. - motivo. - fuente oficial. - fecha de
consulta. - vigencia. - notas.

No deducir compatibilidad solamente por región. Considerar al menos
restricciones de PvP, BattlEye, mundos bloqueados y reglas de
transferencias previas. Requisitos personales del personaje se
introducen manualmente en un perfil y se validan como checklist.

Si el estado de una regla es `unknown` o está vencido, la ruta se marca
como `unverified`, no como ejecutable.

### F-012 --- Motor Instant

Para cada objeto y ruta: - Consumir las ofertas sell del origen por
precio ascendente para estimar costo de compra. - Consumir las ofertas
buy del destino por precio descendente para estimar ingreso inmediato. -
Respetar cantidades visibles por nivel de precio. - Calcular el
resultado marginal por unidad y total. - Descontar costos y tarifas
aplicables. - Indicar qué parte de la cantidad no tiene contraparte de
compra. - Mostrar precios y timestamps de las observaciones utilizadas.

No asumir que la mejor oferta cubre toda la cantidad solicitada.

### F-013 --- Motor Historical

Estimar una salida futura usando datos del destino: - Escenario
pesimista: percentil 25. - Escenario base: mediana. - Escenario
optimista: percentil 75.

Mostrar por separado: - Precio objetivo. - Comisión estimada de
publicación. - Ingreso neto. - Días de observación disponibles. -
Cantidad de snapshots. - Liquidez estimada. - Riesgo de no venta. -
Antigüedad de datos.

La estimación no es una predicción garantizada. Si la muestra es
insuficiente, bloquear el escenario o marcarlo como experimental.

### F-014 --- Motor Hybrid

Combinar Instant y Historical sin ocultar sus resultados individuales.
El ranking puede favorecer una estrategia, pero siempre debe mostrar: -
Ganancia inmediata. - Ganancia histórica esperada. - Diferencia de
riesgo. - Capital inmovilizado. - Tiempo estimado. - Calidad de datos.

### F-015 --- Costos de Market

Las tarifas deben estar en una tabla de configuración versionada, no
hardcodeadas. A fecha de esta especificación, la página oficial del
manual informa comisión de 2.5%, mínimo 20 GP, máximo 2,500,000 GP y
ofertas con duración de 30 días. La configuración debe permitir
actualizar estos valores con fuente y fecha.

Aplicar la tarifa únicamente a la acción que realmente la genera
(publicar una oferta); no descontarla indiscriminadamente al reaccionar
a una oferta existente. Modelar por separado compra inmediata, venta
inmediata, publicación buy y publicación sell según las reglas
verificadas.

### F-016 --- Conversión GP/TC

No existe una tasa única universal. Calcular escenarios con cotizaciones
observadas: - Precio de compra de TC. - Precio de venta de TC. -
Spread. - Cantidad disponible. - Mundo. - Timestamp.

La conversión debe usar el lado correcto del mercado según si el usuario
compra o vende TC. Mostrar resultado en GP y TC sin mezclar monedas.

### F-017 --- Simulador de transferencia

Perfil local editable: - Personaje/nivel/vocación (opcionales para
identificación). - Mundo actual. - Última transferencia. - Estado de
skull. - Guild leadership. - Casa. - Ofertas abiertas relevantes. - Tipo
de transferencia. - TC disponibles y elegibles.

La aplicación no consulta ni modifica el personaje. El usuario confirma
los datos. El simulador presenta checklist de requisitos y bloquea el
estado "ejecutable" cuando hay incompatibilidades o información
desconocida.

Los precios de transferencia deben configurarse con fuente y fecha de
verificación; no asumir tarifas históricas como actuales.

### F-018 --- Restricciones de inventario

El usuario introduce: - Capacidad disponible. - Slots disponibles. -
Backpacks/espacios estimados. - Cantidad máxima por stack cuando
aplique.

Peso y stack size del catálogo son datos que requieren fuente. Si no
están confirmados, la optimización debe marcar la capacidad como
aproximada o no aplicable. No asumir que todos los objetos comerciables
son transferibles.

### F-019 --- Cart Builder

Entradas: - Mundo origen/destino. - Presupuesto GP. - TC elegibles
disponibles. - Costo de transferencia. - Capacidad/slots. -
Estrategia. - ROI mínimo. - Riesgo máximo. - Cantidad máxima por objeto.

Salida: - Carrito sugerido. - Cantidad por objeto. - Costo de compra. -
Ingreso estimado. - Comisiones. - Transferencia. - Ganancia neta. -
ROI. - Capacidad estimada. - Riesgos y datos faltantes.

Primera versión: heurística greedy documentada. Fase posterior:
OR-Tools/optimización entera. El algoritmo debe permitir comparar varios
carritos y no afirmar optimalidad si usa heurística.

### F-020 --- Alertas locales

Reglas: - ROI sobre umbral. - Objeto bajo precio. - Spread GP/TC. -
Datos vencidos. - Nueva oportunidad. - Ruta que deja de ser válida.

Notificaciones Windows opcionales. No ejecutar acciones en el juego.

### F-021 --- Exportación y respaldo

-   Exportar CSV/JSON.
-   Exportar reporte de simulación.
-   Backup SQLite consistente.
-   Restaurar backup con confirmación.
-   Incluir versión de esquema.
-   No borrar evidencia original al limpiar datos derivados.

------------------------------------------------------------------------

## 6. Modelo de datos SQLite

Usar SQLite con `foreign_keys=ON`, WAL y transacciones. Guardar GP y
cantidades como enteros de 64 bits. Usar `Decimal` en cálculos
monetarios; no usar `float` para dinero.

### 6.1 Tablas principales

#### `worlds`

-   `id` INTEGER PK
-   `name` TEXT UNIQUE NOT NULL
-   `region` TEXT
-   `pvp_type` TEXT
-   `battlEye_initial` INTEGER NULL
-   `is_online` INTEGER
-   `is_transfer_blocked` INTEGER
-   `metadata_json` TEXT
-   `source` TEXT
-   `verified_at` TEXT
-   `updated_at` TEXT

#### `items`

-   `id` INTEGER PK
-   `external_item_id` INTEGER NULL
-   `name` TEXT NOT NULL
-   `normalized_name` TEXT UNIQUE NOT NULL
-   `category` TEXT
-   `image_path` TEXT NULL
-   `weight_oz` REAL NULL
-   `stack_size` INTEGER NULL
-   `is_market_tradeable` INTEGER NULL
-   `transfer_status` TEXT DEFAULT 'unknown'
-   `metadata_json` TEXT
-   `verified_at` TEXT

#### `collector_profiles`

-   `id` INTEGER PK
-   `name` TEXT
-   `screen_width` INTEGER
-   `screen_height` INTEGER
-   `scale_factor` REAL
-   `regions_json` TEXT
-   `preprocessing_json` TEXT
-   `tesseract_language` TEXT
-   `created_at` TEXT
-   `updated_at` TEXT

#### `capture_sessions`

-   `id` TEXT UUID PK
-   `source_mode` TEXT CHECK manual/assisted/import
-   `world_id` INTEGER FK
-   `item_id` INTEGER FK NULL
-   `profile_id` INTEGER FK NULL
-   `started_at` TEXT
-   `ended_at` TEXT NULL
-   `notes` TEXT

#### `screenshots`

-   `id` TEXT UUID PK
-   `session_id` TEXT FK
-   `original_path` TEXT NOT NULL
-   `captured_at_utc` TEXT
-   `captured_at_local` TEXT
-   `sha256` TEXT UNIQUE
-   `width` INTEGER
-   `height` INTEGER
-   `processing_status` TEXT
-   `created_at` TEXT

#### `market_scans`

-   `id` TEXT UUID PK
-   `screenshot_id` TEXT FK
-   `world_id` INTEGER FK
-   `item_id` INTEGER FK
-   `scan_type` TEXT CHECK buy/sell/tc_buy/tc_sell/combined
-   `parser_version` TEXT
-   `ocr_version` TEXT
-   `confidence` REAL
-   `review_status` TEXT CHECK pending/accepted/rejected
-   `created_at` TEXT

#### `market_offers`

-   `id` INTEGER PK
-   `scan_id` TEXT FK
-   `offer_type` TEXT CHECK buy/sell
-   `unit_price_gp` INTEGER NOT NULL
-   `amount` INTEGER NOT NULL
-   `expiration_text` TEXT NULL
-   `expiration_at_utc` TEXT NULL
-   `raw_price_text` TEXT
-   `raw_amount_text` TEXT
-   `price_confidence` REAL
-   `amount_confidence` REAL
-   `row_index` INTEGER
-   `created_at` TEXT

#### `ocr_field_reviews`

-   `id` INTEGER PK
-   `scan_id` TEXT FK
-   `offer_id` INTEGER FK NULL
-   `field_name` TEXT
-   `raw_value` TEXT
-   `corrected_value` TEXT
-   `reviewed_at` TEXT

#### `market_events`

-   `id` INTEGER PK
-   `world_id` INTEGER FK
-   `item_id` INTEGER FK
-   `event_type` TEXT
-   `offer_type` TEXT
-   `price_gp` INTEGER NULL
-   `quantity` INTEGER NULL
-   `confidence` REAL
-   `evidence_json` TEXT
-   `detected_at_utc` TEXT

#### `tc_rates`

-   `id` INTEGER PK
-   `world_id` INTEGER FK
-   `captured_at_utc` TEXT
-   `buy_price_gp` INTEGER NULL
-   `buy_amount` INTEGER NULL
-   `sell_price_gp` INTEGER NULL
-   `sell_amount` INTEGER NULL
-   `scan_id` TEXT FK NULL
-   `confidence` REAL

#### `transfer_rules`

-   `id` INTEGER PK
-   `origin_world_id` INTEGER FK
-   `destination_world_id` INTEGER FK
-   `status` TEXT CHECK allowed/blocked/unknown
-   `reason` TEXT
-   `source_url` TEXT
-   `verified_at` TEXT
-   `valid_until` TEXT NULL
-   `notes` TEXT
-   UNIQUE(origin_world_id, destination_world_id, verified_at)

#### `economic_rule_versions`

-   `id` INTEGER PK
-   `rule_key` TEXT
-   `value_json` TEXT
-   `source_url` TEXT
-   `effective_from` TEXT
-   `verified_at` TEXT
-   `notes` TEXT

#### `arbitrage_runs`

-   `id` TEXT UUID PK
-   `origin_world_id` INTEGER FK
-   `destination_world_id` INTEGER FK
-   `strategy` TEXT
-   `parameters_json` TEXT
-   `started_at` TEXT
-   `completed_at` TEXT
-   `status` TEXT

#### `arbitrage_opportunities`

-   `id` INTEGER PK
-   `run_id` TEXT FK
-   `item_id` INTEGER FK
-   `strategy` TEXT
-   `quantity` INTEGER
-   `buy_cost_gp` INTEGER
-   `gross_revenue_gp` INTEGER
-   `market_fees_gp` INTEGER
-   `transfer_cost_gp` INTEGER
-   `other_costs_gp` INTEGER
-   `net_profit_gp` INTEGER
-   `roi_percent` REAL
-   `liquidity_score` REAL
-   `confidence_score` REAL
-   `warnings_json` TEXT
-   `evidence_json` TEXT

#### `transfer_profiles`

-   `id` INTEGER PK
-   `name` TEXT
-   `current_world_id` INTEGER FK
-   `last_transfer_at` TEXT NULL
-   `has_skull_restriction` INTEGER
-   `is_guild_leader` INTEGER
-   `owns_house` INTEGER
-   `has_relevant_open_offers` INTEGER
-   `transfer_type` TEXT
-   `available_eligible_tc` INTEGER
-   `updated_at` TEXT

#### `saved_carts`

-   `id` TEXT UUID PK
-   `name` TEXT
-   `run_id` TEXT FK
-   `constraints_json` TEXT
-   `summary_json` TEXT
-   `created_at` TEXT

#### `saved_cart_items`

-   `id` INTEGER PK
-   `cart_id` TEXT FK
-   `item_id` INTEGER FK
-   `quantity` INTEGER
-   `buy_cost_gp` INTEGER
-   `expected_revenue_gp` INTEGER
-   `estimated_weight` REAL NULL
-   `estimated_slots` INTEGER NULL

#### `app_settings`

-   `key` TEXT PK
-   `value_json` TEXT
-   `updated_at` TEXT

### 6.2 Índices

Crear índices para: - `market_scans(world_id, item_id, created_at)` -
`market_offers(scan_id, offer_type, unit_price_gp)` -
`market_events(world_id, item_id, detected_at_utc)` -
`tc_rates(world_id, captured_at_utc)` -
`arbitrage_opportunities(run_id, net_profit_gp)` -
`transfer_rules(origin_world_id, destination_world_id, verified_at)`

### 6.3 Retención

No borrar snapshots originales automáticamente. Permitir limpieza de
derivados/cachés, pero preservar capturas y datos confirmados.
Configurar backup automático y límite de almacenamiento visible al
usuario.

------------------------------------------------------------------------

## 7. Modelo económico

### 7.1 Compra escalonada

Para comprar cantidad `Q` en origen, consumir niveles de sell offers
ordenados por precio ascendente. El costo es la suma de
`precio × unidades` de cada nivel hasta completar Q. Si no hay cantidad
suficiente, devolver `unfilled_quantity`.

### 7.2 Liquidación inmediata

En destino, consumir buy offers por precio descendente. El ingreso es la
suma de `precio × unidades` realmente absorbidas. No extrapolar el mejor
precio al resto de unidades.

### 7.3 Venta histórica

Para cada objeto/destino: - Construir distribución de precios
observados. - Calcular P25, P50 y P75. - Exigir muestra mínima
configurable. - Calcular comisiones según regla vigente. - Estimar
tiempo de salida únicamente si existe suficiente serie temporal. -
Mostrar intervalo y confianza; nunca una probabilidad falsa con
precisión excesiva.

### 7.4 Market fee

Regla inicial verificada en el manual oficial consultado el
31-10-2026: - 2.5% del precio de la oferta. - Mínimo 20 GP. - Máximo
2,500,000 GP. - Duración de oferta: 30 días.

Fórmula para una oferta publicada:
`fee = min(2_500_000, max(20, ceil(price * 0.025)))`

Confirmar redondeo exacto en pruebas con el cliente/manual vigente.
Aplicar comisión solo cuando la acción la genera. La aceptación de una
oferta existente no debe recibir una comisión de publicación ficticia.

### 7.5 Transferencia

El costo de transferencia es configurable y versionado. No hardcodear
precios de transferencia ni asumir que son constantes. Para convertir TC
a GP, usar el lado correcto de la cotización observada y el tipo de TC
elegible.

### 7.6 Ganancia

`net_profit_gp = destination_revenue_gp - origin_purchase_cost_gp - applicable_market_fees_gp - transfer_cost_gp - other_costs_gp`

`ROI = net_profit_gp / total_capital_committed_gp * 100`

El denominador debe documentarse: capital de compra más costos pagados.
Mostrar también retorno sobre capital de compra para evitar confusiones.

### 7.7 Puntuación

Calcular componentes 0--100: - ROI normalizado. - Liquidez. - Confianza
de datos. - Estabilidad histórica.

Pesos iniciales configurables: ROI 35%, liquidez 30%, confianza 20%,
estabilidad 15%. No usar el score para ocultar las métricas originales.

### 7.8 Liquidez

No llamar "ventas por semana" a desapariciones de ofertas. Usar
nombres: - `observed_offer_turnover` - `estimated_possible_fills` -
`inferred_volume` - `liquidity_confidence`

Documentar supuestos y evitar contar dos veces una oferta que reaparece.

------------------------------------------------------------------------

## 8. Reglas de transferencia y catálogo

Las reglas de transferencia son dirigidas y versionadas. Requisitos
conocidos que deben representarse: - El destino debe permitir
transferencia. - El destino debe tener reglas PvP iguales o más
estrictas según las reglas oficiales. - Restricciones de BattlEye y
mundos bloqueados. - Restricciones de skull. - El personaje no debe ser
líder de guild ni propietario de casa, según los requisitos
aplicables. - No debe tener ofertas abiertas de Market que incluyan
Tibia Coins. - La transferencia regular y Express tienen condiciones
distintas; la regular tiene una limitación temporal de transferencias
previas.

La matriz completa puede depender del historial del personaje, no solo
de atributos estáticos del mundo. Por ello: - `world_route_status`
responde compatibilidad general conocida. - `character_checklist_status`
responde requisitos personales. - `final_status` solo puede ser
`eligible` si ambos son válidos y verificados. - Cualquier dato
desconocido produce `unverified`.

No implementar un "sí" automático para todas las rutas de la misma
región.

------------------------------------------------------------------------

## 9. Interfaz de usuario

Ventana principal con navegación lateral:

1.  **Overview:** estado de base de datos, mundos con datos, capturas
    recientes y oportunidades.
2.  **Collector:** captura manual, sesión asistida, importación de
    imágenes y estado de OCR.
3.  **OCR Review:** tabla editable con imagen original y recortes.
4.  **Market Explorer:** mundo, objeto, buy/sell, snapshots y ofertas.
5.  **Price History:** gráficos y estadísticas.
6.  **TC Market:** cotizaciones y spread de TC.
7.  **Arbitrage Explorer:** matriz de rutas y ranking de oportunidades.
8.  **Transfer Simulator:** checklist y costos.
9.  **Cart Builder:** presupuesto, capacidad y selección.
10. **Settings:** perfiles OCR, reglas, catálogo, backups y logs.

### Requisitos de UX

-   Tema oscuro por defecto y tema claro opcional.
-   Tablas ordenables y filtrables.
-   Mostrar siempre hora de captura y antigüedad.
-   Colores no deben ser el único indicador de estado.
-   Diferenciar `observed`, `inferred`, `estimated` y `unknown`.
-   No mostrar cifras de ejemplo como datos reales.
-   Botones de captura y sincronización deben reflejar estados reales.
-   Tareas OCR/análisis en workers Qt, nunca en el hilo UI.
-   Confirmar antes de eliminar datos o restaurar backup.

------------------------------------------------------------------------

## 10. Integración TibiaData

Usar TibiaData únicamente para metadatos públicos que sus endpoints
soporten (por ejemplo, catálogo de mundos y otros datos publicados). No
asumir que proporciona ofertas o históricos del Market.

Requisitos: - Cliente HTTP desacoplado. - Timeout y reintentos
limitados. - Cache local. - `User-Agent` identificable. - Respetar rate
limits y políticas del servicio. - Guardar `source`, `fetched_at` y
versión de esquema. - La aplicación debe funcionar si TibiaData no está
disponible. - Importación y edición manual como fallback.

------------------------------------------------------------------------

## 11. Calidad, seguridad y rendimiento

### Seguridad local

-   No almacenar credenciales del juego.
-   No exponer un servidor local innecesario.
-   Validar rutas de archivos importados.
-   Limitar dimensiones/tamaño de imagen.
-   Evitar deserializar pickle o formatos ejecutables.
-   Logs sin datos sensibles.
-   Firmar/publicar hashes del instalador cuando sea posible.

### Rendimiento

-   OCR fuera del hilo principal.
-   Procesamiento por lotes con progreso y cancelación.
-   Índices SQL para consultas de históricos.
-   Paginación en tablas.
-   Cache de estadísticas derivadas.
-   No recalcular todas las rutas al abrir la aplicación.
-   Ejecutar análisis bajo demanda o con botón "Actualizar análisis".

### Calidad

-   Ruff format/check.
-   mypy.
-   pytest.
-   pytest-qt.
-   Cobertura de pruebas económicas.
-   Fixtures OCR anonimizadas o de uso permitido.
-   Pruebas de migraciones desde una base anterior.
-   Pruebas de backup/restore.

------------------------------------------------------------------------

## 12. Criterios de aceptación del MVP

1.  La aplicación inicia en Windows sin requerir Python instalado cuando
    se usa el build empaquetado.
2.  Puede capturar manualmente una región o importar una imagen.
3.  Un perfil OCR configurable extrae filas de buy/sell offers.
4.  El usuario puede corregir precio y cantidad.
5.  Cada scan conserva imagen, texto y valores confirmados.
6.  Los snapshots se consultan por mundo y objeto.
7.  El comparador consume ofertas escalonadas correctamente.
8.  El cálculo de comisión usa una regla versionada.
9.  Los resultados muestran timestamps y antigüedad.
10. La desaparición de oferta no se registra como venta confirmada.
11. La ruta de transferencia desconocida no se muestra como ejecutable.
12. La base puede respaldarse y restaurarse.
13. El sistema exporta análisis a CSV/JSON.
14. El frontend sigue respondiendo durante OCR y análisis.
15. Las pruebas cubren escenarios de beneficio, pérdida, datos
    incompletos y cantidades parciales.

### Dataset de validación OCR

Antes de afirmar una precisión del 98%, construir un dataset de al menos
200 filas reales anotadas manualmente, incluyendo: - Diferentes
resoluciones y escalas. - Números con separadores. - Cantidades de 1 a
varios dígitos. - Filas parcialmente visibles. - Capturas con UI
superpuesta. - Distintos perfiles de color/contraste.

Medir precisión exacta de precio y cantidad por separado. El umbral de
aceptación del MVP se fija después del spike; no falsear métricas.

------------------------------------------------------------------------

## 13. Plan de implementación

### Fase 0 --- Reconocimiento y spike OCR

-   Crear repo y entorno.
-   Obtener capturas reales representativas.
-   Probar Tesseract y OpenCV.
-   Medir reconocimiento de precio/cantidad.
-   Definir perfil de captura.
-   Entregable: prototipo CLI que procesa una imagen y exporta JSON.

### Fase 1 --- Esqueleto desktop y SQLite

-   PySide6 y navegación base.
-   Configuración de rutas.
-   SQLAlchemy y Alembic.
-   Migración inicial.
-   Logging y manejo de errores.
-   Entregable: app local con DB y navegación.

### Fase 2 --- Captura e importación

-   MSS para captura manual.
-   Importador de imágenes.
-   Perfiles y regiones OCR.
-   Persistencia de screenshots.
-   Entregable: capturar/importar y visualizar evidencia.

### Fase 3 --- OCR Review

-   Pipeline por columnas.
-   Parser de filas.
-   Validaciones.
-   Tabla editable.
-   Correcciones auditadas.
-   Entregable: snapshot confirmado.

### Fase 4 --- Market History

-   Consulta de snapshots.
-   Comparación entre capturas.
-   Eventos inferidos.
-   Estadísticas y gráficos.
-   Entregable: histórico por objeto/mundo.

### Fase 5 --- Catálogos y TC

-   Sincronización TibiaData de metadatos.
-   Catálogo manual de objetos.
-   Capturas de TC.
-   Cotizaciones por mundo.
-   Entregable: cobertura y TC.

### Fase 6 --- Motor económico

-   Compra escalonada.
-   Liquidación inmediata.
-   Historical P25/P50/P75.
-   Comisiones versionadas.
-   GP/TC.
-   Entregable: escenarios reproducibles con pruebas.

### Fase 7 --- Transferencias y rutas

-   Catálogo de reglas dirigidas.
-   Checklist de personaje.
-   Costos configurables.
-   Matriz all-world.
-   Entregable: rutas permitidas/bloqueadas/no verificadas.

### Fase 8 --- Arbitrage Explorer y alertas

-   Ranking ROI/liquidez/confianza.
-   Filtros.
-   Alertas locales.
-   Exportaciones.
-   Entregable: herramienta diaria de análisis.

### Fase 9 --- Cart Builder

-   Presupuesto.
-   Capacidad y slots.
-   Heurística greedy.
-   Comparación de carritos.
-   Entregable: simulación de inventario.

### Fase 10 --- Empaquetado

-   PyInstaller.
-   Tesseract y traineddata.
-   Configuración de paths en modo frozen.
-   Inno Setup opcional.
-   Prueba en Windows limpio.
-   Backup/restore.
-   Entregable: instalador reproducible.

------------------------------------------------------------------------

## 14. Prompts secuenciales para Codex

**Regla general:** ejecutar un prompt por vez. Codex debe inspeccionar
el repo, implementar solo el alcance solicitado, correr pruebas y
reportar archivos modificados, comandos ejecutados, resultados y
pendientes. No avanzar si hay errores de pruebas.

### Prompt 0 --- Auditoría y plan

``` text
Lee CODEX.md completo. Inspecciona el repositorio y el entorno. No implementes todavía.
Entrega un plan de trabajo por fases, identifica riesgos técnicos del OCR en capturas reales,
propón una prueba de concepto mínima y enumera decisiones que requieren evidencia.
No inventes datos del Market ni afirmes que TibiaData ofrece precios del Market.
Confirma que la herramienta no automatizará acciones del cliente de Tibia.
```

### Prompt 1 --- OCR Proof of Concept

``` text
Implementa únicamente un prototipo CLI de OCR según CODEX.md.
Debe aceptar una imagen local, aplicar preprocesamiento OpenCV configurable,
recibir regiones desde JSON, ejecutar Tesseract y exportar JSON con texto raw,
confianza y valores parseados. No crees aún la UI desktop ni la base de datos.
Incluye fixtures, pruebas unitarias y un README de calibración.
No hardcodees coordenadas universales; documenta cómo calibrarlas.
No declares precisión sin dataset anotado.
```

### Prompt 2 --- Estructura y arquitectura

``` text
Implementa la estructura del proyecto definida en CODEX.md usando Python 3.12+,
PySide6, SQLAlchemy 2, Alembic, Pydantic y pytest.
Separa domain, application, infrastructure y presentation.
Configura Ruff, mypy y pytest. Crea bootstrap y una ventana vacía funcional.
No implementes todavía el motor económico.
```

### Prompt 3 --- SQLite y migraciones

``` text
Implementa el esquema SQLite descrito en CODEX.md mediante SQLAlchemy y Alembic.
Activa foreign_keys y WAL. Usa enteros para GP/cantidades y Decimal en cálculos.
Crea repositorios y pruebas de integridad, índices, migración y backup/restore.
No agregues campos no documentados sin explicar la necesidad.
```

### Prompt 4 --- Captura e importación

``` text
Implementa captura manual de pantalla/región usando MSS e importación PNG/JPG/BMP.
El usuario debe seleccionar región y confirmar la captura. Guarda original inalterado,
hash SHA-256, dimensiones, timestamps y metadatos en SQLite/filesystem.
No envíes clics ni teclas al cliente de Tibia, no automatices navegación.
Incluye pruebas y manejo de errores de permisos/monitores.
```

### Prompt 5 --- Perfiles OCR y calibración

``` text
Implementa perfiles OCR configurables por resolución y regiones.
Incluye editor visual de regiones sobre una imagen de ejemplo, preprocesamiento por columna
y guardado/versionado del perfil. No asumas una resolución fija.
Añade documentación de calibración y pruebas de transformación de coordenadas.
```

### Prompt 6 --- Parser y revisión manual

``` text
Implementa parser de filas buy/sell y pantalla OCR Review.
Cada campo debe mostrar raw_text, valor normalizado y confianza.
El usuario puede editar precio/cantidad antes de confirmar el scan.
Guarda correcciones en ocr_field_reviews y conserva la evidencia original.
Rechaza filas inválidas y muestra errores comprensibles.
```

### Prompt 7 --- Collector asistido

``` text
Implementa modo de captura asistida limitado a observar una región de pantalla,
detectar cambios visuales, aplicar debounce y sugerir/guardar capturas según preferencia.
El usuario inicia y detiene la sesión. No interactúes con el cliente, no simules entradas,
no cambies ventanas ni navegues el Market. Incluye pausa, cancelación y pruebas.
```

### Prompt 8 --- Snapshots e histórico

``` text
Implementa persistencia inmutable de snapshots, consulta por mundo/objeto,
comparación entre snapshots y eventos inferidos. Distingue offer_disappeared,
possibly_filled, possibly_removed y expired_unknown. Nunca afirmes venta confirmada
por desaparición. Agrega estadísticas con metodología y pruebas.
```

### Prompt 9 --- Catálogo de mundos y objetos

``` text
Implementa catálogo local de mundos y objetos. Agrega un adaptador opcional TibiaData
para metadatos que la API documente. Usa timeout, caché, User-Agent, manejo de rate limits
y fallback manual. No consultes ni inventes datos de Market. Muestra fuente y fecha de sync.
```

### Prompt 10 --- Tibia Coin Market

``` text
Implementa captura y almacenamiento de cotizaciones TC por mundo, diferenciando buy/sell,
precio, cantidad, fecha y confianza. Construye pantalla TC Market con spread e histórico.
No asumas equivalencia o transferibilidad de todos los saldos/tipos de TC.
```

### Prompt 11 --- Modelo económico

``` text
Implementa funciones puras y testeadas para compra escalonada en origen y liquidación
contra buy offers del destino. Implementa Market fee versionada y configurable.
Usa Decimal, enteros GP y redondeo explícito. Devuelve cantidad no cubierta, costos,
ingresos y warnings. No incluyas aún predicción histórica.
```

### Prompt 12 --- Estrategias Instant e Historical

``` text
Implementa Instant, Historical y Hybrid según CODEX.md.
Historical usa P25/P50/P75 y exige muestra mínima configurable.
Muestra antigüedad, observaciones, confianza y advertencias. No llames ventas confirmadas
a eventos inferidos ni presentes predicciones como certezas. Crea escenarios económicos.
```

### Prompt 13 --- Transferencias

``` text
Implementa reglas dirigidas origen-destino, fuente, verified_at y vigencia.
Implementa checklist de personaje editable manualmente y costos configurables/versionados.
Los estados deben ser allowed, blocked o unknown. Nunca marques executable si algún requisito
relevante está desconocido o vencido. Incluye pruebas de PvP, BattlEye y mundos bloqueados.
```

### Prompt 14 --- Arbitrage Explorer

``` text
Construye la pantalla Arbitrage Explorer con filtros de mundo origen/destino, estrategia,
ROI, liquidez, confianza y antigüedad. Muestra ofertas y snapshots usados para cada resultado.
Incluye rankings separados Best Profit, Best ROI, Best Liquidity y Risk Adjusted.
No ocultes métricas originales detrás de un score.
```

### Prompt 15 --- Cart Builder

``` text
Implementa Cart Builder con presupuesto GP, TC elegibles, costo de transferencia,
capacidad/slots configurables, estrategia y límites de riesgo.
Empieza con heurística greedy y etiqueta que no garantiza óptimo global.
Respeta cantidades enteras, niveles de oferta y restricciones conocidas.
Incluye comparación de carritos y pruebas de límites.
```

### Prompt 16 --- Alertas, reportes y exportación

``` text
Implementa alertas locales configurables, CSV/JSON y reporte de simulación.
Evita alertas duplicadas y muestra timestamp/frescura de datos.
No ejecutes acciones del juego. Añade pruebas y documentación de exportación.
```

### Prompt 17 --- Empaquetado Windows

``` text
Prepara build Windows x64 con PyInstaller. Incluye Tesseract y traineddata de forma
legal y reproducible, configura paths en modo frozen, icono y versionado.
Crea script PowerShell de build y, opcionalmente, instalador Inno Setup.
Prueba en una instalación limpia de Windows sin Python. Documenta backup y actualización.
```

### Prompt 18 --- Auditoría final

``` text
Realiza auditoría contra CODEX.md. Ejecuta pruebas, Ruff, mypy y build.
Busca lógica económica duplicada, float en dinero, rutas no verificadas presentadas como
válidas, ventas inferidas etiquetadas como confirmadas, bloqueos de UI y automatización
del cliente. Corrige defectos dentro del alcance y entrega matriz de cumplimiento.
No marques como terminado lo que no se haya probado.
```

------------------------------------------------------------------------

## 15. Definition of Done

Una fase se considera terminada únicamente cuando: - El alcance está
implementado. - Las pruebas automatizadas pasan. - No hay errores
críticos de lint/type-check. - La documentación correspondiente está
actualizada. - Los datos dudosos se etiquetan correctamente. - No se
introdujeron automatizaciones del cliente. - Codex informa limitaciones
y evidencia de validación.

El MVP está terminado cuando las fases 0--6 permiten capturar, corregir,
guardar y consultar snapshots de dos mundos, y el motor puede calcular
una oportunidad Instant con escenarios de prueba reproducibles. La
cobertura de todos los mundos es progresiva y depende de datos realmente
capturados.

------------------------------------------------------------------------

## 16. Fuentes y referencias

Consultar y volver a verificar antes de implementar cambios dependientes
de reglas externas:

-   Tibia Market manual:
    https://www.tibia.com/gameguides/?section=controls_trading&subtopic=manual
-   Character World Transfers FAQ:
    https://www.tibia.com/support/?subtopic=gethelp&entryid=55
-   TibiaData API docs: https://docs.tibiadata.com/
-   TibiaData API: https://tibiadata.com/docs/

A fecha de 31-10-2026, el manual oficial consultado informa una tarifa
de Market de 2.5%, mínimo 20 GP y máximo 2,500,000 GP, con ofertas de 30
días. CipSoft anunció la subida efectiva el 06-10-2026. Estos valores
deben permanecer versionados y editables.

Las reglas de transferencia incluyen restricciones de PvP, BattlEye,
mundos bloqueados y requisitos del personaje. La elegibilidad final debe
verificarse con la documentación oficial vigente y con las condiciones
del personaje.

------------------------------------------------------------------------

## 17. Instrucción permanente para Codex

Antes de modificar código: 1. Lee este archivo. 2. Inspecciona la
implementación existente. 3. Identifica qué fase y requisito estás
atendiendo. 4. Propón un plan breve. 5. Implementa solo el alcance
autorizado. 6. Ejecuta pruebas y validaciones. 7. Actualiza
documentación. 8. Resume cambios, comandos, resultados y riesgos.

**No inventar datos. No sobrestimar la precisión del OCR. No confundir
ofertas observadas con ventas. No presentar rutas no verificadas como
transferibles. No automatizar acciones del cliente de Tibia.**
