const authHandlers = require('./authHandlers');
const coreHandlers = require('./coreHandlers');
const adminHandlers = require('./adminHandlers');
const middlewareFactory = require('./middleware');

module.exports = {
  init(ipcMain, session, getWindow) {
    const { requireAuth, requireRole, requirePermission } = middlewareFactory(session);
    const ctx = { 
      ipcMain, 
      session, 
      getWindow, 
      requireAuth, 
      requireRole,
      requirePermission
    };

    authHandlers(ctx);
    coreHandlers(ctx);
    adminHandlers(ctx);
  }
};