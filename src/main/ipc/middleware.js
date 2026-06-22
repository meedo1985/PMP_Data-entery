const permissions = require('../../services/permissions');

module.exports = (session) => ({
  requireAuth: (fn) => async (event, ...args) => {
    if (!session.currentUser) throw new Error('NOT_AUTHENTICATED');
    return fn(session.currentUser, ...args);
  },

  requireRole: (roles, fn) => {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return async (event, ...args) => {
      if (!session.currentUser) throw new Error('NOT_AUTHENTICATED');
      if (!allowed.includes(session.currentUser.role)) throw new Error('FORBIDDEN');
      return fn(session.currentUser, ...args);
    };
  },

  // New: granular permission check (admin always passes)
  requirePermission: (action, fn) => async (event, ...args) => {
    if (!session.currentUser) throw new Error('NOT_AUTHENTICATED');
    if (!permissions.can(session.currentUser, action)) throw new Error('FORBIDDEN: ' + action);
    return fn(session.currentUser, ...args);
  }
});
