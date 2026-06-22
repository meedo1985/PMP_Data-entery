const { dialog, app } = require('electron');
const path = require('path');
const users = require('../../services/users');
const reports = require('../../services/reports');
const invoices = require('../../services/invoices');
const migrate = require('../../db/migrate-from-excel');
const server = require('../../server/server');
const db = require('../../db/database');

module.exports = ({ ipcMain, requireAuth, requireRole, getWindow }) => {
  // ----- Users (admin only) -----
  ipcMain.handle('users:list',   requireRole(['admin'], () => users.list()));
  ipcMain.handle('users:create', requireRole(['admin'], (u, data) => users.create(data)));
  ipcMain.handle('users:update', requireRole(['admin'], (u, data) => users.update(data)));
  ipcMain.handle('users:delete', requireRole(['admin'], (u, id) => users.remove(id, u.id)));
  // Any authenticated user can update their own name
  ipcMain.handle('users:updateSelf', requireAuth((u, data) => users.updateSelf(u.id, data)));

  // ----- Invoices -----
  ipcMain.handle('invoices:fields', requireAuth(() => invoices.availableFields()));
  ipcMain.handle('invoices:preview', requireAuth((u, orderId) => invoices.getOrderData(orderId)));
  ipcMain.handle('invoices:fill', requireAuth(async (u, { templatePath, orderId, outputPath }) => {
    return await invoices.fillDocx(templatePath, orderId, outputPath);
  }));

  // ----- Client Invoice (Excel) -----
  ipcMain.handle('invoices:clientData', requireAuth((u, { clientId, filters }) => {
    return invoices.getClientInvoiceData(clientId, filters || {});
  }));

  ipcMain.handle('invoices:generateClient', requireAuth(async (u, { clientId, filters, format }) => {
    const win = getWindow();
    const data = invoices.getClientInvoiceData(clientId, filters || {});
    if (!data.orders.length) throw new Error('NO_ORDERS_FOR_CLIENT');

    const isWord = format === 'word';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save Client Invoice',
      defaultPath: `Invoice_${data.client.code}_${data.invoice_date}.${isWord ? 'docx' : 'xlsx'}`,
      filters: isWord
        ? [{ name: 'Word Document', extensions: ['docx'] }]
        : [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const result = isWord
      ? await invoices.generateWordInvoice(data, filePath)
      : await invoices.generateExcelInvoice(data, filePath);
    return { ...result, filePath };
  }));

  // ----- Reports & Excel Export -----
  ipcMain.handle('reports:run', requireAuth((u, filters) => reports.runReport(filters || {}, u)));
  ipcMain.handle('reports:summary', requireAuth((u, filters) => reports.summary(filters || {}, u)));

  ipcMain.handle('reports:exportExcel', requireAuth(async (u, filters) => {
    const win = getWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Save Report as Excel',
      defaultPath: `PMP_Report_${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const { wb, rowCount } = await reports.buildReportWorkbook(filters || {}, u);

    // Try to write; if file is locked (EBUSY), append timestamp and retry
    let finalPath = filePath;
    try {
      await wb.xlsx.writeFile(finalPath);
    } catch (writeErr) {
      if (writeErr && writeErr.code === 'EBUSY') {
        const ext = path.extname(filePath);
        const base = filePath.slice(0, -ext.length);
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        finalPath = `${base}_${ts}${ext}`;
        await wb.xlsx.writeFile(finalPath);
      } else {
        throw writeErr;
      }
    }
    return { ok: true, filePath: finalPath, rowCount };
  }));

  // ----- Migration -----
  ipcMain.handle('migrate:preview', requireRole(['admin'], async (u) => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Preview Excel Import (PMP Data Sheet)',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths[0]) return { ok: false, canceled: true };
    return migrate.getPreview(filePaths[0]);
  }));

  ipcMain.handle('migrate:confirm', requireRole(['admin'], (u, parsedData) => {
    return migrate.commitImport(parsedData, u);
  }));

  ipcMain.handle('migrate:cleanDuplicates', requireRole(['admin'], () => {
    return migrate.cleanDuplicates();
  }));

  // ----- System & Audit -----
  ipcMain.handle('sys:auditLog', requireRole(['admin'], async () => {
    return db.get().prepare(`
      SELECT a.ts, a.action, a.entity, a.level, a.details, u.username
      FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT 50
    `).all();
  }));

  ipcMain.handle('sys:userDataPath', async () => app.getPath('userData'));
  ipcMain.handle('sys:version', async () => app.getVersion());

  // ----- LAN Server Control -----
  ipcMain.handle('sys:lanStatus', requireAuth(async () => {
    const database = db.get();
    const getSetting = (k, d) => {
      const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(k);
      return row ? row.value : d;
    };
    return {
      running: server.isRunning(),
      enabled: getSetting('lan_enabled', '1') === '1',
      port: Number(getSetting('lan_port', '3737')) || 3737,
      addresses: server.getLanAddresses()
    };
  }));

  ipcMain.handle('sys:qrcode', requireRole(['admin'], async () => {
    const QRCode = require('qrcode');
    const addresses = server.getLanAddresses();
    const database = db.get();
    const getSetting = (k, d) => {
      const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(k);
      return row ? row.value : d;
    };
    const port = Number(getSetting('lan_port', '3737')) || 3737;
    const url = addresses.length ? `http://${addresses[0]}:${port}` : `http://localhost:${port}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
    return { ok: true, dataUrl, url };
  }));

  ipcMain.handle('sys:lanToggle', requireRole(['admin'], async (u, { enabled, port }) => {
    const database = db.get();
    const set = (k, v) => database.prepare(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)'
    ).run(k, String(v));

    if (port) set('lan_port', Number(port));
    set('lan_enabled', enabled ? 1 : 0);

    if (server.isRunning()) await server.stop();
    if (enabled) {
      await server.start({ host: '0.0.0.0', port: Number(port) || 3737 });
    }
    return { running: server.isRunning(), enabled: !!enabled, port: Number(port) || 3737, addresses: server.getLanAddresses() };
  }));

  // ----- Company Settings -----
  ipcMain.handle('settings:getCompany', requireRole(['admin'], () => {
    const database = db.get();
    const getSetting = (k, d) => {
      const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(k);
      return row ? row.value : d;
    };
    return {
      company_name:      getSetting('company_name',      'PMP Media Productions'),
      department_name:   getSetting('department_name',   'Production Department'),
      company_address:   getSetting('company_address',   ''),
      company_phone:     getSetting('company_phone',     ''),
      company_email:     getSetting('company_email',     ''),
      manager_name:      getSetting('manager_name',      ''),
      manager_title:     getSetting('manager_title',     'General Manager'),
      company_logo_path: getSetting('company_logo_path', '')
    };
  }));

  ipcMain.handle('settings:saveCompany', requireRole(['admin'], (u, data) => {
    const database = db.get();
    const set = (k, v) => database.prepare(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)'
    ).run(k, String(v == null ? '' : v));
    ['company_name','department_name','company_address','company_phone','company_email',
     'manager_name','manager_title','company_logo_path'].forEach(k => {
      if (Object.prototype.hasOwnProperty.call(data, k)) set(k, data[k]);
    });
    return { ok: true };
  }));
};
