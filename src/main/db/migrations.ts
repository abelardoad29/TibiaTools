// Migraciones de esquema, en orden. Nunca se edita una migración ya publicada: se agrega otra.
// GP y cantidades son INTEGER (64 bits). Ver docs/DATABASE.md.

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    sql: `
CREATE TABLE worlds (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  region TEXT,
  pvp_type TEXT,
  battleye_protected INTEGER,
  battleye_date TEXT,
  transfer_type TEXT,
  game_world_type TEXT,
  premium_only INTEGER,
  is_online INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  looser_transfer_conditions INTEGER,
  metadata_json TEXT,
  source TEXT,
  verified_at TEXT,
  last_seen_in_tibiadata_at TEXT,
  updated_at TEXT NOT NULL
);

-- normalized_name NO es único: el catálogo tiene ~126 nombres repetidos con distinto id de cliente.
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  tibia_item_id INTEGER UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  wiki_name TEXT,
  category TEXT,
  tier INTEGER,
  image_path TEXT,
  icon_status TEXT NOT NULL DEFAULT 'unknown' CHECK (icon_status IN ('unknown','cached','failed','override')),
  icon_override_url TEXT,
  weight_oz REAL,
  stack_size INTEGER,
  is_market_tradeable INTEGER,
  transfer_status TEXT NOT NULL DEFAULT 'unknown',
  npc_buy_json TEXT,
  npc_sell_json TEXT,
  metadata_json TEXT,
  source TEXT,
  verified_at TEXT
);
CREATE INDEX idx_items_normalized ON items(normalized_name);
CREATE INDEX idx_items_category ON items(category);

CREATE TABLE collector_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  screen_type TEXT NOT NULL CHECK (screen_type IN ('offers','details')),
  screen_width INTEGER NOT NULL,
  screen_height INTEGER NOT NULL,
  scale_factor REAL NOT NULL DEFAULT 1,
  regions_json TEXT NOT NULL,
  preprocessing_json TEXT NOT NULL,
  glyphs_json TEXT NOT NULL,
  tesseract_language TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE capture_sessions (
  id TEXT PRIMARY KEY,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('manual','assisted','import')),
  world_id INTEGER REFERENCES worlds(id),
  item_id INTEGER REFERENCES items(id),
  profile_id INTEGER REFERENCES collector_profiles(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  notes TEXT
);

CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES capture_sessions(id),
  original_path TEXT NOT NULL,
  captured_at_utc TEXT NOT NULL,
  captured_at_local TEXT NOT NULL,
  sha256 TEXT UNIQUE NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  region_json TEXT,
  screen_type TEXT CHECK (screen_type IN ('offers','details')),
  world_id INTEGER REFERENCES worlds(id),
  item_id INTEGER REFERENCES items(id),
  processing_status TEXT NOT NULL DEFAULT 'new' CHECK (processing_status IN ('new','processed','confirmed','rejected')),
  created_at TEXT NOT NULL
);

CREATE TABLE market_scans (
  id TEXT PRIMARY KEY,
  screenshot_id TEXT REFERENCES screenshots(id),
  world_id INTEGER NOT NULL REFERENCES worlds(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  scan_type TEXT NOT NULL CHECK (scan_type IN ('buy','sell','tc_buy','tc_sell','combined','details')),
  source TEXT NOT NULL CHECK (source IN ('own_capture','third_party','manual')),
  source_ref TEXT,
  observed_at_utc TEXT NOT NULL,
  parser_version TEXT,
  ocr_version TEXT,
  profile_id INTEGER REFERENCES collector_profiles(id),
  confidence REAL,
  review_status TEXT NOT NULL CHECK (review_status IN ('pending','accepted','rejected','superseded')),
  supersedes_scan_id TEXT REFERENCES market_scans(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_scans_world_item ON market_scans(world_id, item_id, observed_at_utc);
CREATE INDEX idx_scans_created ON market_scans(world_id, item_id, created_at);
CREATE UNIQUE INDEX idx_scans_source_ref ON market_scans(source, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE market_offers (
  id INTEGER PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES market_scans(id),
  offer_type TEXT NOT NULL CHECK (offer_type IN ('buy','sell')),
  unit_price_gp INTEGER NOT NULL CHECK (unit_price_gp > 0),
  amount INTEGER NOT NULL CHECK (amount > 0),
  total_price_gp INTEGER,
  expiration_text TEXT,
  expiration_at_utc TEXT,
  raw_price_text TEXT,
  raw_amount_text TEXT,
  price_confidence REAL,
  amount_confidence REAL,
  row_index INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_offers_scan ON market_offers(scan_id, offer_type, unit_price_gp);

-- Estadísticas agregadas (vista Details oficial, o terceros), separadas de las ofertas.
CREATE TABLE market_stats (
  id INTEGER PRIMARY KEY,
  scan_id TEXT REFERENCES market_scans(id),
  world_id INTEGER NOT NULL REFERENCES worlds(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  stat_window TEXT NOT NULL CHECK (stat_window IN ('30d','1d')),
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  transactions INTEGER,
  avg_price_gp INTEGER,
  min_price_gp INTEGER,
  max_price_gp INTEGER,
  source TEXT NOT NULL CHECK (source IN ('own_capture','third_party','manual')),
  observed_at_utc TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stats_world_item ON market_stats(world_id, item_id, observed_at_utc);
CREATE UNIQUE INDEX idx_stats_dedupe ON market_stats(world_id, item_id, stat_window, side, source, observed_at_utc);

-- Mejor precio sin profundidad (p. ej. /market_values de terceros). Sirve para filtrar candidatos;
-- el cálculo Instant necesita un order book completo (market_offers).
CREATE TABLE market_quotes (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  best_buy_gp INTEGER,
  best_sell_gp INTEGER,
  buy_offers INTEGER,
  sell_offers INTEGER,
  source TEXT NOT NULL CHECK (source IN ('own_capture','third_party','manual')),
  observed_at_utc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (world_id, item_id, source, observed_at_utc)
);
CREATE INDEX idx_quotes_world_item ON market_quotes(world_id, item_id, observed_at_utc);

CREATE TABLE ocr_field_reviews (
  id INTEGER PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES market_scans(id),
  offer_id INTEGER REFERENCES market_offers(id),
  stats_id INTEGER REFERENCES market_stats(id),
  field_name TEXT NOT NULL,
  raw_value TEXT,
  ocr_value TEXT,
  corrected_value TEXT,
  reviewed_at TEXT NOT NULL
);

CREATE TABLE market_events (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('first_seen','amount_reduced','amount_increased','price_changed','possibly_filled','possibly_removed','expired_unknown')),
  offer_type TEXT NOT NULL CHECK (offer_type IN ('buy','sell')),
  price_gp INTEGER,
  quantity INTEGER,
  confidence REAL NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL,
  detected_at_utc TEXT NOT NULL
);
CREATE INDEX idx_events_world_item ON market_events(world_id, item_id, detected_at_utc);

CREATE TABLE tc_rates (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id),
  captured_at_utc TEXT NOT NULL,
  buy_price_gp INTEGER,
  buy_amount INTEGER,
  sell_price_gp INTEGER,
  sell_amount INTEGER,
  scan_id TEXT REFERENCES market_scans(id),
  source TEXT NOT NULL,
  confidence REAL
);
CREATE INDEX idx_tc_world ON tc_rates(world_id, captured_at_utc);

CREATE TABLE transfer_rules (
  id INTEGER PRIMARY KEY,
  origin_world_id INTEGER NOT NULL REFERENCES worlds(id),
  destination_world_id INTEGER NOT NULL REFERENCES worlds(id),
  status TEXT NOT NULL CHECK (status IN ('allowed','blocked','unknown')),
  reason TEXT NOT NULL,
  source_url TEXT,
  verified_at TEXT NOT NULL,
  valid_until TEXT,
  notes TEXT,
  UNIQUE (origin_world_id, destination_world_id, verified_at)
);
CREATE INDEX idx_transfer_rules ON transfer_rules(origin_world_id, destination_world_id, verified_at);

CREATE TABLE economic_rule_versions (
  id INTEGER PRIMARY KEY,
  rule_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_url TEXT,
  effective_from TEXT,
  verified_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_rules_key ON economic_rule_versions(rule_key, id);

CREATE TABLE arbitrage_runs (
  id TEXT PRIMARY KEY,
  origin_world_id INTEGER NOT NULL REFERENCES worlds(id),
  destination_world_id INTEGER NOT NULL REFERENCES worlds(id),
  strategy TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  result_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL
);

CREATE TABLE arbitrage_opportunities (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES arbitrage_runs(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  strategy TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  buy_cost_gp INTEGER NOT NULL,
  gross_revenue_gp INTEGER NOT NULL,
  market_fees_gp INTEGER NOT NULL,
  transfer_cost_gp INTEGER NOT NULL,
  other_costs_gp INTEGER NOT NULL,
  net_profit_gp INTEGER NOT NULL,
  roi_percent REAL,
  liquidity_score REAL,
  confidence_score REAL,
  warnings_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL
);
CREATE INDEX idx_opps_run ON arbitrage_opportunities(run_id, net_profit_gp);

CREATE TABLE transfer_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  current_world_id INTEGER REFERENCES worlds(id),
  last_transfer_at TEXT,
  has_skull_restriction INTEGER,
  is_guild_leader INTEGER,
  owns_house INTEGER,
  has_relevant_open_offers INTEGER,
  is_on_main_continent INTEGER,
  visited_calva INTEGER,
  transfer_type TEXT NOT NULL DEFAULT 'regular',
  available_eligible_tc INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE saved_carts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  run_id TEXT REFERENCES arbitrage_runs(id) ON DELETE SET NULL,
  constraints_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE saved_cart_items (
  id INTEGER PRIMARY KEY,
  cart_id TEXT NOT NULL REFERENCES saved_carts(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity INTEGER NOT NULL,
  buy_cost_gp INTEGER NOT NULL,
  expected_revenue_gp INTEGER NOT NULL,
  estimated_weight REAL,
  estimated_slots INTEGER
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tracked_characters (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  world TEXT,
  level INTEGER,
  vocation TEXT,
  known_deaths_json TEXT NOT NULL DEFAULT '[]',
  last_checked_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE character_events (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES tracked_characters(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  message TEXT NOT NULL,
  occurred_at TEXT,
  detected_at TEXT NOT NULL,
  UNIQUE (character_id, dedupe_key)
);

CREATE TABLE external_fetch_log (
  id INTEGER PRIMARY KEY,
  host TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status INTEGER,
  duration_ms INTEGER,
  bytes INTEGER,
  error TEXT
);
CREATE INDEX idx_fetch_log ON external_fetch_log(host, fetched_at);

CREATE TABLE http_cache (
  key TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE alert_rules (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  params_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE alert_events (
  id INTEGER PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  message TEXT NOT NULL,
  fired_at TEXT NOT NULL,
  read_at TEXT,
  UNIQUE (rule_id, dedupe_key)
);

CREATE TABLE seed_versions (
  name TEXT PRIMARY KEY,
  fetched_at TEXT NOT NULL,
  loaded_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'watch_lists',
    sql: `
