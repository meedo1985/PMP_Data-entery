-- ================================================================
-- migrate_v2.sql — PMP schema additions (v2)
-- Run once after initial schema to add:
--   1. provider_locations  — multiple locations per provider
--   2. services_catalog    — managed service list per category
--   3. invoice_templates   — saved template paths
-- ================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------
-- provider_locations — multiple named locations per provider
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL,  -- no FK to survive table rebuilds
  name        TEXT    NOT NULL,
  sort_ord    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(provider_id, name)
);
CREATE INDEX IF NOT EXISTS ix_provider_locations_pid ON provider_locations(provider_id);

-- ----------------------------------------------------------------
-- services_catalog — managed service list per category
--   Replaces the hardcoded SERVICE_MAP in the frontend
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services_catalog (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT    NOT NULL CHECK(category IN ('live','package','space','crew')),
  name     TEXT    NOT NULL,
  sort_ord INTEGER NOT NULL DEFAULT 0,
  UNIQUE(category, name)
);
CREATE INDEX IF NOT EXISTS ix_services_cat ON services_catalog(category);

-- ----------------------------------------------------------------
-- Seed default services (idempotent)
-- ----------------------------------------------------------------
INSERT OR IGNORE INTO services_catalog (category, name, sort_ord) VALUES
  ('live',    'Live Studio',         1),
  ('live',    'Live Stand Up',       2),
  ('live',    'Live SNG',            3),
  ('live',    'Live Studio - TVU',   4),
  ('live',    'SNG Truck',           5),
  ('package', 'Report',              1),
  ('package', 'Rushes',              2),
  ('package', 'Interview',           3),
  ('package', 'Vox Pop',             4),
  ('package', 'As Live',             5),
  ('package', 'Radio Package',       6),
  ('space',   'Space segment 3 MHz', 1),
  ('space',   'Space segment 4.5 MHz',2),
  ('space',   'Space segment 6 MHz', 3),
  ('space',   'Space segment 9 MHz', 4),
  ('crew',    'Camera Crew',         1),
  ('crew',    'TVU Crew',            2),
  ('crew',    'Live SNG Crew',       3);

-- ----------------------------------------------------------------
-- invoice_templates — saved template metadata
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  file_path   TEXT    NOT NULL,
  description TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

