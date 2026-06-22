// ================================================================
// settings.js — single source of truth for app_settings key/value access.
// Replaces the getSetting/setSetting helpers that were copy-pasted across
// main.js, server.js and adminHandlers.js.
// ================================================================
const db = require('../db/database');

function get(key, def = null) {
  const row = db.get().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : def;
}

function set(key, value) {
  db.get().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
    .run(key, value == null ? '' : String(value));
}

const COMPANY_KEYS = [
  'company_name', 'department_name', 'company_address', 'company_phone',
  'company_email', 'manager_name', 'manager_title', 'company_logo_path'
];
const COMPANY_DEFAULTS = {
  company_name: 'PMP Media Productions',
  department_name: 'Production Department',
  manager_title: 'General Manager'
};

function getCompany() {
  const out = {};
  for (const k of COMPANY_KEYS) out[k] = get(k, COMPANY_DEFAULTS[k] || '');
  return out;
}

function saveCompany(data) {
  for (const k of COMPANY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, k)) set(k, data[k]);
  }
  return { ok: true };
}

module.exports = { get, set, getCompany, saveCompany, COMPANY_KEYS };