-- Vigilancia de personajes (hunted list, amigos…) sobre la lista pública de conectados de cada mundo.
CREATE TABLE watch_lists (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  notify_login INTEGER NOT NULL DEFAULT 1,
  burst_threshold INTEGER,
  burst_window_sec INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL
);
INSERT INTO watch_lists (name, notify_login, burst_threshold, burst_window_sec, created_at)
VALUES ('Hunted', 1, 5, 60, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE watch_entries (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES watch_lists(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('character','guild')),
  name TEXT NOT NULL,
  world TEXT,
  note TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (list_id, kind, name)
);

CREATE TABLE watch_guild_members (
  entry_id INTEGER NOT NULL REFERENCES watch_entries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rank TEXT,
  level INTEGER,
  vocation TEXT,
  PRIMARY KEY (entry_id, name)
);

-- Último estado conocido de cada personaje vigilado (clave: nombre en minúsculas).
CREATE TABLE watch_status (
  name_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  world TEXT NOT NULL,
  online INTEGER NOT NULL,
  level INTEGER,
  vocation TEXT,
  last_login_at TEXT,
  last_seen_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE watch_events (
  id INTEGER PRIMARY KEY,
  list_id INTEGER REFERENCES watch_lists(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('login','logout','level','burst')),
  name TEXT,
  world TEXT,
  level INTEGER,
  message TEXT NOT NULL,
  detected_at TEXT NOT NULL
);
CREATE INDEX idx_watch_events ON watch_events(detected_at);
`,
  },
  {
    version: 3,
    name: 'third_party_sync',
    sql: `
-- Última importación de tibiamarket.top por mundo: evita bajar de nuevo un mundo que no cambió.
-- remote_updated_at: last_update de tibiamarket del último import correcto; checked_at: última vez que se revisó.
CREATE TABLE third_party_sync (
  world_id INTEGER PRIMARY KEY REFERENCES worlds(id),
  remote_updated_at TEXT,
  imported_at TEXT,
  items INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  checked_at TEXT NOT NULL
);
`,
  },
  {
    version: 4,
    name: 'screenshot_analysis',
    sql: `
-- Resultado del análisis automático de cada captura (item y mundo detectados, decisión y motivos).
ALTER TABLE screenshots ADD COLUMN analysis_json TEXT;
`,
  },
  {
    version: 5,
    name: 'boss_sightings',
    sql: `
-- Apariciones de bosses en las Kill Statistics de cada mundo (día de la estadística, ~3 a. m. CET).
-- Se guarda el nombre del mundo (no FK): el historial incluye mundos fusionados o cerrados.
CREATE TABLE boss_sightings (
  world TEXT NOT NULL COLLATE NOCASE,
  boss TEXT NOT NULL,
  stats_day TEXT NOT NULL,
  killed INTEGER NOT NULL,
  players_killed INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('seed','tibiamaps','tibiadata')),
  PRIMARY KEY (world, boss, stats_day)
);

-- Rango de días de estadística ya revisados por mundo: lo que falte se baja al abrir el mundo.
CREATE TABLE boss_coverage (
  world TEXT PRIMARY KEY COLLATE NOCASE,
  history_from TEXT NOT NULL,
  through TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
]
