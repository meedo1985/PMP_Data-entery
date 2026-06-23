// database.js
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
let _db = null;

// Bump this whenever schema.sql, a migrate_*.sql, or an ad-hoc column-add below
// changes. The DB header stores the version it was last initialized at; if it
// matches, init() skips all the DDL/migration/healing work on the next launch.
const SCHEMA_VERSION = 7;

function init() {
  if (_db) return _db;
  const { db: dbPath, schema: schemaPath } = global.PMP_PATHS;

  _db = new Database(dbPath, {
    verbose: null,
    timeout: 5000 // Prevents "database is locked" errors
  });

  // Fast path: DB already at the current schema version → just set the
  // per-connection pragma and return, skipping the full init below.
  // ponytail: user_version gate. A version-matched DB also skips the self-healing
  // (corrupt-table rebuild, recovery renames); bump SCHEMA_VERSION to force a full run.
  _db.pragma("journal_mode = WAL");
  if (_db.pragma("user_version", { simple: true }) === SCHEMA_VERSION) {
    _db.pragma("foreign_keys = ON");
    return _db;
  }

  // FK enforcement is intentionally OFF for the entire init() run. Several migration
  // scripts temporarily enable it for their own integrity checks and then leave it ON.
  // We reassert OFF between each migration so they don't interfere with each other.
  // FK enforcement is turned back ON at the very end of init(), after all DDL is done.
  _db.pragma("foreign_keys = OFF");
  _db.pragma("journal_mode = WAL");

  // CRUCIAL: Drop the view and the hyphenated table immediately using double quotes.
  // Metadata can get 'stuck' if the view points to a table being renamed or dropped,
  // especially with hyphenated names.
  _db.exec("DROP VIEW IF EXISTS v_orders_full;");

  // Check for "zombie" references in the orders table DDL
  const ordersInfo = _db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get();
  if (ordersInfo && (ordersInfo.sql.includes('provider-old') || ordersInfo.sql.includes('providers_old'))) {
    console.warn("[DB] Broken metadata detected in orders table. Rebuilding...");
    try {
      _db.transaction(() => {
        _db.exec("ALTER TABLE orders RENAME TO orders_corrupt_backup;");
        // The base schema will be applied next, which creates a clean 'orders' table
      })();
    } catch (e) {
      console.error("[DB] Failed to rename corrupt orders table:", e.message);
    }
  }

  _db.exec('DROP TABLE IF EXISTS "provider-old";');

  // Recovery: handle failed renames from previous migrations
  const tableNames = _db.pragma("table_list").map(r => r.name);
  const hasBackup = tableNames.includes("orders_corrupt_backup");
  const hasNew    = tableNames.includes("providers_new");
  const hasMain   = tableNames.includes("providers");
  const hasOld    = tableNames.includes("providers_old") || tableNames.includes("provider-old");

  if (hasNew && !hasMain) {
    try { _db.exec("ALTER TABLE providers_new RENAME TO providers;"); }
    catch(e) { console.error("[DB] recovery rename failed:", e.message); }
  } else if (!hasMain && hasOld) {
    // If the main table is gone but an 'old' backup exists, restore it to prevent "no such table"
    const oldName = tableNames.includes("provider-old") ? '"provider-old"' : "providers_old";
    try { _db.exec(`ALTER TABLE ${oldName} RENAME TO providers;`); }
    catch(e) { console.error("[DB] recovery from old failed:", e.message); }
  } else if (hasNew) {
    _db.exec("DROP TABLE IF EXISTS providers_new;");
  }

  // Apply base schema (idempotent CREATE TABLE IF NOT EXISTS)
  const ddl = fs.readFileSync(schemaPath, "utf8");
  _db.exec(ddl);
  // Re-assert FK=OFF — schema.sql contains PRAGMA foreign_keys = ON which overrides us
  _db.pragma("foreign_keys = OFF");

  // If we renamed a corrupt orders table, restore the data now into the clean schema
  if (hasBackup) {
    try {
      console.log("[DB] Restoring data to clean orders table...");
      
      // List explicit columns to avoid "column count mismatch" if the backup has old columns
      const cols = [
        "id", "order_date", "client_id", "service", "category", "wo_client", 
        "wo_internal", "place", "start_time", "end_time", "duration_minutes", 
        "bandwidth_mhz", "provider_id", "space_provider_id", "reporter", 
        "rate", "revenue", "cost", "currency", "invoice_no", 
        "payment_status", "notes", "created_by", "created_at"
      ];
      
      // Filter columns that actually exist in the backup table
      const backupCols = _db.pragma(`table_info(orders_corrupt_backup)`).map(c => c.name);
      const validCols = cols.filter(c => backupCols.includes(c));
      const colList = validCols.join(", ");

      _db.exec(`INSERT OR IGNORE INTO orders (${colList}) SELECT ${colList} FROM orders_corrupt_backup;`);
      _db.exec("DROP TABLE orders_corrupt_backup;");
      console.log("[DB] Orders table successfully healed.");
    } catch (e) {
      console.error("[DB] Data restoration failed. Manual intervention may be required:", e.message);
      // Note: the backup table still exists if this fails
    }
  }

  // Migration tracking table
  _db.exec("CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");

  // Run each migration exactly once
  const schemaDir = path.dirname(global.PMP_PATHS.schema);
  const migrations = ["migrate_v2.sql","migrate_v3.sql","migrate_v4.sql","migrate_v5.sql","migrate_v6.sql"];
  for (const f of migrations) {
    try {
      const already = _db.prepare("SELECT 1 FROM migrations_applied WHERE name=?").get(f);
      if (already) continue;
      const p = path.join(schemaDir, f);
      if (!fs.existsSync(p)) continue;

      // migrate_v4 drops collection_provider_id — skip cleanly if column is already gone
      if (f === "migrate_v4.sql") {
        const cols = _db.pragma("table_info(orders)").map(c => c.name);
        if (!cols.includes("collection_provider_id")) {
          _db.prepare("INSERT OR IGNORE INTO migrations_applied (name) VALUES (?)").run(f);
          console.log("[DB] migration skipped (already done):", f);
          continue;
        }
      }

      _db.exec(fs.readFileSync(p, "utf8"));
      _db.prepare("INSERT OR IGNORE INTO migrations_applied (name) VALUES (?)").run(f);
      console.log("[DB] migration applied:", f);
    } catch(e) {
      console.error("[DB] migration " + f + " failed:", e.message);
    }
    // Always reassert FK=OFF between migrations — some migration files set it ON
    _db.pragma("foreign_keys = OFF");
  }

  // Ensure users.permissions column exists (present in schema but missing in older DBs)
  const userCols = _db.pragma("table_info(users)").map(c => c.name);
  if (!userCols.includes("permissions")) {
    _db.exec("ALTER TABLE users ADD COLUMN permissions TEXT");
    console.log("[DB] Added users.permissions column");
  }

  // Ensure orders.use_special and orders.special_price columns exist
  const orderCols = _db.pragma("table_info(orders)").map(c => c.name);
  if (!orderCols.includes("use_special")) {
    _db.exec("ALTER TABLE orders ADD COLUMN use_special INTEGER NOT NULL DEFAULT 0");
    console.log("[DB] Added orders.use_special column");
  }
  if (!orderCols.includes("special_price")) {
    _db.exec("ALTER TABLE orders ADD COLUMN special_price REAL");
    console.log("[DB] Added orders.special_price column");
  }
  if (!orderCols.includes("place_ar")) {
    _db.exec("ALTER TABLE orders ADD COLUMN place_ar TEXT");
    console.log("[DB] Added orders.place_ar column");
  }
  if (!orderCols.includes("duration_seconds")) {
    _db.exec("ALTER TABLE orders ADD COLUMN duration_seconds INTEGER");
    console.log("[DB] Added orders.duration_seconds column");
  }

  // Drop leftover temp tables (using double quotes for hyphenated names)
  for (const t of ["providers_old","providers_v3","providers_backup","provider-old","providers_new"]) {
    _db.exec(`DROP TABLE IF EXISTS "${t}";`);
  }
  _db.exec("DROP VIEW IF EXISTS v_orders_full;");

  // NOTE: pricing_* and providers tables are defined in schema.sql (applied above
  // as idempotent CREATE TABLE IF NOT EXISTS) and no migration drops them, so the
  // duplicate DDL that used to live here was removed. The view below is the only
  // object that must be recreated, because migrate_v3 drops it during its rebuild.

  // Always recreate the view after migrations — migrate_v3 drops it as part of the
  // table-rename workaround, so we must restore it here unconditionally.
  // PERFORMANCE: use LEFT JOIN with derived table instead of per-row correlated subqueries.
  _db.exec("DROP VIEW IF EXISTS v_orders_full;");
  _db.exec(
    "CREATE VIEW v_orders_full AS" +
    " SELECT o.*, c.name AS client_name, c.code AS client_code," +
    "  c.group_name AS client_group, p.name AS provider_name," +
    "  sp.name AS space_provider_name," +
    "  (o.revenue - o.cost) AS profit," +
    "  COALESCE(pay.total_paid, 0) AS paid_amount," +
    "  (o.revenue - COALESCE(pay.total_paid, 0)) AS due_amount" +
    " FROM orders o" +
    " LEFT JOIN clients   c  ON c.id  = o.client_id" +
    " LEFT JOIN providers p  ON p.id  = o.provider_id" +
    " LEFT JOIN providers sp ON sp.id = o.space_provider_id" +
    " LEFT JOIN (SELECT order_id, SUM(amount) AS total_paid FROM payments GROUP BY order_id) pay ON pay.order_id = o.id;"
  );
  console.log("[DB] v_orders_full view refreshed (optimized).");

  _db.pragma("foreign_keys = ON");
  
  const finalCount = _db.prepare("SELECT COUNT(*) AS c FROM orders").get().c;
  const viewCount = _db.prepare("SELECT COUNT(*) AS c FROM v_orders_full").get().c;
  console.log(`[DB] Startup complete. Total records found in 'orders' table: ${finalCount}, 'v_orders_full' view: ${viewCount}`);

  // Stamp the version so the next launch can take the fast path above.
  _db.pragma(`user_version = ${SCHEMA_VERSION}`);

  return _db;
}

function get() { if (!_db) throw new Error("DB_NOT_INITIALIZED"); return _db; }
function close() { if (_db) { try { _db.close(); } catch(_) {} _db = null; } }
function tx(fn) { return get().transaction(fn); }
module.exports = { init, get, close, tx };
