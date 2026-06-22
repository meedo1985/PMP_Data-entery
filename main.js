// ================================================================
// ================================================================
// main.js — Electron main process
// ================================================================

// Self-healing: if a parent process set ELECTRON_RUN_AS_NODE,
// relaunch without it so Electron APIs (app, BrowserWindow) work.
const relaunchCount = Number(process.env._PMP_RELAUNCH_COUNT || 0);
if (process.env.ELECTRON_RUN_AS_NODE && relaunchCount < 2) {
  console.log(`[main] ELECTRON_RUN_AS_NODE detected — relaunching in app mode (attempt ${relaunchCount + 1})...`);
  const { spawn } = require('child_process');
  const env = { ...process.env, _PMP_RELAUNCH_COUNT: String(relaunchCount + 1) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env,
    windowsHide: false
  });
  child.on('close', code => process.exit(code === null ? 1 : code));
  return;
}

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const isMigrateCmd    = process.argv.includes('--migrate');
const isResetAdminCmd = process.argv.includes('--reset-admin');
// Detect dev via the Electron-official way (works regardless of how we launched)
const isDev = process.argv.includes('--dev') || (app && typeof app.isPackaged === 'boolean' ? !app.isPackaged : true);

// ---------- Paths ----------
// Priority: portable mode (PORTABLE_EXECUTABLE_DIR set by electron-builder) → dev → %APPDATA%
// PORTABLE_EXECUTABLE_DIR is the folder containing the portable .exe, so data stays next to it.
const userDataDir = isDev
  ? path.join(__dirname, 'userdata')
  : process.env.PORTABLE_EXECUTABLE_DIR
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'PMP-Data')
    : app.getPath('userData');

if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

const dbPath = path.join(userDataDir, 'pmp.db');

function resolveSchemaPath() {
  const candidates = [
    path.join(__dirname, 'src', 'db', 'schema.sql'),
    path.join(process.resourcesPath, 'schema.sql'),
    path.join(process.resourcesPath || '', 'app', 'src', 'db', 'schema.sql'),
    path.join(process.resourcesPath || '', 'app.asar', 'src', 'db', 'schema.sql')
  ].filter(p => p);
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  // Last-resort: return the dev path and let the error message be clear
  return candidates[0];
}

// Expose paths to services via globals so preload/services can read them
global.PMP_PATHS = {
  userData: userDataDir,
  db: dbPath,
  schema: resolveSchemaPath(),
  isDev
};

console.log('[main] isDev =', isDev);
console.log('[main] userDataDir =', userDataDir);
console.log('[main] schema =', global.PMP_PATHS.schema);

// ---------- DB & Services (loaded after paths set) ----------
const db = require('./src/db/database');
const users = require('./src/services/users');
const migrate = require('./src/db/migrate-from-excel');
const server = require('./src/server/server');
const ipcRegistry = require('./src/main/ipc/index'); // Ensure this directory exists

// ---------- Session state ----------
const session = { currentUser: null };

// ---------- Window management ----------
let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox:false is required because the preload script loads better-sqlite3
      // (a native Node module). Electron's OS sandbox blocks native module loading.
      sandbox: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'login.html'));

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ---------- App lifecycle ----------
app.whenReady().then(async () => {
  try {
    // Set App User Model ID for Windows Taskbar icons to display correctly
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.pmp.datasheet');
    }

    db.init();

    // One-shot CLI: reset/create the admin account, then exit without opening a window.
    if (isResetAdminCmd) {
      const r = users.resetAdmin();
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  Admin account ${r.created ? 'created' : 'password reset'}.`);
      console.log('  Username : admin');
      console.log('  Password : ' + r.password);
      console.log('  (You must change this password on next login.)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      db.close();
      app.quit();
      return;
    }

    users.ensureDefaultAdmin();

    if (isMigrateCmd) {
      console.log('Running migration from Excel...');
      const result = await migrate.runInteractive();
      console.log('Migration result:', result);
    }

    // Start LAN server (if enabled in app_settings)
    await startLanServerIfEnabled();

    // Initialize IPC Handlers
    ipcRegistry.init(ipcMain, session, () => mainWindow);

    createMainWindow();
  } catch (err) {
    dialog.showErrorBox('Startup error', String(err && err.stack || err));
    app.quit();
  }
});

async function startLanServerIfEnabled() {
  const database = db.get();
  // Defaults: enabled=1, port=3737
  const getSetting = (k, d) => {
    const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(k);
    return row ? row.value : d;
  };
  const setSetting = (k, v) => database.prepare(
    'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)'
  ).run(k, String(v));

  if (getSetting('lan_enabled') === null) setSetting('lan_enabled', '1');
  if (getSetting('lan_port')    === null) setSetting('lan_port',    '3737');

  const enabled = getSetting('lan_enabled', '1') === '1';
  const port    = Number(getSetting('lan_port', '3737')) || 3737;

  if (!enabled) {
    console.log('[main] LAN server disabled (app_settings.lan_enabled = 0)');
    return;
  }
  try {
    const info = await server.start({ host: '0.0.0.0', port });
    global.PMP_SERVER = info;
  } catch (err) {
    console.error('[main] Failed to start LAN server:', err.message);
    dialog.showMessageBox({
      type: 'warning',
      title: 'LAN server failed',
      message: `Could not start the LAN server on port ${port}.\n\n${err.message}\n\nThe desktop app will still work locally.`
    });
  }
}

app.on('window-all-closed', async () => {
  await server.stop().catch(() => {});
  db.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  } else if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
});
