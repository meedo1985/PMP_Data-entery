-- ================================================================
-- schema.sql — PMP SQLite schema (v1)
-- Derived from the original Excel sheets:
--   Services, Settings (Clients/Codes), Users, Mappings
-- Plus new tables for pricing/invoicing/audit
-- ================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ----------------------------------------------------------------
-- users — replaces the old Users sheet
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT    NOT NULL,            -- bcrypt
  full_name       TEXT,
  role            TEXT    NOT NULL CHECK(role IN ('admin','manager','coordination','accountant','user')),
  active          INTEGER NOT NULL DEFAULT 1,
  must_change_pwd INTEGER NOT NULL DEFAULT 0,
  legacy_hash     TEXT,                        -- preserved from Excel for reference
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login      TEXT,
  permissions     TEXT
);

-- ----------------------------------------------------------------
-- clients — previously Settings!G:I
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  code        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  last_wo     INTEGER NOT NULL DEFAULT 0,
  group_name  TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- providers — previously Settings!C + a dedicated Providers sheet
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS providers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL COLLATE NOCASE,
  place       TEXT,
  type        TEXT,                            -- studio | crew | space | package | other
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, type) ON CONFLICT IGNORE
);

-- Lookups (places, services, payment statuses) — previously Settings A/B/E/F
CREATE TABLE IF NOT EXISTS lookups (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  kind     TEXT NOT NULL,                      -- place | service | payment_status | currency
  value    TEXT NOT NULL,
  sort_ord INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, value)
);

-- ----------------------------------------------------------------
-- orders — previously the Services sheet
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_date        TEXT    NOT NULL,          -- ISO yyyy-mm-dd
  client_id         INTEGER NOT NULL REFERENCES clients(id)   ON DELETE RESTRICT,
  service           TEXT,
  category          TEXT CHECK(category IN ('live','package','space','crew') OR category IS NULL),
  wo_client         TEXT,                      -- Work Order (Client)
  wo_internal       TEXT UNIQUE,               -- Work Order (Internal) e.g. PRESS-0010
  place             TEXT,
  start_time        TEXT,                      -- HH:MM
  end_time          TEXT,                      -- HH:MM
  duration_minutes  INTEGER,
  duration_seconds  INTEGER,                    -- seconds part (0-59); report shows M:SS when > 0
  bandwidth_mhz     REAL,
  provider_id       INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  space_provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
  reporter          TEXT,
  place_ar          TEXT,                      -- Arabic place name (report display)
  rate              REAL    DEFAULT 0,
  revenue           REAL    NOT NULL DEFAULT 0,
  cost              REAL    NOT NULL DEFAULT 0,
  currency          TEXT    NOT NULL DEFAULT 'USD',
  invoice_no        TEXT,
  payment_status    TEXT    NOT NULL DEFAULT 'Pending',
  notes             TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by        INTEGER REFERENCES users(id),
  updated_at        TEXT,
  live_type         TEXT,
  crew_type         TEXT,
  use_special       INTEGER DEFAULT 0,
  special_price     REAL
);

CREATE INDEX IF NOT EXISTS ix_orders_date        ON orders(order_date);
CREATE INDEX IF NOT EXISTS ix_orders_client      ON orders(client_id);
CREATE INDEX IF NOT EXISTS ix_orders_provider    ON orders(provider_id);
CREATE INDEX IF NOT EXISTS ix_orders_status      ON orders(payment_status);

-- ----------------------------------------------------------------
-- Pricing (3 sheets in Excel → 3 tables)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_default (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,                      -- live | space | crew | package
  type     TEXT,                               -- per5 | flat30 | flat60 | base15 | full_day | half_day | per_minute
  label    TEXT,
  price    REAL NOT NULL,
  UNIQUE(category, type, label)
);

CREATE TABLE IF NOT EXISTS pricing_client (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,
  type       TEXT,
  label      TEXT,
  price      REAL NOT NULL,
  UNIQUE(client_id, category, type, label)
);

CREATE TABLE IF NOT EXISTS pricing_provider (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  type        TEXT,
  label       TEXT,
  cost        REAL NOT NULL,
  UNIQUE(provider_id, category, type, label)
);

-- ----------------------------------------------------------------
-- payments — new; tracks partial/full payments against orders
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount        REAL    NOT NULL,
  payment_date  TEXT    NOT NULL,
  method        TEXT,
  reference     TEXT,
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_payments_order ON payments(order_id);

-- ----------------------------------------------------------------
-- audit_log — replaces the __PMP_ErrorLog__ sheet (generalized)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,                    -- login | logout | create | update | delete | error
  entity     TEXT,                             -- orders | clients | providers | users | system
  entity_id  INTEGER,
  level      TEXT DEFAULT 'INFO',              -- INFO | WARN | ERROR
  details    TEXT,                             -- JSON
  ts         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_ts     ON audit_log(ts);
CREATE INDEX IF NOT EXISTS ix_audit_user   ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_log(entity, entity_id);

-- ----------------------------------------------------------------
-- settings — key/value store for app configuration
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ----------------------------------------------------------------
-- Views to make reporting / dashboards trivial
-- PERFORMANCE: use LEFT JOIN with derived table instead of per-row correlated subqueries.
-- ----------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_orders_full AS
SELECT
  o.*,
  c.name  AS client_name,
  c.code  AS client_code,
  c.group_name AS client_group,
  p.name  AS provider_name,
  sp.name AS space_provider_name,
  (o.revenue - o.cost) AS profit,
  COALESCE(pay.total_paid, 0) AS paid_amount,
  (o.revenue - COALESCE(pay.total_paid, 0)) AS due_amount
FROM orders o
LEFT JOIN clients   c  ON c.id  = o.client_id
LEFT JOIN providers p  ON p.id  = o.provider_id
LEFT JOIN providers sp ON sp.id = o.space_provider_id
LEFT JOIN (SELECT order_id, SUM(amount) AS total_paid FROM payments GROUP BY order_id) pay ON pay.order_id = o.id;

-- ----------------------------------------------------------------
-- Seed default lookups (idempotent — only if empty)
-- ----------------------------------------------------------------
INSERT OR IGNORE INTO lookups (kind, value, sort_ord) VALUES
  ('payment_status','Pending', 1),
  ('payment_status','Approved',2),
  ('payment_status','Paid',    3),
  ('payment_status','Partial', 4),
  ('currency','USD',1),
  ('currency','EUR',2),
  ('currency','ILS',3),
  ('currency','JOD',4);

-- Note: pricing_default is intentionally NOT seeded.
-- Admins set real prices either by running migration from an Excel file
-- that has a Pricing sheet, or via the Pricing UI.
