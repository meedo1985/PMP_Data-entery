-- migrate_v3.sql — Change providers UNIQUE constraint
--   OLD: UNIQUE on name alone
--   NEW: UNIQUE on (name, type)
-- Runs exactly once (tracked in migrations_applied table).

-- Drop the view first — SQLite validates it during RENAME and would fail
-- because the view references "providers" which gets dropped below.
DROP VIEW IF EXISTS v_orders_full;
PRAGMA foreign_keys = OFF;

-- Safety: Ensure a 'providers' table exists so the SELECT below doesn't crash 
-- if the table was renamed or dropped in a failed previous attempt.
CREATE TABLE IF NOT EXISTS providers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  place       TEXT,
  type        TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS providers_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL COLLATE NOCASE,
  place       TEXT,
  type        TEXT,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, type) ON CONFLICT IGNORE
);

INSERT OR IGNORE INTO providers_new (id, name, place, type, notes, active, created_at)
SELECT id, name, place, type, notes, active, created_at FROM providers;

DROP TABLE IF EXISTS providers;

ALTER TABLE providers_new RENAME TO providers;

PRAGMA foreign_keys = ON;
