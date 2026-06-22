const permissions = require('../../services/permissions');

// Throws if the logged-in user still owes a password change. The only IPC
// channel that must work in that state is auth:changePassword, which is wired
// without these wrappers (see authHandlers.js).
function gatePwd(user) {
  if (user && user.must_change_pwd) throw new Error('MUST_CHANGE_PASSWORD');
}

module.exports = (session) => ({
  requireAuth: (fn) => async (event, ...args) => {
    if (!session.currentUser) throw new Error('NOT_AUTHENTICATED');
    gatePwd(session.currentUser);
    return fn(session.currentUser, ...args);
  },

  requireRole: (roles, fn) => {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return async (event, ...args) => {
      if (!session.currentUser) throw new Error('NOT_AUTHENTICATED');
      gatePwd(session.currentUser);
      if (!allowed.includes(session.currentUser.role)) throw new Error('FORBIDDEN');
      return fn(session.currentUser, ...args);
    };
  },

  // Granular permission check (admin passes via the matrix, not a role bypass)
  requirePermission: (action, fn) => async (event, ...args) => {
    if (!session.currentUser) throw new Error('NOT_AUTHENTICATED');
    gatePwd(session.currentUser);
    if (!permissions.can(session.currentUser, action)) throw new Error('FORBIDDEN: ' + action);
    return fn(session.currentUser, ...args);
  }
});
