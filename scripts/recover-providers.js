// recover-providers.js — run with: npx electron recover-providers.js
// Checks DB state and tries to restore providers data

const { app } = require('electron');
const path = require('path');
const fs   = require('fs');

app.whenReady().then(() => {
  try {
    const dbPath = path.join(__dirname, 'userdata', 'pmp.db');
    console.log('\n=== PROVIDER RECOVERY ===');
    console.log('DB:', dbPath);

    if (!fs.existsSync(dbPath)) {
      console.log('❌ DB not found');
      app.quit(); return;
    }

    const Database = require('better-sqlite3');
    const db = new Database(dbPath);

    // Check all tables
    const tables = db.pragma('table_list').map(t => t.name);
    console.log('\nTables:', tables.join(', '));

    // Check providers
    const hasProviders   = tables.includes('providers');
    const hasProvidersV3 = tables.includes('providers_v3');

    if (hasProviders) {
      const rows = db.prepare('SELECT * FROM providers').all();
      console.log('\nProviders table: ' + rows.length + ' rows');
      rows.forEach(r => console.log(' -', r.id, r.name, r.type, r.active ? 'active' : 'deleted'));
    } else {
      console.log('\n❌ No providers table!');
    }

    if (hasProvidersV3) {
      const rows = db.prepare('SELECT * FROM providers_v3').all();
      console.log('\nProviders_v3 table: ' + rows.length + ' rows');
      rows.forEach(r => console.log(' -', r.id, r.name, r.type));
    }

    // Check WAL file for residual data
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    console.log('\nWAL file exists:', fs.existsSync(walPath));
    console.log('SHM file exists:', fs.existsSync(shmPath));

    db.close();
    console.log('\n=== DONE ===\n');

  } catch (err) {
    console.error('ERROR:', err.message);
  }
  app.quit();
});
