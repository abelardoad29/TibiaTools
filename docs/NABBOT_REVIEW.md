# NabBot: revisión de funciones

[NabBot](https://github.com/Galarzaa90/NabBot) fue un bot de Discord para Tibia (archivado en 2019). Se revisaron sus comandos (`docs/commands`) y su módulo de seguimiento (`cogs/tracking.py`) el 02-11-2026.

**Cómo detectaba conexiones:** igual que Tibia Tools, leyendo la lista pública de conectados de cada mundo (cada 90 s, `online_scan_interval`). Tibia no ofrece un canal en tiempo real; hoy la lista cambia cada ~1 minuto (medido en Antica: cada lectura separada por 65 s traía una hora nueva y 24–40 entradas/salidas), y TibiaData la guarda en caché 60 s. Por eso un websocket no adelantaría las alertas: el límite es la fuente. Tibia Tools lee cada 60 s y empuja cada cambio al instante a la ventana y a Windows.

| Función de NabBot | Qué hacía | En Tibia Tools |
|---|---|---|
| `watchlist` (personajes y guilds) | Lista de conectados de amigos/enemigos en un canal | **Agregado: Hunted.** Listas con personajes o guilds completas, conectados en vivo, eventos e historial |
| — | (no existía en NabBot) | **Agregado:** aviso de ráfaga (≥ N de una lista conectados en ≤ X s, por defecto 5 en 60 s) |
| Tracking de muertes y niveles | Anunciaba muertes y level ups de personajes registrados | Ya estaba (Herramientas → Personajes, TibiaData cada 5 min). Hunted también registra subidas de nivel de los vigilados cada minuto |
| `share` | Rango de experiencia compartida | Ya estaba (corregido) |
| `imbuement` (TibiaWiki) | Costo con precios y Gold Tokens | Ya estaba; ahora con todas las mezclas de tokens, scroll y costo por hunt |
| `boss` / `events` / `remindme` | Timers de cooldown de bosses y eventos | Propuesto |
| `time` | Hora del servidor y cuenta regresiva al server save | Propuesto (el cálculo de server save ya existe para Rashid) |
| `searchteam` / `searchworld` | Buscar conectados por rango de nivel y vocación en un mundo | Propuesto (la lista de conectados ya se lee para Hunted) |
| `blessings`, `stamina`, `stats`, `magiclevel`, `meleeskill`, `distanceskill` | Calculadoras | Propuesto |
| `loot` | Valor del loot a partir de una captura | Propuesto (se puede reutilizar el OCR y los iconos del catálogo) |
| `deaths`, `levels`, `timeline` | Historial de muertes y niveles | Parcial: eventos de Personajes y de Hunted |
| `guild`, `whois`, `world(s)`, `highscores`, `house`, `news` | Consultas a tibia.com | Parcial (mundos en Catálogo); el resto, propuesto |
| `addchar`, `claim`, `im`, roles, autoroles | Gestión de usuarios de Discord | No aplica (app personal) |
