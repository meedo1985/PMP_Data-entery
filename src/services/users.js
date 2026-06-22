// ================================================================
// users.js — user management
// ================================================================
const bcrypt = require('bcryptjs');
const db = require('../db/database');

function ensureDefaultAdmin() {
  const database = db.get();
  // Check specifically for admin existence, not just any user
  const n = database.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  if (n > 0) return;
  database.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, active, must_change_pwd)
    VALUES (?, ?, ?, 'admin', 1, 1)
  `).run('admin', bcrypt.hashSync('admin', 10), 'Administrator');
  console.log('[users] Created default admin (user=admin / pass=admin). Change on first login.');
}

// Reset (or create) the admin account to a known password. Used by the
// `--reset-admin` CLI flag for account recovery. Forces a password change
// on next login (must_change_pwd = 1) so the temporary password is short-lived.
function resetAdmin(password = 'admin123') {
  const database = db.get();
  const hash = bcrypt.hashSync(password, 10);
  const existing = database.prepare(
    "SELECT id FROM users WHERE username = 'admin' COLLATE NOCASE"
  ).get();
  if (existing) {
    database.prepare(`
      UPDATE users SET password_hash = ?, active = 1, must_change_pwd = 1
      WHERE username = 'admin' COLLATE NOCASE
    `).run(hash);
    return { ok: true, created: false, password };
  }
  database.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, active, must_change_pwd)
    VALUES ('admin', ?, 'Administrator', 'admin', 1, 1)
  `).run(hash);
  return { ok: true, created: true, password };
}

function list() {
  return db.get().prepare(`
    SELECT id, username, full_name, role, active, must_change_pwd, created_at, last_login, permissions
    FROM users ORDER BY username
  `).all();
}

function create({ username, password, full_name, role, active, permissions }) {
  const database = db.get();
  const hash = bcrypt.hashSync(password || 'changeme', 10);
  const perms = permissions && typeof permissions === 'object'
    ? JSON.stringify(permissions)
    : (permissions || null);
  const res = database.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, active, must_change_pwd, permissions)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(
    String(username).trim(), hash, full_name || null,
    _normalizeRole(role), active ? 1 : 0, perms
  );
  return { ok: true, id: res.lastInsertRowid };
}

function update({ id, full_name, role, active, password, permissions }) {
  const database = db.get();
  const sets = ['full_name = ?', 'role = ?', 'active = ?'];
  const vals = [full_name || null, _normalizeRole(role), active ? 1 : 0];
  if (password) {
    sets.push('password_hash = ?', 'must_change_pwd = ?');
    vals.push(bcrypt.hashSync(password, 10), 1);
  }
  if (permissions !== undefined) {
    sets.push('permissions = ?');
    vals.push(permissions && typeof permissions === 'object'
      ? JSON.stringify(permissions)
      : (permissions || null));
  }
  vals.push(id);
  database.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return { ok: true };
}

function remove(id, callingUserId) {
  const database = db.get();
  if (Number(id) === Number(callingUserId)) {
    throw new Error('CANNOT_DELETE_OWN_ACCOUNT');
  }
  const target = database.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (!target) return { ok: true };
  if (target.role === 'admin') {
    const remaining = database.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?"
    ).get(id).c;
    if (remaining === 0) throw new Error('CANNOT_DELETE_LAST_ADMIN');
  }
  database.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { ok: true };
}

function updateSelf(userId, { full_name }) {
  db.get().prepare('UPDATE users SET full_name = ? WHERE id = ?')
    .run(full_name != null ? String(full_name).trim() || null : null, userId);
  return { ok: true };
}

const VALID_ROLES = ['admin', 'manager', 'coordination', 'accountant', 'user'];

function _normalizeRole(r) {
  const v = String(r || '').toLowerCase();
  if (v.startsWith('admin'))   return 'admin';
  if (v.startsWith('manager')) return 'manager';
  if (v.startsWith('coord'))   return 'coordination';
  if (v.startsWith('account')) return 'accountant';
  if (v === 'user')            return 'user';
  throw new Error(`INVALID_ROLE: "${r}". Must be one of: ${VALID_ROLES.join(', ')}`);
}

module.exports = { ensureDefaultAdmin, resetAdmin, list, create, update, remove, updateSelf };
