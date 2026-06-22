// ================================================================
// reset-admin-electron.js
// Run this with Electron (not plain Node) to avoid native module issues:
//
//   npx electron reset-admin-electron.js
//
// ================================================================

const { app } = require('electron');
const path    = require('path');
const fs      = require('fs');

app.whenReady().then(() => {
  try {
    const __appDir  = path.join(__dirname);
    const userdata  = path.join(__appDir, 'userdata');
    const dbPath    = fs.existsSync(userdata)
      ? path.join(userdata, 'pmp.db')
      : path.join(app.getPath('userData'), 'pmp.db');

    console.log('\nLooking for database at:', dbPath);

    if (!fs.existsSync(dbPath)) {
      console.error('\n❌ Database not found at:', dbPath);
      console.log('Run the app first so the database gets created, then try again.');
      app.quit();
      return;
    }

    // Set the global paths so services can load
    global.PMP_PATHS = {
      db:     dbPath,
      schema: path.join(__appDir, 'src', 'db', 'schema.sql'),
      isDev:  true
    };

    const db    = require('./src/db/database');
    const bcrypt = require('bcryptjs');

    db.init();
    const database  = db.get();
    const NEW_PASS  = 'admin123';
    const hash      = bcrypt.hashSync(NEW_PASS, 10);

    const existing = database
      .prepare("SELECT id FROM users WHERE username = 'admin' COLLATE NOCASE")
      .get();

    if (existing) {
      database.prepare(`
        UPDATE users
        SET password_hash = ?, active = 1, must_change_pwd = 0
        WHERE username = 'admin' COLLATE NOCASE
      `).run(hash);
      console.log('\n✅ Admin password reset!');
    } else {
      database.prepare(`
        INSERT INTO users (username, password_hash, full_name, role, active, must_change_pwd)
        VALUES ('admin', ?, 'Administrator', 'admin', 1, 0)
      `).run(hash);
      console.log('\n✅ Admin account created!');
    }

    db.close();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Username : admin');
    console.log('  Password : admin123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nRestart the app and log in.\n');

  } catch (err) {
    console.error('\n❌ Error:', err.message || err);
    console.error(err.stack);
  }

  app.quit();
});
