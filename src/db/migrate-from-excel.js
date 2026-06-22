// ================================================================
// migrate-from-excel.js  (v3 — handles the new Excel schema)
//
// Sheets it reads:
//   Clients       (authoritative — Name, Code, LastWO, Group)
//   Providers     (authoritative — Provider, Place, Type, Notes)
//   Settings      (legacy — used only for places / payment statuses)
//   ServiceCat    (Category, Service → builds service→category map)
//   Services      (the actual orders)
//   Users         (usernames + roles)
//   Pricing       (category, type, label, price)
//   ClientRates   (client-specific pricing)
//   ProviderCosts (provider cost rates)
//
// All insertions are idempotent (INSERT OR IGNORE / ON CONFLICT)
// so re-running the migration won't duplicate.
// ================================================================
const ExcelJS = require('exceljs');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const db      = require('./database');
const clientsSvc = require('../services/clients');
const locationsSvc = require('../services/locations');

// ---------------- Cell helpers ----------------
function cellValue(row, colNum) {
  const c = row.getCell(colNum);
  if (!c || c.value == null) return null;
  const v = c.value;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (v.text)                 return v.text;
    if (v.result !== undefined) return v.result;
    if (v.richText)             return v.richText.map(r => r.text).join('');
  }
  return v;
}

function clean(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  if (!s || s === '-' || s === '—' || s === 'N/A' || s.toLowerCase() === 'na') return null;
  return s;
}

function toISODate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'string') {
    let m = v.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
    m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  }
  if (typeof v === 'number' && v > 1 && v < 100000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + v * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function toHHMM(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    return String(v.getUTCHours()).padStart(2,'0') + ':' + String(v.getUTCMinutes()).padStart(2,'0');
  }
  if (typeof v === 'object' && v !== null && 'hour' in v) {
    return String(v.hour).padStart(2,'0') + ':' + String(v.minute || 0).padStart(2,'0');
  }
  if (typeof v === 'number') {
    const frac = (v >= 0 && v < 1) ? v : (v - Math.floor(v));
    const total = Math.round(frac * 24 * 60);
    return String(Math.floor(total / 60)).padStart(2,'0') + ':' + String(total % 60).padStart(2,'0');
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{1,2}):(\d{2})/);
    if (m) return m[1].padStart(2,'0') + ':' + m[2];
  }
  return null;
}

// Normalize a ServiceCat category label to our 4-value category enum
function normalizeCategory(raw) {
  const s = String(raw || '').toLowerCase().trim();
  if (!s) return null;
  if (s.startsWith('live'))    return 'live';
  if (s.startsWith('package')) return 'package';
  if (s.startsWith('space'))   return 'space';
  if (s.startsWith('crew'))    return 'crew';
  return null;
}

// Fallback heuristic — used only if ServiceCat has no mapping
function guessCategoryFallback(service) {
  const s = String(service || '').toLowerCase();
  if (!s) return null;
  if (s.includes('package'))                             return 'package';
  if (s.includes('crew'))                                return 'crew';
  if (s.includes('sng truck') || s.includes('space') ||
      s.includes('mhz'))                                 return 'space';
  if (s.includes('live') || s.includes('tvu') ||
      s.includes('studio') || s.includes('as live') ||
      s.includes('interview') || s.includes('stand up')) return 'live';
  if (s.includes('payment') || s.includes('guest'))      return 'package';
  if (s.includes('report') || s.includes('rushes') ||
      s.includes('vox'))                                 return 'package';
  return null;
}

function autoClientCode(name, used) {
  let base = String(name).split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!base) base = 'CLI';
  base = base.substring(0, Math.min(5, base.length));
  let code = base; let i = 1;
  while (used.has(code)) code = base + i++;
  used.add(code);
  return code;
}

function calcDurationMinutes(start, end) {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // crosses midnight
  return mins > 0 ? mins : null;
}

// Parses a raw Excel cell value from a "dur" (duration) column into minutes.
// Handles: Excel time fractions (0.0625 = 90 min), Date objects, plain integers,
// and "HH:MM" strings. Returns null when the cell is empty/zero.
function parseDurationMinutes(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const total = v.getUTCHours() * 60 + v.getUTCMinutes();
    return total > 0 ? total : null;
  }
  if (typeof v === 'number') {
    if (v <= 0) return null;
    // Excel time fraction stored as decimal between 0 and 1
    if (v < 1) return Math.round(v * 24 * 60);
    // Plain number — treat directly as minutes
    return Math.round(v);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s || s === '-') return null;

    // "2:37 Min" / "2:37min" — MM:SS with explicit "min" unit label.
    // The colon separates minutes from seconds, not hours from minutes.
    const mmss = s.match(/^(\d+):(\d{2})\s*min/i);
    if (mmss) {
      const secs = Number(mmss[1]) * 60 + Number(mmss[2]);
      return Math.max(1, Math.round(secs / 60));
    }

    // Plain "H:MM" or "HH:MM" string with no unit — treat as hours:minutes
    const hm = s.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2]);

    const n = parseFloat(s);
    if (!isNaN(n) && n > 0) return n < 1 ? Math.round(n * 24 * 60) : Math.round(n);
  }
  return null;
}

