const path = require('path');
const auth = require('../../services/auth');

module.exports = ({ ipcMain, session, getWindow, requireAuth }) => {
  
  ipcMain.handle('auth:login', async (event, { username, password }) => {
    const user = await auth.login(username, password);
    if (!user) return { ok: false, error: 'INVALID_CREDENTIALS' };
    session.currentUser = user;
    return { ok: true, user };
  });

  ipcMain.handle('auth:logout', async () => {
    session.currentUser = null;
    const win = getWindow();
    if (win) win.loadFile(path.join(__dirname, '../../renderer/login.html'));
    return { ok: true };
  });

  ipcMain.handle('auth:me', async () => session.currentUser);

  ipcMain.handle('auth:changePassword', requireAuth(async (user, { oldPassword, newPassword }) => {
    return auth.changePassword(user.id, oldPassword, newPassword);
  }));

  // nav:goto redirects to login if session has expired rather than throwing,
  // so callers on any page don't need to handle NOT_AUTHENTICATED explicitly.
  ipcMain.handle('nav:goto', async (event, pageName) => {
    const pageMap = {
      login: 'login.html',
      dashboard: 'pages/dashboard.html',
      orders_new: 'pages/orders_new.html',
      orders_edit: 'pages/orders_edit.html',
      clients: 'pages/clients.html',
      providers: 'pages/providers.html',
      pricing: 'pages/pricing.html',
      reports: 'pages/reports.html',
      settings: 'pages/settings.html',
      invoices: 'pages/invoices.html'
    };

    if (!session.currentUser && pageName !== 'login') {
      const win = getWindow();
      if (win) win.loadFile(path.join(__dirname, '../../renderer/login.html'));
      return { ok: true };
    }

    const file = pageMap[pageName];
    if (!file) throw new Error('UNKNOWN_PAGE: ' + pageName);

    const win = getWindow();
    if (win) win.loadFile(path.join(__dirname, '../../renderer', file));
    return { ok: true };
  });
};
