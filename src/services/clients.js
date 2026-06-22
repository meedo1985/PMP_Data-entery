// ================================================================
// clients.js — clients management + work-order number sequencing
// ================================================================
const db = require('../db/database');

function list() {
  return db.get().prepare(`
    SELECT id, name, code, last_wo, group_name, notes, active, created_at
    FROM clients
    WHERE active = 1
    ORDER BY name
  `).all();
}

function get(id) {
  return db.get().prepare('SELECT * FROM clients WHERE id = ?').get(id);
}

function save({ id, name, code, group_name, notes, active = 1 }) {
  const database = db.get();
  name = String(name || '').trim();
  code = String(code || '').trim().toUpperCase();
  if (!name || !code) throw new Error('NAME_AND_CODE_REQUIRED');

  if (id) {
    database.prepare(`
      UPDATE clients SET name = ?, code = ?, group_name = ?, notes = ?, active = ?
      WHERE id = ?
    `).run(name, code, group_name || null, notes || null, active ? 1 : 0, id);
    return { ok: true, id };
  }
  const res = database.prepare(`
    INSERT INTO clients (name, code, last_wo, group_name, notes, active)
    VALUES (?, ?, 0, ?, ?, ?)
  `).run(name, code, group_name || null, notes || null, active ? 1 : 0);
  return { ok: true, id: res.lastInsertRowid };
}

function remove(id) {
  // Soft delete to preserve referential history
  db.get().prepare('UPDATE clients SET active = 0 WHERE id = ?').run(id);
  return { ok: true };
}

// Returns the NEXT WO number formatted as "CODE-0000" — does NOT consume it.
// Only orders.save() should atomically consume (increment).
// Note: the preview number shown in the UI may differ from the number finally assigned if two
// users open the new-order form simultaneously. This is cosmetic — the actual save is
// wrapped in a transaction so the assigned number is always unique.
function peekNextWO(clientId) {
  const c = db.get().prepare('SELECT code, last_wo FROM clients WHERE id = ?').get(clientId);
  if (!c) return null;
  const next = (c.last_wo || 0) + 1;
  return { code: c.code, number: next, formatted: `${c.code}-${String(next).padStart(4, '0')}` };
}

// Atomic: consume & return the new WO number.
// Pass `database` when running inside a transaction (e.g. orders.save).
function consumeNextWO(clientId, database = db.get()) {
  const c = database.prepare('SELECT code, last_wo FROM clients WHERE id = ?').get(clientId);
  if (!c) throw new Error('CLIENT_NOT_FOUND');
  const next = (c.last_wo || 0) + 1;
  database.prepare('UPDATE clients SET last_wo = ? WHERE id = ?').run(next, clientId);
  return { code: c.code, number: next, formatted: `${c.code}-${String(next).padStart(4, '0')}` };
}

module.exports = { list, get, save, remove, peekNextWO, consumeNextWO };
