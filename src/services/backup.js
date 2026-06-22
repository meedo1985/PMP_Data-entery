// ================================================================
// backup.js — pmp.db backup / restore.
// Uses better-sqlite3's native online backup (consistent, no app downtime).
// Backups live in <dataDir>/backups/pmp-YYYY-MM-DD-HH-MM-SS.db
// ================================================================
const fs = require('fs');
const path = require('path');
const db = require('../db/database');

const KEEP = 30;

function backupDir() {
  const dir = path.join(path.dirname(global.PMP_PATHS.db), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _files() {
  return fs.readdirSync(backupDir())
    .filter(f => f.startsWith('pmp-') && f.endsWith('.db'))
    .sort(); // lexicographic == chronological (ISO-ish timestamp)
}

async function create(reason = 'manual') {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dest = path.join(backupDir(), `pmp-${ts}.db`);
  await db.get().backup(dest);
  prune();
  return { ok: true, path: dest, name: path.basename(dest), reason };
}

function prune(keep = KEEP) {
  const files = _files();
  while (files.length > keep) {
    try { fs.unlinkSync(path.join(backupDir(), files.shift())); } catch (_) {}
  }
}

function list() {
  return _files().reverse().map(name => {
    const s = fs.statSync(path.join(backupDir(), name));
    return { name, size: s.size, mtime: s.mtime.toISOString() };
  });
}

// Make today's backup if one doesn't already exist. Called at startup and on a
// 12h timer. ponytail: startup + interval check, not a real cron — fine for a
// desktop app opened most days; add a scheduler only if it must run unattended.
async function dailyIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (_files().some(f => f.startsWith('pmp-' + today))) return { ok: true, skipped: true };
  return create('daily');
}

function restore(name) {
  const src = path.join(backupDir(), path.basename(name)); // basename blocks traversal
  if (!fs.existsSync(src)) throw new Error('BACKUP_NOT_FOUND');
  const dbPath = global.PMP_PATHS.db;

  // Snapshot the current DB first so a bad restore is itself recoverable.
  return create('pre-restore').then(() => {
    db.close();
    fs.copyFileSync(src, dbPath);
    // Drop the live WAL/SHM so the copied file is authoritative, not stale WAL.
    for (const ext of ['-wal', '-shm']) {
      try { fs.unlinkSync(dbPath + ext); } catch (_) {}
    }
    db.init();
    return { ok: true };
  });
}

module.exports = { create, list, restore, dailyIfNeeded, prune, backupDir };
