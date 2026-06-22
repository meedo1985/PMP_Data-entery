// ================================================================
// providers.js — providers management
//
// Provider types:
//   'space'    = satellite / uplink operators (only in Space Provider field)
//   'location' = studio / crew / SNG / package / other (in main Provider field)
//
// UNIQUE constraint: (name, type) — same provider name is allowed
// with different types (e.g. "WhiteClicks" as both location + space).
// ================================================================
const db = require('../db/database');

function list() {
  return db.get().prepare(`
    SELECT id, name, place, type, notes, active, created_at
    FROM providers
    WHERE active = 1
    ORDER BY type, name
  `).all();
}

function get(id) {
  return db.get().prepare('SELECT * FROM providers WHERE id = ?').get(id);
}

function save({ id, name, place, type, notes, active = 1 }) {
  const database = db.get();
  name = String(name || '').trim();
  type = String(type || 'location').trim();
  if (!name) throw new Error('NAME_REQUIRED');

  if (id) {
    // Check for duplicate (name + type), excluding this record
    const dup = database.prepare(
      'SELECT id FROM providers WHERE name = ? COLLATE NOCASE AND type = ? AND id != ? AND active = 1'
    ).get(name, type, id);
    if (dup) throw new Error('DUPLICATE_NAME_TYPE');

    database.prepare(
      'UPDATE providers SET name = ?, place = ?, type = ?, notes = ?, active = ? WHERE id = ?'
    ).run(name, place || null, type, notes || null, active ? 1 : 0, id);
    return { ok: true, id };
  }

  // Check for duplicate (name + type) before insert
  const existing = database.prepare(
    'SELECT id FROM providers WHERE name = ? COLLATE NOCASE AND type = ? AND active = 1'
  ).get(name, type);
  if (existing) throw new Error('DUPLICATE_NAME_TYPE');

  try {
    const res = database.prepare(
      'INSERT INTO providers (name, place, type, notes, active) VALUES (?, ?, ?, ?, ?)'
    ).run(name, place || null, type, notes || null, active ? 1 : 0);
    return { ok: true, id: res.lastInsertRowid };
  } catch (err) {
    // Catch residual UNIQUE(name) constraint from old DB schema
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('unique'))) {
      throw new Error('DUPLICATE_NAME_TYPE');
    }
    throw err;
  }
}

function remove(id) {
  db.get().prepare('UPDATE providers SET active = 0 WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = { list, get, save, remove };