function normalizeRole(r) {
  const v = String(r || '').toLowerCase();
  if (v.includes('admin'))      return 'admin';
  if (v.includes('manager'))    return 'manager';
  if (v.includes('coord'))      return 'coordination';
  if (v.includes('account'))    return 'accountant';    // new role
  return 'user';
}

// ================================================================
// MAIN
// ================================================================
async function getPreview(xlsxPath) {
  const report = {
    source: xlsxPath,
    startedAt: new Date().toISOString(),
    counts: {
      clients: 0, providers: 0, places: 0, services_lookup: 0,
      service_categories: 0, payment_statuses: 0, currencies: 0,
      pricing_default: 0, pricing_client: 0, pricing_provider: 0,
      users: 0, orders: 0, orders_skipped: 0
    },
    warnings: [],
    errors: [],
    parsedData: { 
      clients: [], 
      providers: [], 
      orders: [], 
      lookups: { places: [], services: [], statuses: [], currencies: [] } 
    }
  };

  const database = db.get();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);

  // ----------------------------------------------------------------
  // 1. CLIENTS — from the dedicated `Clients` sheet (authoritative)
  //    Fallback: Settings!G/H/I if sheet missing (old file support)
  // ----------------------------------------------------------------
  const clientsMap = new Map();  // key=lowercased name → { name, code?, last_wo?, group? }
  const wsClients = wb.getWorksheet('Clients');
  if (wsClients && wsClients.rowCount > 1) {
    for (let r = 2; r <= wsClients.rowCount; r++) {
      const row = wsClients.getRow(r);
      const name    = clean(cellValue(row, 1));
      const code    = clean(cellValue(row, 2));
      const lastWO  = cellValue(row, 3);
      const group   = clean(cellValue(row, 4));
      if (!name) continue;
      clientsMap.set(name.toLowerCase(), {
        name,
        code: code ? String(code).toUpperCase() : null,
        last_wo: (lastWO != null && !isNaN(Number(lastWO))) ? Number(lastWO) : 0,
        group: group || null
      });
    }
    report.warnings.push(`Using dedicated Clients sheet (${clientsMap.size} clients)`);
  } else {
    // Fallback to legacy Settings layout
    const wsSettings = wb.getWorksheet('Settings');
    if (wsSettings) {
      for (let r = 2; r <= wsSettings.rowCount; r++) {
        const row = wsSettings.getRow(r);
        const cG = clean(cellValue(row, 7));
        const cH = clean(cellValue(row, 8));
        const cI = cellValue(row, 9);
        if (cG) {
          clientsMap.set(cG.toLowerCase(), {
            name: cG,
            code: cH ? String(cH).toUpperCase() : null,
            last_wo: (cI != null && !isNaN(Number(cI))) ? Number(cI) : 0,
            group: null
          });
        }
      }
      report.warnings.push(`No "Clients" sheet — fell back to Settings!G:I`);
    }
  }

  // ----------------------------------------------------------------
  // 2. PROVIDERS — from dedicated `Providers` sheet
  //    Fallback: Settings!C + Settings!D if sheet missing
  // ----------------------------------------------------------------
  // key=lowercased name → { name, place?, type?, notes? }
  const providersMap = new Map();
  const wsProv = wb.getWorksheet('Providers');
  if (wsProv && wsProv.rowCount > 1) {
    for (let r = 2; r <= wsProv.rowCount; r++) {
      const row = wsProv.getRow(r);
      const name  = clean(cellValue(row, 1));
      const place = clean(cellValue(row, 2));
      const type  = clean(cellValue(row, 3));
      const notes = clean(cellValue(row, 4));
      if (!name) continue;
      const k = name.toLowerCase();
      // De-duplicate (some files list same provider twice, e.g. WhiteClicks)
      const existing = providersMap.get(k);
      if (existing) {
        // Merge: keep non-null fields, prefer 'space' over 'provider' for type
        if (!existing.place && place) existing.place = place;
        if (type && type.toLowerCase() === 'space') existing.type = 'space';
        if (!existing.notes && notes) existing.notes = notes;
        report.warnings.push(`Provider "${name}" appears multiple times in Providers — merged`);
      } else {
        providersMap.set(k, { name, place, type: normalizeProviderType(type), notes });
      }
    }
  }

  // ----------------------------------------------------------------
  // 3. SERVICE CATEGORIES — build service→category map
  // ----------------------------------------------------------------
  const serviceCatMap = new Map();   // lowercased service → 'live'|'space'|'crew'|'package'
  const servicesSet = new Set();
  const wsSC = wb.getWorksheet('ServiceCat');
  if (wsSC && wsSC.rowCount > 1) {
    for (let r = 2; r <= wsSC.rowCount; r++) {
      const row = wsSC.getRow(r);
      const cat = normalizeCategory(cellValue(row, 1));
      const svc = clean(cellValue(row, 2));
      if (!svc) continue;
      servicesSet.add(svc);
      if (cat) {
        serviceCatMap.set(svc.toLowerCase(), cat);
        report.counts.service_categories++;
      }
    }
  }

  // ----------------------------------------------------------------
  // 4. LOOKUPS — places + payment statuses from Settings
  //    (plus currencies collected from Services)
  // ----------------------------------------------------------------
  const places     = new Set();
  const statuses   = new Set();
  const currencies = new Set();
  const wsSettings = wb.getWorksheet('Settings');
  if (wsSettings) {
    for (let r = 2; r <= wsSettings.rowCount; r++) {
      const row = wsSettings.getRow(r);
      const p = clean(cellValue(row, 5)); if (p) places.add(p);
      const s = clean(cellValue(row, 6)); if (s) statuses.add(s);
      // Column B in Settings may also hold services in some older files
      const b = clean(cellValue(row, 2)); if (b) servicesSet.add(b);
    }
  }

  // ----------------------------------------------------------------
  // 5. IDENTIFY ORDER SHEETS & PROCESS REFERENCES
  //    then insert after clients/providers exist
  // ----------------------------------------------------------------
  const metadataSheetNames = ['Clients', 'Providers', 'Settings', 'ServiceCat', 'Users', 'Pricing', 'ClientRates', 'ProviderCosts'];
  const orderSheets = wb.worksheets.filter(ws => !metadataSheetNames.includes(ws.name) && ws.rowCount > 1);

  function resolveClient(raw) {
    if (!raw) return null;
    const k = raw.toLowerCase();
    if (clientsMap.has(k)) return clientsMap.get(k);
    const rawUpper = raw.toUpperCase();
    for (const c of clientsMap.values()) {
      if (c.code && c.code.toUpperCase() === rawUpper) return c;
    }
    return null;
  }

  // First pass: loop through ALL order sheets (Month/Year sheets)
  for (const ws of orderSheets) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cli = clean(cellValue(row, 2));  // Column 2: Client
      const svc = clean(cellValue(row, 3));  // Column 3: Service
      const pl  = clean(cellValue(row, 4));  // Column 4: Location
      const pv  = clean(cellValue(row, 8));  // Column 8: Provider
      const sp  = clean(cellValue(row, 10)); // Column 10: Space Provider

      if (cli) {
        // First try to match by name or code
        const resolved = resolveClient(cli);
        if (!resolved) {
          // Genuinely new client
          clientsMap.set(cli.toLowerCase(), { name: cli, code: null, last_wo: 0, group: null });
          report.warnings.push(`Client "${cli}" (Services row ${r}) not in Clients sheet — will be added`);
        } else if (resolved.name.toLowerCase() !== cli.toLowerCase()) {
          // An alias exists: e.g. "AJE" in Services → "Al Jazeera International" in Clients
          report.warnings.push(`Services row ${r}: "${cli}" resolved to "${resolved.name}" (via code)`);
        }
      }
      if (svc) servicesSet.add(svc);
      if (pl)  places.add(pl);
      if (pv && !providersMap.has(pv.toLowerCase())) {
        providersMap.set(pv.toLowerCase(), { name: pv, place: null, type: 'location', notes: null });
        report.warnings.push(`Provider "${pv}" (Services row ${r}) not in Providers sheet — will be added`);
      }
      if (sp && !providersMap.has(sp.toLowerCase())) {
        providersMap.set(sp.toLowerCase(), { name: sp, place: null, type: 'space', notes: null });
        report.warnings.push(`Space provider "${sp}" (Services row ${r}) not in Providers sheet — will be added`);
      }
    }
  }

  // Auto-generate client codes for any still missing
  const usedCodes = new Set();
  for (const c of clientsMap.values()) if (c.code) usedCodes.add(c.code);
  for (const c of clientsMap.values()) {
    if (!c.code) {
      c.code = autoClientCode(c.name, usedCodes);
      c.autoCode = true;
    }
  }

  // Collect Preview Data instead of inserting
  report.parsedData.clients = Array.from(clientsMap.values());
  report.parsedData.providers = Array.from(providersMap.values());
  report.parsedData.lookups = {
    places: Array.from(places),
    services: Array.from(servicesSet),
    statuses: Array.from(statuses),
    currencies: Array.from(currencies)
  };

  // ----------------------------------------------------------------
  // 11. ORDERS
  // ----------------------------------------------------------------
  for (const ws of orderSheets) {
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rawClient = clean(cellValue(row, 2)); 
      if (!rawClient) continue;

      let date = toISODate(cellValue(row, 1)); 
      if (!date) date = new Date().toISOString().slice(0, 10);

      const service     = clean(cellValue(row, 3)); 
      const place       = clean(cellValue(row, 4)); 
      const start       = toHHMM(cellValue(row, 5)); 
      const end         = toHHMM(cellValue(row, 6)); 
      let duration      = parseDurationMinutes(cellValue(row, 7));
      const prov        = clean(cellValue(row, 8));
      const reporter    = clean(cellValue(row, 9));
      const sprov       = clean(cellValue(row, 10));
      const notes       = clean(cellValue(row, 13));

      // dur column is authoritative. Only calculate from start/end when dur is absent.
      if (!duration && start && end) {
        duration = calcDurationMinutes(start, end);
      }

      let category = null;
      if (service) {
        category = serviceCatMap.get(service.toLowerCase()) || guessCategoryFallback(service);
      }

      report.parsedData.orders.push({
        sheet: ws.name, date, client: rawClient, service, category, place, start, end, duration, prov, reporter, sprov, notes
      });
    }
  }

  report.counts.orders = report.parsedData.orders.length;

  // ----------------------------------------------------------------
  // 12. DUPLICATE DETECTION — check which parsed orders already exist
  //     in the DB (match: order_date + client_id + service + start_time)
  // ----------------------------------------------------------------
  try {
    const existingCliMap = new Map();
    database.prepare('SELECT id, name, code FROM clients').all().forEach(c => {
      existingCliMap.set(c.name.toLowerCase(), c.id);
      if (c.code) existingCliMap.set(c.code.toLowerCase(), c.id);
    });
    const dupCheck = database.prepare(
      'SELECT id FROM orders WHERE order_date=? AND client_id=? AND service IS ? AND start_time IS ? LIMIT 1'
    );
    let dupCount = 0;
    for (const o of report.parsedData.orders) {
      const cid = existingCliMap.get(o.client.toLowerCase());
      if (!cid) continue;
      const found = dupCheck.get(o.date, cid, o.service || null, o.start || null);
      if (found) { o._existingId = found.id; dupCount++; }
    }
    report.counts.orders_duplicate = dupCount;
  } catch (e) {
    report.warnings.push('Duplicate check skipped: ' + e.message);
    report.counts.orders_duplicate = 0;
  }

  return { ok: true, report };
}

