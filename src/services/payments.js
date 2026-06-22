// ================================================================
// payments.js — payment records against orders
// Accountants + admin + manager can add; everyone can list.
// ================================================================
const db = require('../db/database');

function listForOrder(orderId) {
  return db.get().prepare(`
    SELECT p.id, p.order_id, p.amount, p.payment_date, p.method, p.reference, p.notes,
           p.created_at, u.username AS created_by_name
    FROM payments p LEFT JOIN users u ON u.id = p.created_by
    WHERE p.order_id = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `).all(orderId);
}

function add(data, user) {
  const database = db.get();
  const amount = Number(data.amount) || 0;
  if (amount <= 0) throw new Error('AMOUNT_REQUIRED');
  if (!data.order_id) throw new Error('ORDER_REQUIRED');
  if (!data.payment_date) throw new Error('DATE_REQUIRED');

  const res = database.prepare(`
    INSERT INTO payments (order_id, amount, payment_date, method, reference, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(data.order_id), amount, String(data.payment_date),
    data.method || null, data.reference || null, data.notes || null,
    user.id
  );

  // Auto-update the order's payment_status based on totals
  _autoUpdateOrderStatus(Number(data.order_id));

  return { ok: true, id: res.lastInsertRowid };
}

function remove(id, user) {
  const database = db.get();
  const p = database.prepare('SELECT order_id, amount FROM payments WHERE id = ?').get(id);
  if (!p) return { ok: true };
  database.prepare('DELETE FROM payments WHERE id = ?').run(id);
  _autoUpdateOrderStatus(p.order_id);
  _audit(user ? user.id : null, 'payment_delete', 'payments', id,
    { order_id: p.order_id, amount: p.amount });
  return { ok: true };
}

function _audit(userId, action, entity, entityId, details) {
  try {
    db.get().prepare(`
      INSERT INTO audit_log (user_id, action, entity, entity_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, action, entity, entityId, JSON.stringify(details || {}));
  } catch (_) {}
}

function _autoUpdateOrderStatus(orderId) {
  const database = db.get();
  const r = database.prepare(`
    SELECT o.revenue, COALESCE(SUM(p.amount), 0) AS paid
    FROM orders o LEFT JOIN payments p ON p.order_id = o.id
    WHERE o.id = ? GROUP BY o.id
  `).get(orderId);
  if (!r) return;
  let status;
  if (r.paid <= 0)                    status = 'Pending';
  else if (r.paid >= (r.revenue || 0)) status = 'Paid';
  else                                 status = 'Partial';
  database.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(status, orderId);
}

module.exports = { listForOrder, add, remove };
