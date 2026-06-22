// ================================================================
// orders.js — work-orders (services) CRUD + KPIs
// Role-aware: "coordination" never sees revenue/cost/profit.
// ================================================================
const db = require('../db/database');
const clientsSvc = require('./clients');
const permissions = require('./permissions');

// Fields hidden from users without the viewFinancial permission
const FINANCIAL_FIELDS = ['revenue', 'cost', 'rate', 'profit', 'paid_amount', 'due_amount'];

function _maskFinancial(row, user) {
  if (!row || permissions.can(user, 'viewFinancial')) return row;
  const out = { ...row };
  for (const f of FINANCIAL_FIELDS) if (f in out) out[f] = null;
  return out;
}

function list(filters, user) {
  const database = db.get();
  const where = [];
  const args  = [];

  if (filters) {
    if (filters.from)       { where.push('order_date >= ?'); args.push(filters.from); }
    if (filters.to)         { where.push('order_date <= ?'); args.push(filters.to); }
    if (filters.clientId)   { where.push('client_id = ?');   args.push(filters.clientId); }
    if (filters.providerId) { where.push('provider_id = ?'); args.push(filters.providerId); }
    if (filters.status)     { where.push('payment_status = ?'); args.push(filters.status); }
    if (filters.category)   { where.push('category = ?');   args.push(filters.category); }
    if (filters.search)     {
      where.push('(client_name LIKE ? OR service LIKE ? OR wo_internal LIKE ? OR wo_client LIKE ? OR place LIKE ?)');
      const s = '%' + filters.search + '%';
      args.push(s, s, s, s, s);
    }
  }
  const limitVal = filters && filters.limit ? Math.min(Number(filters.limit) || 500, 5000) : 500;
  const sql = `
    SELECT * FROM v_orders_full
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY order_date DESC, id DESC
    LIMIT ?
  `;
  args.push(limitVal);
  const rows = database.prepare(sql).all(...args);
  return rows.map(r => _maskFinancial(r, user));
}

function recent(limit, user) {
  return list({ limit: Math.max(1, Math.min(500, limit || 50)) }, user);
}

function get(id, user) {
  const row = db.get().prepare('SELECT * FROM v_orders_full WHERE id = ?').get(id);
  return _maskFinancial(row, user);
}

function save(data, user) {
  const database = db.get();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Accountants can only update payment-related fields on existing orders
  if (user.role === 'accountant') {
    if (!data.id) {
      throw new Error('ACCOUNTANT_CANNOT_CREATE_ORDERS');
    }
    const allowed = ['payment_status', 'invoice_no'];
    const updates = {};
    for (const k of allowed) if (k in data) updates[k] = data[k] == null ? null : String(data[k]).trim() || null;
    updates.updated_by = user.id;
    updates.updated_at = now;
    const keys = Object.keys(updates);
    if (keys.length === 0) return { ok: true, id: data.id, noop: true };
    const assigns = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => updates[k]);
    vals.push(data.id);
    database.prepare(`UPDATE orders SET ${assigns} WHERE id = ?`).run(...vals);
    return { ok: true, id: data.id };
  }

  // Wrap main save in a transaction so WO consumption + order insert are atomic.
  const doSave = db.tx((data, user, now) => {
    const fields = _extractFields(data);

    // Users without viewFinancial cannot see financial values (orders.list/get mask
    // them), so they must not be able to write them either. Stripping the keys means:
    // on INSERT the column defaults apply, and on UPDATE existing values are preserved.
    if (!permissions.can(user, 'viewFinancial')) {
      for (const f of FINANCIAL_FIELDS) delete fields[f];
    }

    // If no internal WO and client provided, auto-generate
    if (!fields.wo_internal && fields.client_id) {
      const wo = clientsSvc.consumeNextWO(fields.client_id);
      fields.wo_internal = wo.formatted;
    }

    if (data.id) {
      fields.updated_by = user.id;
      fields.updated_at = now;
      const keys = Object.keys(fields);
      const assigns = keys.map(k => `${k} = ?`).join(', ');
      const vals = keys.map(k => fields[k]);
      vals.push(data.id);
      db.get().prepare(`UPDATE orders SET ${assigns} WHERE id = ?`).run(...vals);
      return { ok: true, id: data.id };
    } else {
      fields.created_by = user.id;
      const keys = Object.keys(fields);
      const cols = keys.join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const vals = keys.map(k => fields[k]);
      const res = db.get().prepare(`INSERT INTO orders (${cols}) VALUES (${placeholders})`).run(...vals);
      return { ok: true, id: res.lastInsertRowid, wo_internal: fields.wo_internal };
    }
  });

  return doSave(data, user, now);
}

function _extractFields(d) {
  const num = (v) => (v === '' || v == null) ? null : Number(v);
  const str = (v) => (v === '' || v == null) ? null : String(v).trim();
  return {
    order_date:       str(d.order_date),
    client_id:        d.client_id ? Number(d.client_id) : null,
    service:          str(d.service),
    category:         str(d.category),
    wo_client:        str(d.wo_client),
    wo_internal:      str(d.wo_internal),
    place:            str(d.place),
    place_ar:         str(d.place_ar),
    start_time:       str(d.start_time),
    end_time:         str(d.end_time),
    duration_minutes: num(d.duration_minutes),
    duration_seconds: num(d.duration_seconds),
    bandwidth_mhz:    num(d.bandwidth_mhz),
    provider_id:      d.provider_id ? Number(d.provider_id) : null,
    space_provider_id: d.space_provider_id ? Number(d.space_provider_id) : null,
    reporter:         str(d.reporter),
    rate:             num(d.rate) || 0,
    revenue:          num(d.revenue) || 0,
    cost:             num(d.cost) || 0,
    currency:         str(d.currency) || 'USD',
    invoice_no:       str(d.invoice_no),
    payment_status:   str(d.payment_status) || 'Pending',
    notes:            str(d.notes),
    live_type:        str(d.live_type),
    crew_type:        str(d.crew_type),
    use_special:      d.use_special ? 1 : 0,
    special_price:    num(d.special_price)
  };
}

function remove(id) {
  db.get().prepare('DELETE FROM orders WHERE id = ?').run(id);
  return { ok: true };
}

// KPIs for the dashboard
function getKpis(user) {
  const database = db.get();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const monthStart = `${y}-${m}-01`;

  const total = database.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const month = database.prepare('SELECT COUNT(*) AS c FROM orders WHERE order_date >= ?').get(monthStart).c;

  const base = { total_orders: total, month_orders: month, month_label: _arabicMonth(now.getMonth()) + ' ' + y };

  if (!permissions.can(user, 'viewFinancial')) {
    return { ...base, total_revenue: null, month_revenue: null };
  }

  const totalRev = database.prepare('SELECT COALESCE(SUM(revenue), 0) AS s FROM orders').get().s;
  const monthRev = database.prepare('SELECT COALESCE(SUM(revenue), 0) AS s FROM orders WHERE order_date >= ?').get(monthStart).s;
  return { ...base, total_revenue: totalRev, month_revenue: monthRev };
}

function _arabicMonth(mIdx) {
  return ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
          'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'][mIdx];
}

module.exports = { list, recent, get, save, remove, getKpis };
