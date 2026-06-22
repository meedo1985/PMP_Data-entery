// ================================================================
// locations.js — provider locations CRUD
//
// The provider_locations table may have a broken FK reference
// (pointing to providers_old) after failed migrations.
// ensureTable() detects and heals this automatically.
// ================================================================
const db = require('../db/database');

let _tableReady = false;

function ensureTable() {
  if (_tableReady) return;

  const database = db.get();

  // Check if provider_locations exists and if its schema is broken
  const existing = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='provider_locations'"
  ).get();

  if (existing) {
    const sql = existing.sql || '';
    // If the FK references providers_old (broken) or any renamed variant,
    // recreate the table without FK constraint
    const needsRebuild = sql.includes('providers_old') ||
                         sql.includes('providers_new') ||
                         sql.includes('providers_v3');

    if (needsRebuild) {
      console.log('[locations] Rebuilding provider_locations (broken FK detected)...');
      _rebuildTable(database);
    }
  } else {
    // Table doesn't exist — create it fresh without FK
    _createTable(database);
  }

  _tableReady = true;
}

function _createTable(database) {
  database.pragma('foreign_keys = OFF');
  database.prepare(
    'CREATE TABLE IF NOT EXISTS provider_locations (' +
    '  id          INTEGER PRIMARY KEY AUTOINCREMENT,' +
    '  provider_id INTEGER NOT NULL,' +
    '  name        TEXT    NOT NULL,' +
    '  sort_ord    INTEGER NOT NULL DEFAULT 0,' +
    '  UNIQUE(provider_id, name)' +
    ')'
  ).run();
  try {
    database.prepare(
      'CREATE INDEX IF NOT EXISTS ix_ploc_pid ON provider_locations(provider_id)'
    ).run();
  } catch (_) {}
  database.pragma('foreign_keys = ON');
  console.log('[locations] provider_locations table created.');
}

function _rebuildTable(database) {
  database.pragma('foreign_keys = OFF');
  try {
    // Read existing data (may fail if table is already broken — that's ok)
    let rows = [];
    try {
      rows = database.prepare('SELECT * FROM provider_locations').all();
      console.log('[locations] Saved ' + rows.length + ' existing locations');
    } catch (_) {
      console.warn('[locations] Could not read existing locations — will create empty');
    }

    // Drop old broken table
    database.prepare('DROP TABLE IF EXISTS provider_locations').run();

    // Create clean table without FK
    database.prepare(
      'CREATE TABLE provider_locations (' +
      '  id          INTEGER PRIMARY KEY AUTOINCREMENT,' +
      '  provider_id INTEGER NOT NULL,' +
      '  name        TEXT    NOT NULL,' +
      '  sort_ord    INTEGER NOT NULL DEFAULT 0,' +
      '  UNIQUE(provider_id, name)' +
      ')'
    ).run();
    try {
      database.prepare(
        'CREATE INDEX IF NOT EXISTS ix_ploc_pid ON provider_locations(provider_id)'
      ).run();
    } catch (_) {}

    // Restore data — only rows whose provider_id still exists in providers
    if (rows.length > 0) {
      const validIds = new Set(
        database.prepare('SELECT id FROM providers').all().map(function(p){ return p.id; })
      );
      const validRows = rows.filter(function(r){ return validIds.has(r.provider_id); });
      if (validRows.length > 0) {
        const ins = database.prepare(
          'INSERT OR IGNORE INTO provider_locations (id, provider_id, name, sort_ord) VALUES (?,?,?,?)'
        );
        database.transaction(function() {
          validRows.forEach(function(r){ ins.run(r.id, r.provider_id, r.name, r.sort_ord); });
        })();
      }
      const restored = database.prepare('SELECT COUNT(*) AS c FROM provider_locations').get().c;
      console.log('[locations] Restored ' + restored + ' locations (filtered from ' + rows.length + ').');
    }
  } catch (err) {
    console.error('[locations] Rebuild failed:', err.message);
  }
  database.pragma('foreign_keys = ON');
}

// ================================================================
// PUBLIC API
// ================================================================
function listForProvider(providerId) {
  ensureTable();
  const pid = Number(providerId);
  if (!pid) return [];
  return db.get().prepare(
    'SELECT id, provider_id, name, sort_ord ' +
    'FROM provider_locations WHERE provider_id = ? ' +
    'ORDER BY sort_ord, name'
  ).all(pid);
}

function add(providerId, name) {
  ensureTable();
  const pid = Number(providerId);
  name = String(name || '').trim();

  if (!pid)  throw new Error('PROVIDER_ID_REQUIRED');
  if (!name) throw new Error('LOCATION_NAME_REQUIRED');

  const database = db.get();

  // Get next sort order
  const maxRow = database.prepare(
    'SELECT COALESCE(MAX(sort_ord), 0) AS m FROM provider_locations WHERE provider_id = ?'
  ).get(pid);
  const nextOrd = (maxRow ? maxRow.m : 0) + 1;

  const result = database.prepare(
    'INSERT OR IGNORE INTO provider_locations (provider_id, name, sort_ord) VALUES (?, ?, ?)'
  ).run(pid, name, nextOrd);

  return { ok: true, id: result.lastInsertRowid, inserted: result.changes > 0 };
}

function remove(id) {
  ensureTable();
  db.get().prepare('DELETE FROM provider_locations WHERE id = ?').run(Number(id));
  return { ok: true };
}

function removeAllForProvider(providerId) {
  ensureTable();
  db.get().prepare('DELETE FROM provider_locations WHERE provider_id = ?').run(Number(providerId));
  return { ok: true };
}

module.exports = { listForProvider, add, remove, removeAllForProvider };
