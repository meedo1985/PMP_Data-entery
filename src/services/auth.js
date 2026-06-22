// ================================================================
// auth.js — authentication service (bcrypt)
// ================================================================
const bcrypt = require('bcryptjs');
const db = require('../db/database');

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

function _sanitizeUsername(username) {
  if (typeof username !== 'string') return '';
  return username.trim().slice(0, 60); // limit length
}

function _validatePassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

async function login(username, password) {
  const database = db.get();
  const cleanUser = _sanitizeUsername(username);

  if (!cleanUser) {
    _audit(null, 'login_failed', 'users', null, { reason: 'empty_username' });
    return null;
  }

  const u = database.prepare(`
    SELECT id, username, password_hash, full_name, role, active, must_change_pwd, permissions
    FROM users
    WHERE username = ? COLLATE NOCASE
  `).get(cleanUser);

  if (!u || !u.active) {
    _audit(null, 'login_failed', 'users', u ? u.id : null, { username: cleanUser });
    return null;
  }

  const ok = await bcrypt.compare(password || '', u.password_hash);
  if (!ok) {
    _audit(u.id, 'login_failed', 'users', u.id, { username: cleanUser });
    return null;
  }

  database.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(u.id);
  _audit(u.id, 'login', 'users', u.id, { username: cleanUser });

  // Strip the hash before returning
  delete u.password_hash;
  return u;
}

async function changePassword(userId, oldPassword, newPassword) {
  const database = db.get();
  const u = database.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
  if (!u) return { ok: false, error: 'USER_NOT_FOUND' };

  const ok = await bcrypt.compare(oldPassword || '', u.password_hash);
  if (!ok) {
    return { ok: false, error: 'OLD_PASSWORD_INCORRECT' };
  }
  if (!_validatePassword(newPassword)) {
    return { ok: false, error: 'PASSWORD_TOO_SHORT' };
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  database.prepare(`
    UPDATE users SET password_hash = ?, must_change_pwd = 0 WHERE id = ?
  `).run(hash, userId);

  _audit(userId, 'change_password', 'users', userId, {});
  return { ok: true };
}

function _audit(userId, action, entity, entityId, details) {
  try {
    db.get().prepare(`
      INSERT INTO audit_log (user_id, action, entity, entity_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, entity, entityId, JSON.stringify(details || {}));
  } catch (_) {}
}

module.exports = { login, changePassword };