async function commitImport(parsedData, user) {
  const database = db.get();
  const report = { clients: 0, providers: 0, locations: 0, orders: 0, orders_skipped: 0, errors: [] };
  const overwrite = !!parsedData._overwrite;

  // Ensure provider_locations table exists before the transaction
  locationsSvc.listForProvider(0); // triggers ensureTable() inside the service

  database.transaction(() => {
    // 0. Save Lookups (Places, Services)
    const insLook = database.prepare(`INSERT OR IGNORE INTO lookups (kind, value) VALUES (?, ?)`);
    if (parsedData.lookups) {
      parsedData.lookups.places.forEach(v => insLook.run('place', v));
      parsedData.lookups.services.forEach(v => insLook.run('service', v));
      parsedData.lookups.statuses.forEach(v => insLook.run('payment_status', v));
      parsedData.lookups.currencies.forEach(v => insLook.run('currency', v));
    }

    // 1. Clients
    const insCli = database.prepare(`
      INSERT INTO clients (name, code, last_wo) 
      VALUES (?, ?, ?) 
      ON CONFLICT(name) DO UPDATE SET 
        last_wo = MAX(clients.last_wo, excluded.last_wo)
    `);
    parsedData.clients.forEach(c => { insCli.run(c.name, c.code, c.last_wo || 0); report.clients++; });

    // 2. Providers
    const insProv = database.prepare(`INSERT INTO providers (name, type) VALUES (?, ?) ON CONFLICT(name, type) DO NOTHING`);
    parsedData.providers.forEach(p => { insProv.run(p.name, p.type); report.providers++; });

    // 3. IDs Mapping
    const cliIdMap = new Map();
    database.prepare('SELECT id, name, code FROM clients').all().forEach(c => {
      cliIdMap.set(c.name.toLowerCase(), c.id);
      cliIdMap.set(c.code.toLowerCase(), c.id);
    });
    const provIdMap = new Map();
    database.prepare('SELECT id, name FROM providers').all().forEach(p => provIdMap.set(p.name.toLowerCase(), p.id));

    const insLoc = database.prepare(`
      INSERT OR IGNORE INTO provider_locations (provider_id, name, sort_ord)
      VALUES (?, ?, (SELECT COALESCE(MAX(sort_ord), 0) + 1 FROM provider_locations WHERE provider_id = ?))
    `);

    const insOrder = database.prepare(`
      INSERT INTO orders (
        order_date, client_id, service, category, wo_internal, place,
        start_time, end_time, duration_minutes, provider_id, reporter,
        space_provider_id, notes, payment_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')
    `);

    const updOrder = database.prepare(`
      UPDATE orders SET
        order_date=?, service=?, category=?, place=?,
        start_time=?, end_time=?, duration_minutes=?,
        provider_id=?, reporter=?, space_provider_id=?, notes=?
      WHERE id=?
    `);

    parsedData.orders.forEach(o => {
      const cid = cliIdMap.get(o.client.toLowerCase());
      if (!cid) return;
      const pid = o.prov  ? provIdMap.get(o.prov.toLowerCase())  : null;
      const sid = o.sprov ? provIdMap.get(o.sprov.toLowerCase()) : null;

      // Auto-add location to provider_locations if both provider and place are present
      if (pid && o.place) {
        const locRes = insLoc.run(pid, o.place, pid);
        if (locRes.changes > 0) report.locations++;
      }

      if (o._existingId) {
        if (!overwrite) {
          report.orders_skipped++;
          return; // user chose to skip existing records
        }
        // Overwrite: update the existing order, preserve WO / payment / invoice
        updOrder.run(o.date, o.service, o.category, o.place, o.start, o.end, o.duration, pid, o.reporter, sid, o.notes, o._existingId);
        report.orders++;
        return;
      }

      // New order — generate internal WO and insert
      const wo = clientsSvc.consumeNextWO(cid).formatted;
      insOrder.run(o.date, cid, o.service, o.category, wo, o.place, o.start, o.end, o.duration, pid, o.reporter, sid, o.notes);
      report.orders++;
    });
  })();

  // Write audit log entry after the transaction so it is never rolled back
  try {
    const fileName = path.basename(parsedData._source || 'unknown.xlsx');
    const userId   = user ? user.id : null;
    database.prepare(
      `INSERT INTO audit_log (user_id, action, entity, level, details)
       VALUES (?, 'IMPORT', 'orders', 'INFO', ?)`
    ).run(
      userId,
      JSON.stringify({
        file: fileName,
        orders:    report.orders,
        clients:   report.clients,
        providers: report.providers,
        locations: report.locations
      })
    );
  } catch (e) {
    console.warn('[MIGRATE] audit_log write failed:', e.message);
  }

  return { ok: true, report };
}

