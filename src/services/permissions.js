// ================================================================
// permissions.js — granular permission engine
// Admin can configure per-user permissions.
// ================================================================

// Default permission set per role, DERIVED from the shared matrix that the
// renderer also uses (src/renderer/js/perm-matrix.js) — single source of truth.
const PERM_MATRIX = require('../renderer/js/perm-matrix.js');
const DEFAULTS = {};
['admin', 'manager', 'coordination', 'accountant', 'user'].forEach(role => {
  DEFAULTS[role] = {};
  PERM_MATRIX.forEach(row => { DEFAULTS[role][row.key] = !!row[role]; });
});

const ALL_KEYS = PERM_MATRIX.map(row => row.key);

function getDefaults(role) {
  return { ...(DEFAULTS[role] || DEFAULTS.user) };
}

// Merge role defaults with any custom overrides stored in user.permissions JSON
function resolve(user) {
  if (!user) return { ...DEFAULTS.user };
  const base = getDefaults(user.role || 'user');
  if (user.permissions) {
    try {
      const custom = typeof user.permissions === 'string'
        ? JSON.parse(user.permissions)
        : user.permissions;
      Object.assign(base, custom);
    } catch (_) {}
  }
  return base;
}

function can(user, action) {
  const perms = resolve(user);
  return !!perms[action];
}

function isAdmin(user) {
  return user && user.role === 'admin';
}

// Middleware factory for IPC / Express
function requirePermission(action) {
  return (fn) => (user, ...args) => {
    if (isAdmin(user)) return fn(user, ...args);
    if (!can(user, action)) throw new Error('FORBIDDEN: ' + action);
    return fn(user, ...args);
  };
}

module.exports = { getDefaults, resolve, can, isAdmin, requirePermission, ALL_KEYS };
