// ================================================================
// pricing.js — pricing engine
//   Categories: live | space | crew | package
//
// LIVE pricing (live_type):
//   per5      → base15 price for first 15 min, then per5 price per extra 5 min block
//   flat30    → flat price for 30 min
//   flat60    → flat price for 60 min
//   special   → override: use special price directly (if use_special=1)
//
// CREW pricing (crew_type):
//   full_day  → 8 hours (480 min) flat price
//   half_day  → 4 hours (240 min) flat price
//   special   → override: use special price directly (if use_special=1)
//
// SPACE pricing:
//   per-minute rate × duration (unchanged)
//
// PACKAGE pricing:
//   flat rate per service or manual entry (unchanged)
//
// Lookup order for a price:
//   1. client-specific rate for that type
//   2. default rate for that type
//   3. client-specific catch-all for the category (label IS NULL)
//   4. default catch-all for the category
// ================================================================
const db = require('../db/database');

// ---- CRUD on pricing tables ----
function getDefault() {
  return db.get().prepare(`
    SELECT id, category, type, label, price FROM pricing_default
    ORDER BY category, type, label
  `).all();
}

function getForClient(clientId) {
  return db.get().prepare(`
    SELECT id, category, type, label, price FROM pricing_client
    WHERE client_id = ?
    ORDER BY category, type, label
  `).all(clientId);
}

function getForProvider(providerId) {
  return db.get().prepare(`
    SELECT id, category, type, label, cost FROM pricing_provider
    WHERE provider_id = ?
    ORDER BY category, type, label
  `).all(providerId);
}

function saveDefault({ id, category, type, label, price }) {
  const database = db.get();
  if (id) {
    database.prepare(`UPDATE pricing_default SET category=?, type=?, label=?, price=? WHERE id=?`)
      .run(category, type || null, label || null, Number(price) || 0, id);
    return { ok: true, id };
  }
  const r = database.prepare(`
    INSERT INTO pricing_default (category, type, label, price) VALUES (?,?,?,?)
    ON CONFLICT(category, type, label) DO UPDATE SET price=excluded.price
  `).run(category, type || null, label || null, Number(price) || 0);
  return { ok: true, id: r.lastInsertRowid };
}

function saveClientRate({ id, client_id, category, type, label, price }) {
  const database = db.get();
  if (id) {
    database.prepare(`UPDATE pricing_client SET category=?, type=?, label=?, price=? WHERE id=?`)
      .run(category, type || null, label || null, Number(price) || 0, id);
    return { ok: true, id };
  }
  const r = database.prepare(`
    INSERT INTO pricing_client (client_id, category, type, label, price) VALUES (?,?,?,?,?)
    ON CONFLICT(client_id, category, type, label) DO UPDATE SET price=excluded.price
  `).run(client_id, category, type || null, label || null, Number(price) || 0);
  return { ok: true, id: r.lastInsertRowid };
}

function saveProviderCost({ id, provider_id, category, type, label, cost }) {
  const database = db.get();
  if (id) {
    database.prepare(`UPDATE pricing_provider SET category=?, type=?, label=?, cost=? WHERE id=?`)
      .run(category, type || null, label || null, Number(cost) || 0, id);
    return { ok: true, id };
  }
  const r = database.prepare(`
    INSERT INTO pricing_provider (provider_id, category, type, label, cost) VALUES (?,?,?,?,?)
    ON CONFLICT(provider_id, category, type, label) DO UPDATE SET cost=excluded.cost
  `).run(provider_id, category, type || null, label || null, Number(cost) || 0);
  return { ok: true, id: r.lastInsertRowid };
}

// ---- Delete functions ----
function deleteDefault(id)         { db.get().prepare('DELETE FROM pricing_default WHERE id = ?').run(id);  return { ok: true }; }
function deleteClientRate(id)      { db.get().prepare('DELETE FROM pricing_client WHERE id = ?').run(id);   return { ok: true }; }
function deleteProviderCost(id)    { db.get().prepare('DELETE FROM pricing_provider WHERE id = ?').run(id); return { ok: true }; }

