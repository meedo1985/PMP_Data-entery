// ================================================================
// server.js — Express HTTP server for LAN access
//   Runs inside the Electron main process.
//   Same services, same DB, same auth — just over HTTP + cookies.
// ================================================================
const express        = require('express');
const session        = require('express-session');
const MemoryStore    = require('memorystore')(session);
const cookieParser   = require('cookie-parser');
const rateLimit      = require('express-rate-limit');
const helmet         = require('helmet');
const path           = require('path');
const fs             = require('fs');
const os             = require('os');
const https          = require('https');
const crypto         = require('crypto');
const QRCode         = require('qrcode');

const db             = require('../db/database');
const auth           = require('../services/auth');
const permissions    = require('../services/permissions');
const settingsSvc    = require('../services/settings');
const backup         = require('../services/backup');
const users          = require('../services/users');
const clients        = require('../services/clients');
const providers      = require('../services/providers');
const orders         = require('../services/orders');
const pricing        = require('../services/pricing');
const reports        = require('../services/reports');
const payments       = require('../services/payments');
const locations      = require('../services/locations');
const catalog        = require('../services/catalog');
const invoices       = require('../services/invoices');

// ---------- App setup ----------
let _cachedSessionSecret = null;

function getOrCreateSessionSecret() {
  if (_cachedSessionSecret) return _cachedSessionSecret;
  const existing = settingsSvc.get('session_secret');
  if (existing) { _cachedSessionSecret = existing; return existing; }
  const secret = crypto.randomBytes(48).toString('hex');
  // The secret is stored in the app DB (plaintext). This is an acceptable trade-off for a
  // LAN-only desktop app where DB file access implies physical admin access. If this app ever
  // needs stronger session security, move the secret to a separate file with OS-level permissions.
  settingsSvc.set('session_secret', secret);
  _cachedSessionSecret = secret;
  return secret;
}

// Set by start() before createApp(): true when serving over HTTPS so the session
// cookie can be marked Secure.
let _useHttps = false;