function normalizeProviderType(t) {
  const s = String(t || '').toLowerCase().trim();
  if (s === 'space')   return 'space';
  if (s === 'crew')    return 'crew';
  if (s === 'package') return 'package';
  return 'location';
}

async function runInteractive() {
  const xlsxDefault = path.join(process.cwd(), 'PMP_Data_Sheet_V1.xlsm');
  console.log('Migrating from:', xlsxDefault);
  return getPreview(xlsxDefault);
}

// ================================================================
// cleanDuplicates — removes orders that share the same
// (order_date, client_id, service, start_time), keeping only the
// record with the lowest id (the first one imported).
// ================================================================
function cleanDuplicates() {
  const database = db.get();

  // First, count how many will be removed so we can report it
  const dupGroups = database.prepare(`
    SELECT COUNT(*) - COUNT(DISTINCT id) AS extra
    FROM (
      SELECT MIN(id) AS id
      FROM orders
      GROUP BY order_date, client_id,
               COALESCE(service, ''), COALESCE(start_time, '')
    )
  `).get();

  // Delete every record that is NOT the minimum-id winner of its group
  const result = database.prepare(`
    DELETE FROM orders
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM orders
      GROUP BY order_date, client_id,
               COALESCE(service, ''), COALESCE(start_time, '')
    )
  `).run();

  return { ok: true, deleted: result.changes };
}

module.exports = { getPreview, commitImport, cleanDuplicates, runInteractive };
