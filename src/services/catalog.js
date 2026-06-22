// ================================================================
// catalog.js — services catalog (services per category) CRUD
// ================================================================
const db = require('../db/database');

const DEFAULT_SERVICES = {
  live:    ['Live Studio','Live Stand Up','Live SNG','Live Studio - TVU','SNG Truck'],
  package: ['Report','Rushes','Interview','Vox Pop','As Live','Radio Package'],
  space:   ['Space segment 3 MHz','Space segment 4.5 MHz','Space segment 6 MHz','Space segment 9 MHz'],
  crew:    ['Camera Crew','TVU Crew','Live SNG Crew']
};

function ensureTable() {
  db.get().exec(`
    CREATE TABLE IF NOT EXISTS services_catalog (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT    NOT NULL,
      name     TEXT    NOT NULL,
      sort_ord INTEGER NOT NULL DEFAULT 0,
      UNIQUE(category, name)
    );
    CREATE INDEX IF NOT EXISTS ix_services_cat ON services_catalog(category);
  `);

  // Seed defaults if empty
  const count = db.get().prepare('SELECT COUNT(*) AS c FROM services_catalog').get().c;
  if (count === 0) {
    const ins = db.get().prepare('INSERT OR IGNORE INTO services_catalog (category,name,sort_ord) VALUES (?,?,?)');
    const insertMany = db.get().transaction(() => {
      Object.entries(DEFAULT_SERVICES).forEach(([cat, names]) => {
        names.forEach((n, i) => ins.run(cat, n, i + 1));
      });
    });
    insertMany();
  }
}

function listAll() {
  ensureTable();
  return db.get().prepare(
    'SELECT id, category, name, sort_ord FROM services_catalog ORDER BY category, sort_ord, name'
  ).all();
}

function listByCategory(category) {
  ensureTable();
  return db.get().prepare(
    'SELECT id, category, name, sort_ord FROM services_catalog WHERE category = ? ORDER BY sort_ord, name'
  ).all(category);
}

function add({ category, name }) {
  ensureTable();
  name = String(name || '').trim();
  if (!name || !category) throw new Error('CATEGORY_AND_NAME_REQUIRED');
  const maxOrd = db.get()
    .prepare('SELECT COALESCE(MAX(sort_ord),0) AS m FROM services_catalog WHERE category = ?')
    .get(category);
  const r = db.get()
    .prepare('INSERT OR IGNORE INTO services_catalog (category, name, sort_ord) VALUES (?,?,?)')
    .run(category, name, (maxOrd.m || 0) + 1);
  if (r.changes === 0) throw new Error('SERVICE_ALREADY_EXISTS');
  return { ok: true, id: r.lastInsertRowid };
}

function remove(id) {
  ensureTable();
  db.get().prepare('DELETE FROM services_catalog WHERE id = ?').run(Number(id));
  return { ok: true };
}

module.exports = { listAll, listByCategory, add, remove };