function createApp() {
  const app = express();

  // Debug Logger: See every request that hits the server (dev only — noisy in production)
  if (process.argv.includes('--dev')) {
    app.use((req, res, next) => {
      console.log(`[LAN-REQ] ${new Date().toLocaleTimeString()} - ${req.ip} -> ${req.method} ${req.url}`);
      next();
    });
  }

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // Security headers + CSP. 'unsafe-inline' is required for scripts/styles because
  // the renderer uses inline event handlers and inline <style> blocks (shared with
  // the Electron file:// pages). Even so, default-src/connect-src 'self' blocks the
  // main XSS exfiltration vector (loading or phoning home to a remote origin).
  // HSTS is off because the LAN runs over plain HTTP by default.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    hsts: false,
    crossOriginEmbedderPolicy: false
  }));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  app.use(session({
    secret: getOrCreateSessionSecret(),
    name: 'pmp.sid',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',             // 'lax' is best for compatibility with LAN IP access
      secure: _useHttps,           // Secure cookie only when serving over HTTPS
      maxAge: 12 * 60 * 60 * 1000 // 12h
    },
    store: new MemoryStore({ checkPeriod: 24 * 60 * 60 * 1000 })
  }));

  // must_change_pwd lockout: a user who still owes a password change may only
  // log out or change their password. Everything else under /api is blocked.
  app.use((req, res, next) => {
    const u = req.session && req.session.user;
    if (u && u.must_change_pwd && req.path.startsWith('/api/')) {
      const allowed = ['/api/auth/change-password', '/api/auth/logout', '/api/auth/me'];
      if (!allowed.includes(req.path)) {
        return res.status(403).json({ ok: false, error: 'MUST_CHANGE_PASSWORD' });
      }
    }
    next();
  });

  // Rate-limit the login endpoint (defense against brute-force on LAN)
  const loginLimiter = rateLimit({
    windowMs: 60 * 1000,          // 1 min
    max: 10,                      // 10 attempts/min per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'TOO_MANY_ATTEMPTS' }
  });

  // ---------- Middleware helpers ----------
  function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ ok: false, error: 'NOT_AUTHENTICATED' });
    }
    next();
  }
  function requireRole(roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    return (req, res, next) => {
      if (!req.session || !req.session.user)
        return res.status(401).json({ ok: false, error: 'NOT_AUTHENTICATED' });
      if (!allowed.includes(req.session.user.role))
        return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
      next();
    };
  }
  // Granular permission check — mirrors the IPC middleware so LAN and desktop
  // enforce the same policy (role defaults + per-user overrides in users.permissions).
  function requirePermission(action) {
    return (req, res, next) => {
      if (!req.session || !req.session.user)
        return res.status(401).json({ ok: false, error: 'NOT_AUTHENTICATED' });
      if (!permissions.can(req.session.user, action))
        return res.status(403).json({ ok: false, error: 'FORBIDDEN: ' + action });
      next();
    };
  }
  function ok(res, data)    { return res.json({ ok: true,  data }); }
  function fail(res, err)   { return res.status(400).json({ ok: false, error: String(err && err.message || err) }); }

  // ================================================================
  // API Routes — mirror the IPC handlers in main.js
  // ================================================================

  // ----- Auth -----
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    try {
      const { username, password } = req.body || {};
      const user = await auth.login(username, password);
      if (!user) return res.status(401).json({ ok: false, error: 'INVALID_CREDENTIALS' });
      req.session.user = user;
      ok(res, { user });
    } catch (e) { fail(res, e); }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ ok: true, data: req.session && req.session.user || null });
  });

  app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
      const { oldPassword, newPassword } = req.body || {};
      const out = await auth.changePassword(req.session.user.id, oldPassword, newPassword);
      if (out && out.ok) req.session.user.must_change_pwd = 0; // unlock the session
      ok(res, out);
    } catch (e) { fail(res, e); }
  });

  // ----- Users (manageUsers) -----
  app.get   ('/api/users',        requirePermission('manageUsers'), (req, res) => { try { ok(res, users.list()); } catch (e) { fail(res, e); } });
  app.post  ('/api/users',        requirePermission('manageUsers'), (req, res) => { try { ok(res, users.create(req.body)); } catch (e) { fail(res, e); } });
  // Self-update (any logged-in user can update their own full_name)
  app.put   ('/api/users/me',     requireAuth, (req, res) => {
    try {
      const { full_name } = req.body || {};
      const u = req.session.user;
      ok(res, users.update({ id: u.id, full_name: full_name || u.full_name, role: u.role, active: 1 }));
      req.session.user = { ...u, full_name: full_name || u.full_name };
    } catch (e) { fail(res, e); }
  });
  app.put   ('/api/users/:id',    requirePermission('manageUsers'), (req, res) => { try { ok(res, users.update({ ...req.body, id: Number(req.params.id) })); } catch (e) { fail(res, e); } });
  app.delete('/api/users/:id',    requirePermission('manageUsers'), (req, res) => { try { ok(res, users.remove(Number(req.params.id), req.session.user.id)); } catch (e) { fail(res, e); } });

  // ----- Company Settings (manageSettings) -----
  app.get('/api/settings/company', requirePermission('manageSettings'), (req, res) => {
    try { ok(res, settingsSvc.getCompany()); } catch (e) { fail(res, e); }
  });

  app.put('/api/settings/company', requirePermission('manageSettings'), (req, res) => {
    try { ok(res, settingsSvc.saveCompany(req.body || {})); } catch (e) { fail(res, e); }
  });

  // ----- Clients -----
  app.get   ('/api/clients',           requireAuth, (req, res) => { try { ok(res, clients.list()); } catch (e) { fail(res, e); } });
  app.get   ('/api/clients/:id',       requireAuth, (req, res) => { try { ok(res, clients.get(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.post  ('/api/clients',           requirePermission('manageClients'), (req, res) => { try { ok(res, clients.save(req.body)); } catch (e) { fail(res, e); } });
  app.put   ('/api/clients/:id',       requirePermission('manageClients'), (req, res) => { try { ok(res, clients.save({ ...req.body, id: Number(req.params.id) })); } catch (e) { fail(res, e); } });
  app.delete('/api/clients/:id',       requirePermission('deleteClients'), (req, res) => { try { ok(res, clients.remove(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.get   ('/api/clients/:id/next-wo', requireAuth, (req, res) => { try { ok(res, clients.peekNextWO(Number(req.params.id))); } catch (e) { fail(res, e); } });

  // ----- Providers -----
  app.get   ('/api/providers',     requireAuth, (req, res) => { try { ok(res, providers.list()); } catch (e) { fail(res, e); } });
  app.get   ('/api/providers/:id', requireAuth, (req, res) => { try { ok(res, providers.get(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.post  ('/api/providers',     requirePermission('manageProviders'), (req, res) => { try { ok(res, providers.save(req.body)); } catch (e) { fail(res, e); } });
  app.put   ('/api/providers/:id', requirePermission('manageProviders'), (req, res) => { try { ok(res, providers.save({ ...req.body, id: Number(req.params.id) })); } catch (e) { fail(res, e); } });
  app.delete('/api/providers/:id', requirePermission('manageProviders'), (req, res) => { try { ok(res, providers.remove(Number(req.params.id))); } catch (e) { fail(res, e); } });

  // ----- Orders -----
  app.get   ('/api/orders',          requireAuth, (req, res) => { try { ok(res, orders.list(req.query, req.session.user)); } catch (e) { fail(res, e); } });
  app.get   ('/api/orders/recent',   requireAuth, (req, res) => { try { ok(res, orders.recent(Number(req.query.limit) || 50, req.session.user)); } catch (e) { fail(res, e); } });
  app.get   ('/api/orders/kpis',     requireAuth, (req, res) => { try { ok(res, orders.getKpis(req.session.user)); } catch (e) { fail(res, e); } });
  app.get   ('/api/orders/:id',      requireAuth, (req, res) => { try { ok(res, orders.get(Number(req.params.id), req.session.user)); } catch (e) { fail(res, e); } });
  app.post  ('/api/orders',          requirePermission('editOrders'), (req, res) => { try { ok(res, orders.save(req.body, req.session.user)); } catch (e) { fail(res, e); } });
  app.put   ('/api/orders/:id',      requirePermission('editOrders'), (req, res) => { try { ok(res, orders.save({ ...req.body, id: Number(req.params.id) }, req.session.user)); } catch (e) { fail(res, e); } });
  app.delete('/api/orders/:id',      requirePermission('deleteOrders'), (req, res) => { try { ok(res, orders.remove(Number(req.params.id))); } catch (e) { fail(res, e); } });

  // ----- Payments -----
  app.get   ('/api/orders/:id/payments', requireAuth, (req, res) => { try { ok(res, payments.listForOrder(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.post  ('/api/payments', requirePermission('managePayments'), (req, res) => { try { ok(res, payments.add(req.body, req.session.user)); } catch (e) { fail(res, e); } });
  app.delete('/api/payments/:id', requirePermission('managePayments'), (req, res) => { try { ok(res, payments.remove(Number(req.params.id), req.session.user)); } catch (e) { fail(res, e); } });

  // ----- Provider Locations -----
  app.get   ('/api/providers/:id/locations',    requireAuth, (req, res) => { try { ok(res, locations.listForProvider(req.params.id)); } catch (e) { fail(res, e); } });
  app.post  ('/api/providers/:id/locations',    requirePermission('manageProviders'), (req, res) => { try { ok(res, locations.add(req.params.id, req.body.name)); } catch (e) { fail(res, e); } });
  app.delete('/api/locations/:id',              requirePermission('manageProviders'), (req, res) => { try { ok(res, locations.remove(req.params.id)); } catch (e) { fail(res, e); } });

  // ----- Services Catalog -----
  app.get   ('/api/catalog',           requireAuth, (req, res) => { try { ok(res, req.query.category ? catalog.listByCategory(req.query.category) : catalog.listAll()); } catch (e) { fail(res, e); } });
  app.post  ('/api/catalog',           requirePermission('manageCatalog'), (req, res) => { try { ok(res, catalog.add(req.body)); } catch (e) { fail(res, e); } });
  app.delete('/api/catalog/:id',       requirePermission('manageCatalog'), (req, res) => { try { ok(res, catalog.remove(req.params.id)); } catch (e) { fail(res, e); } });

  // ----- Invoices -----
  app.get('/api/invoices/fields',          requireAuth, (req, res) => { try { ok(res, invoices.availableFields()); } catch (e) { fail(res, e); } });
  app.get('/api/invoices/preview/:orderId', requireAuth, (req, res) => { try { ok(res, invoices.getOrderData(req.params.orderId)); } catch (e) { fail(res, e); } });

  // Client invoice data preview (LAN)
  app.get('/api/invoices/client/:clientId', requireAuth, (req, res) => {
    try {
      const data = invoices.getClientInvoiceData(req.params.clientId, req.query);
      ok(res, data);
    } catch (e) { fail(res, e); }
  });

  // ----- Pricing -----
  app.get ('/api/pricing/default',            requireAuth, (req, res) => { try { ok(res, pricing.getDefault()); } catch (e) { fail(res, e); } });
  app.get ('/api/pricing/client/:id',         requireAuth, (req, res) => { try { ok(res, pricing.getForClient(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.get ('/api/pricing/provider/:id',       requireAuth, (req, res) => { try { ok(res, pricing.getForProvider(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.post('/api/pricing/default',            requirePermission('managePricing'), (req, res) => { try { ok(res, pricing.saveDefault(req.body)); } catch (e) { fail(res, e); } });
  app.post('/api/pricing/client',             requirePermission('managePricing'), (req, res) => { try { ok(res, pricing.saveClientRate(req.body)); } catch (e) { fail(res, e); } });
  app.post('/api/pricing/provider',           requirePermission('managePricing'), (req, res) => { try { ok(res, pricing.saveProviderCost(req.body)); } catch (e) { fail(res, e); } });
  app.delete('/api/pricing/default/:id',      requirePermission('managePricing'), (req, res) => { try { ok(res, pricing.deleteDefault(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.delete('/api/pricing/client/:id',       requirePermission('managePricing'), (req, res) => { try { ok(res, pricing.deleteClientRate(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.delete('/api/pricing/provider/:id',     requirePermission('managePricing'), (req, res) => { try { ok(res, pricing.deleteProviderCost(Number(req.params.id))); } catch (e) { fail(res, e); } });
  app.post('/api/pricing/calculate',          requireAuth, (req, res) => { try { ok(res, pricing.calculate(req.body)); } catch (e) { fail(res, e); } });


  // Client invoice download (LAN/browser mode — streams Word or Excel)
  app.get('/api/invoices/generate-client', requireAuth, async (req, res) => {
    try {
      const { clientId, format, ...filters } = req.query;
      if (!clientId) return res.status(400).json({ error: 'clientId required' });
      const data = invoices.getClientInvoiceData(clientId, filters);
      if (!data.orders.length) return res.status(404).json({ error: 'No orders found' });
      const isWord = format === 'word';
      const ext    = isWord ? 'docx' : 'xlsx';
      const fname  = `Invoice_${data.client.code}_${data.invoice_date}.${ext}`;
      const tmpPath = path.join(os.tmpdir(), fname);
      if (isWord) {
        await invoices.generateWordInvoice(data, tmpPath);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      } else {
        await invoices.generateExcelInvoice(data, tmpPath);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      res.sendFile(tmpPath, (err) => {
        fs.unlink(tmpPath, () => {});
        if (err && !res.headersSent) fail(res, err);
      });
    } catch (e) { fail(res, e); }
  });

  // ----- Invoice fill (browser mode — receives base64 template, returns filled .docx) -----
  app.post('/api/invoices/generate', requireAuth, async (req, res) => {
    try {
      const { templateBase64, orderId } = req.body;
      if (!templateBase64 || !orderId) { return res.status(400).json({ error: 'templateBase64 and orderId required' }); }

      const PizZip        = require('pizzip');
      const Docxtemplater = require('docxtemplater');
      const data = invoices.getOrderData(orderId);

      const buf     = Buffer.from(templateBase64, 'base64');
      const zip     = new PizZip(buf);
      const doc     = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      doc.render(data);

      const out = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="Invoice_${orderId}.docx"`);
      res.send(out);
    } catch (e) { fail(res, e); }
  });

  // ----- Reports -----
  app.get ('/api/reports/run',      requireAuth, (req, res) => { try { ok(res, reports.runReport(req.query, req.session.user)); } catch (e) { fail(res, e); } });
  app.get ('/api/reports/summary',  requireAuth, (req, res) => { try { ok(res, reports.summary(req.query, req.session.user)); } catch (e) { fail(res, e); } });

  // Streaming Excel download (LAN users get a direct file)
  app.get('/api/reports/export', requirePermission('exportReports'), async (req, res) => {
    try {
      const { wb } = await reports.buildReportWorkbook(req.query, req.session.user);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="PMP_Report_${new Date().toISOString().slice(0,10)}.xlsx"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (e) { fail(res, e); }
  });

  // ----- System (intentionally unauthenticated — used for LAN discovery) -----
  // Exposes version + LAN IPs to any client on the network. This is by design:
  // browsers need to find the server before they can log in. Do not add sensitive data here.
  app.get('/api/sys/info', (req, res) => {
    const user = req.session && req.session.user || null;
    res.json({
      ok: true,
      data: {
        version: require('../../package.json').version,
        server: getLanAddresses(),
        port: _currentPort,
        authenticated: !!user
      }
    });
  });

  // LAN status (authenticated — browser-mode clients query their own connection info)
  app.get('/api/sys/lan-status', requireAuth, (req, res) => {
    res.json({
      ok: true,
      data: { running: true, port: _currentPort, addresses: getLanAddresses() }
    });
  });

  // Audit log (admin only)
  app.get('/api/sys/audit-log', requirePermission('manageSettings'), (req, res) => {
    try {
      const rows = db.get().prepare(`
        SELECT a.ts, a.action, a.entity, a.level, a.details, u.username
        FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC LIMIT 50
      `).all();
      ok(res, rows);
    } catch (e) { fail(res, e); }
  });

  // QR code for LAN access (admin only — generates PNG of first LAN URL)
  app.get('/api/sys/qrcode', requirePermission('manageSettings'), async (req, res) => {
    try {
      let addresses = getLanAddresses();
      // Sort: prioritize 192.168.x.x addresses as they are most common for home LANs
      addresses.sort((a, b) => {
        if (a.startsWith('192.168.') && !b.startsWith('192.168.')) return -1;
        if (!a.startsWith('192.168.') && b.startsWith('192.168.')) return 1;
        return 0;
      });

      const port = Number(req.query.port) || 3737;
      const url = addresses.length
        ? `http://${addresses[0]}:${port}`
        : `http://localhost:${port}`;
      const dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: 'M' });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const buf = Buffer.from(base64, 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', buf.length);
      res.send(buf);
    } catch (e) {
      console.error('[server] QR code generation failed:', e);
      res.status(500).json({ ok: false, error: 'QR generation failed' });
    }
  });

  // ----- Backups (manageSettings) — list + create. Restore is desktop-only
  // (it closes/reopens the DB, which is unsafe to do mid-request while serving). -----
  app.get ('/api/sys/backups',     requirePermission('manageSettings'), (req, res) => { try { ok(res, backup.list()); } catch (e) { fail(res, e); } });
  app.post('/api/sys/backups',     requirePermission('manageSettings'), async (req, res) => { try { ok(res, await backup.create()); } catch (e) { fail(res, e); } });

  // ================================================================
  // Static files + HTML routing (serves the SAME renderer/ folder)
  // ================================================================
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  app.use(express.static(rendererRoot, { index: false }));

  // Pretty URLs → the same HTML files used by Electron
  app.get('/',            (req, res) => res.redirect(req.session && req.session.user ? '/dashboard' : '/login'));
  app.get('/login',       (req, res) => res.sendFile(path.join(rendererRoot, 'login.html')));
  app.get('/dashboard',   requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'dashboard.html')));
  app.get('/orders/new',  requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'orders_new.html')));
  app.get('/orders/edit', requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'orders_edit.html')));
  app.get('/clients',     requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'clients.html')));
  app.get('/providers',   requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'providers.html')));
  app.get('/pricing',     requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'pricing.html')));
  app.get('/reports',     requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'reports.html')));
  app.get('/invoices',    requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'invoices.html')));
  app.get('/settings',    requireHtmlAuth, (req, res) => res.sendFile(path.join(rendererRoot, 'pages', 'settings.html')));

  // HTML-level auth gate: redirects to /login instead of sending 401 JSON
  function requireHtmlAuth(req, res, next) {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  }

  // Fallback for unknown routes
  app.use((req, res) => res.status(404).send('Not Found'));

  // Error handler
  app.use((err, req, res, next) => {
    console.error('[server] unhandled error on', req.method, req.path, '\n', err.stack || err);
    res.status(500).json({ ok: false, error: String(err && err.message || err) });
  });

  return app;
}

// ---------- Startup ----------
let httpServer = null;
let _currentPort = 3737;

// Optional HTTPS: if app_settings has https_cert + https_key pointing at readable
// PEM files, the LAN server runs over TLS and cookies become Secure. Otherwise it
// stays plain HTTP. ponytail: bring-your-own-cert; skip self-signed auto-gen until
// someone actually needs it (that pulls in a cert library for little gain on a LAN).
function _resolveTls() {
  const certPath = settingsSvc.get('https_cert');
  const keyPath  = settingsSvc.get('https_key');
  if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    } catch (e) {
      console.error('[server] HTTPS cert/key unreadable, falling back to HTTP:', e.message);
    }
  }
  return null;
}

function start({ host = '0.0.0.0', port = 3737 } = {}) {
  _currentPort = port;
  return new Promise((resolve, reject) => {
    if (httpServer) return resolve({ alreadyRunning: true, port });
    const tls = _resolveTls();
    _useHttps = !!tls;
    const app = createApp();
    const proto = _useHttps ? 'https' : 'http';
    // app.listen() returns an http.Server; capture it so stop() can close it.
    httpServer = (_useHttps ? https.createServer(tls, app) : app).listen(port, host, (err) => {
      if (err) return reject(err);
      console.log(`[server] listening on ${proto}://${host}:${port}`);
      console.log('[server] LAN addresses:');
      for (const addr of getLanAddresses()) console.log(`   ${proto}://${addr}:${port}`);
      resolve({ host, port, proto, lan: getLanAddresses() });
    });
    httpServer.on('error', reject);
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!httpServer) return resolve();
    httpServer.close(() => { httpServer = null; resolve(); });
  });
}

function isRunning() { return !!httpServer; }

function getLanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family !== 'IPv4' || i.internal) continue;

      // Filter out VirtualBox, VMware, and WSL "Virtual" IPs
      // These usually start with 192.168.56.x, 172.x.x.x, or 169.254.x.x
      if (i.address.startsWith('169.254')) continue;
      if (i.address.startsWith('192.168.56.')) continue;
      if (i.address.startsWith('172.')) continue;

      out.push(i.address);
    }
  }
  // Move common home network IPs (192.168.x.x or 10.x.x.x) to the front
  out.sort((a, b) => {
    if (a.startsWith('192.168.') || a.startsWith('10.')) return -1;
    return 1;
  });
  return out;
}

module.exports = { start, stop, isRunning, getLanAddresses };