// ---- Lookup helpers ----
function _priceLookup(category, type, serviceLabel, clientId) {
  const database = db.get();
  const typeSql = type == null ? 'type IS NULL' : 'type = ?';

  // 1. Client-specific for (category, type, label)
  if (clientId && serviceLabel) {
    const args = [clientId, category];
    if (type != null) args.push(type);
    const cp = database.prepare(`
      SELECT price FROM pricing_client
      WHERE client_id=? AND category=? AND ${typeSql} AND label=?
    `).get(...args, serviceLabel);
    if (cp) return cp.price;
  }
  // 2. Client-specific for (category, type) with no label
  if (clientId) {
    const args = [clientId, category];
    if (type != null) args.push(type);
    const cp = database.prepare(`
      SELECT price FROM pricing_client
      WHERE client_id=? AND category=? AND ${typeSql} AND label IS NULL
    `).get(...args);
    if (cp) return cp.price;
  }
  // 3. Default for (category, type, label)
  if (serviceLabel) {
    const args = [category];
    if (type != null) args.push(type);
    const dp = database.prepare(`
      SELECT price FROM pricing_default
      WHERE category=? AND ${typeSql} AND label=?
    `).get(...args, serviceLabel);
    if (dp) return dp.price;
  }
  // 4. Default for (category, type) with no label
  const args = [category];
  if (type != null) args.push(type);
  const dp = database.prepare(`
    SELECT price FROM pricing_default
    WHERE category=? AND ${typeSql} AND label IS NULL
  `).get(...args);
  return dp ? dp.price : 0;
}

function _providerCostLookup(category, type, serviceLabel, providerId) {
  if (!providerId) return 0;
  const database = db.get();
  const typeSql = type == null ? 'type IS NULL' : 'type = ?';
  if (serviceLabel) {
    const args = [providerId, category];
    if (type != null) args.push(type);
    const r = database.prepare(`
      SELECT cost FROM pricing_provider
      WHERE provider_id=? AND category=? AND ${typeSql} AND label=?
    `).get(...args, serviceLabel);
    if (r) return r.cost;
  }
  const args = [providerId, category];
  if (type != null) args.push(type);
  const r = database.prepare(`
    SELECT cost FROM pricing_provider
    WHERE provider_id=? AND category=? AND ${typeSql} AND label IS NULL
  `).get(...args);
  return r ? r.cost : 0;
}

// ---- Pricing engine ----
// input: {
//   category, service, duration_minutes, client_id, provider_id, manual_price,
//   live_type, crew_type, use_special, special_price
// }
function calculate(input) {
  const {
    category, service, duration_minutes: dur,
    client_id, provider_id, manual_price,
    live_type, crew_type, use_special, special_price
  } = input || {};

  const durMin = Number(dur) || 0;
  let revenue = 0;

  switch (category) {
    case 'live': {
      const lt = live_type || 'per5';
      if (use_special) {
        // Special override: use the order-specific special price if entered,
        // otherwise fall back to the pricing table's special rate
        revenue = Number(special_price) || _priceLookup('live', 'special', service || null, client_id || null);
      } else if (lt === 'flat30') {
        revenue = _priceLookup('live', 'flat30', service || null, client_id || null);
      } else if (lt === 'flat60') {
        revenue = _priceLookup('live', 'flat60', service || null, client_id || null);
      } else {
        // per5: base15 for first 15 min, then per5 per extra 5 min block
        const base15 = _priceLookup('live', 'base15', service || null, client_id || null);
        const per5   = _priceLookup('live', 'per5',   service || null, client_id || null);
        if (durMin <= 15) {
          revenue = base15;
        } else {
          const extraMin = durMin - 15;
          const extraBlocks = Math.ceil(extraMin / 5);
          revenue = base15 + (extraBlocks * per5);
        }
      }
      break;
    }

    case 'space': {
      const rate = _priceLookup('space', null, service || null, client_id || null);
      revenue = rate * durMin;
      break;
    }

    case 'crew': {
      const ct = crew_type || 'full_day';
      if (use_special) {
        // Special override: use the order-specific special price if entered,
        // otherwise fall back to the pricing table's special rate
        revenue = Number(special_price) || _priceLookup('crew', 'special', service || null, client_id || null);
      } else if (ct === 'half_day') {
        revenue = _priceLookup('crew', 'half_day', service || null, client_id || null);
      } else {
        revenue = _priceLookup('crew', 'full_day', service || null, client_id || null);
      }
      break;
    }

    case 'package': {
      const rate = _priceLookup('package', null, service || null, client_id || null);
      revenue = rate || Number(manual_price) || 0;
      break;
    }

    default:
      revenue = Number(manual_price) || 0;
  }

  const cost   = _providerCostLookup(category, null, service || null, provider_id || null);
  const profit = revenue - cost;
  return { revenue, cost, profit };
}

module.exports = {
  getDefault, getForClient, getForProvider,
  saveDefault, saveClientRate, saveProviderCost,
  deleteDefault, deleteClientRate, deleteProviderCost,
  calculate
};
