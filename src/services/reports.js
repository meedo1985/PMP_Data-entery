const db = require('../db/database');

function runReport(filters, user) {
    const database = db.get();
    const { where, args } = _buildWhere(filters);

    const sql = `SELECT * FROM v_orders_full ${where} ORDER BY order_date DESC LIMIT ?`;
    args.push(10000);
    const rows = database.prepare(sql).all(...args);
    
    return rows.map(r => _maskFinancial(r, user));
}

function summary(filters, user) {
    const database = db.get();
    const { where, args } = _buildWhere(filters);
    
    const stats = database.prepare(`
        SELECT 
            COUNT(*) as total_orders,
            SUM(revenue) as total_revenue,
            SUM(cost) as total_cost,
            SUM(revenue - cost) as total_profit,
            SUM(paid_amount) as total_paid,
            SUM(due_amount) as total_due
        FROM v_orders_full ${where}
    `).get(...args);

    const byStatus = database.prepare(`
        SELECT payment_status as status, COUNT(*) as count, SUM(revenue) as revenue
        FROM v_orders_full ${where} GROUP BY payment_status
    `).all(...args);

    const byClient = database.prepare(`
        SELECT client_name, COUNT(*) as count, SUM(revenue) as revenue, SUM(revenue - cost) as profit
        FROM v_orders_full ${where} GROUP BY client_id ORDER BY revenue DESC LIMIT 10
    `).all(...args);

    return {
        ...stats,
        by_status: byStatus,
        by_client: byClient
    };
}

// Report columns — matches the PMP report layout (Book1.xlsx).
// No financial columns by design; same for every role.
const REPORT_HEADERS = [
    'Date', 'Client', 'Service', 'Place', 'Start', 'End', 'Dur.',
    'Prov.', 'Reporter / Guest', 'Space Prov.', 'المكان'
];

// ISO yyyy-mm-dd  →  dd.mm.yyyy  (the format used in the report)
function _fmtDate(iso) {
    if (!iso) return '';
    const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso);
}

// Duration display: "M:SS Min" when there are seconds, otherwise "N Min".
// (e.g. 3 min 5 sec -> "3:05 Min";  60 min 0 sec -> "60 Min")
function _fmtDuration(mins, secs) {
    const m = Number(mins) || 0;
    const s = Number(secs) || 0;
    if (!m && !s) return '-';
    if (s > 0) return `${m}:${String(s).padStart(2, '0')} Min`;
    return `${m} Min`;
}

// One data row in report order. Empty cells become "-" (as in Book1).
function _reportRow(r) {
    const dash = (v) => (v === null || v === undefined || v === '') ? '-' : v;
    return [
        _fmtDate(r.order_date),
        r.client_name || '',
        r.service || '',
        r.place || '',
        dash(r.start_time),
        dash(r.end_time),
        _fmtDuration(r.duration_minutes, r.duration_seconds),
        dash(r.provider_name),
        dash(r.reporter),
        dash(r.space_provider_name),
        r.place_ar || ''
    ];
}

// Build a styled ExcelJS workbook from the filtered orders.
// Rows are grouped by month — one worksheet (tab) per month, named "MM-YYYY".
async function buildReportWorkbook(filters, user) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PMP Data Record';

    const rows = runReport(filters, user);

    // Group by year-month (yyyy-mm)
    const groups = new Map();
    for (const r of rows) {
        const ym = (r.order_date || '').slice(0, 7) || 'unknown';
        if (!groups.has(ym)) groups.set(ym, []);
        groups.get(ym).push(r);
    }

    const months = [...groups.keys()].sort(); // chronological
    if (!months.length) {
        _addSheet(wb, 'Report', []); // empty workbook still has a header sheet
    } else {
        for (const ym of months) {
            const sheetName = /^\d{4}-\d{2}$/.test(ym)
                ? `${ym.slice(5, 7)}-${ym.slice(0, 4)}`   // MM-YYYY
                : 'Other';
            // sort rows within the month ascending by date
            const monthRows = groups.get(ym)
                .slice()
                .sort((a, b) => String(a.order_date).localeCompare(String(b.order_date)));
            _addSheet(wb, sheetName, monthRows);
        }
    }

    return { wb, rowCount: rows.length };
}

function _addSheet(wb, name, rows) {
    const ws = wb.addWorksheet(name);
    ws.addRow(REPORT_HEADERS);
    rows.forEach(r => ws.addRow(_reportRow(r)));

    // Header styling
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A3A5C' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 22;

    // Borders + alignment for every cell
    const b = { style: 'thin', color: { argb: 'FFB0B0B0' } };
    ws.eachRow((row, rn) => {
        row.eachCell((cell) => {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = { top: b, bottom: b, left: b, right: b };
            if (rn > 1) cell.font = { size: 11 };
        });
    });

    // Column widths
    REPORT_HEADERS.forEach((h, i) => {
        const col = ws.getColumn(i + 1);
        let maxLen = String(h).length;
        rows.forEach(r => {
            const v = _reportRow(r)[i];
            const len = v == null ? 0 : String(v).length;
            if (len > maxLen) maxLen = len;
        });
        col.width = Math.min(36, Math.max(10, maxLen + 3));
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: REPORT_HEADERS.length } };
    return ws;
}

function _buildWhere(f) {
    const clauses = [];
    const args = [];
    if (f.from) { clauses.push("order_date >= ?"); args.push(f.from); }
    if (f.to)   { clauses.push("order_date <= ?"); args.push(f.to); }
    // Multi-client: clientIds may be an array (IPC) or a comma-string (query param).
    let clientIds = f.clientIds;
    if (typeof clientIds === 'string') clientIds = clientIds.split(',');
    clientIds = (Array.isArray(clientIds) ? clientIds : [])
        .map(v => parseInt(v, 10)).filter(Number.isFinite);
    if (clientIds.length) {
        clauses.push(`client_id IN (${clientIds.map(() => '?').join(',')})`);
        args.push(...clientIds);
    } else if (f.clientId) {
        clauses.push("client_id = ?"); args.push(f.clientId);
    }
    if (f.providerId) { clauses.push("provider_id = ?"); args.push(f.providerId); }
    if (f.category) { clauses.push("category = ?"); args.push(f.category); }
    if (f.status) { clauses.push("payment_status = ?"); args.push(f.status); }
    if (f.search) {
        clauses.push("(wo_internal LIKE ? OR client_name LIKE ? OR service LIKE ?)");
        const s = `%${f.search}%`;
        args.push(s, s, s);
    }
    return { where: clauses.length ? "WHERE " + clauses.join(" AND ") : "", args };
}

function _maskFinancial(row, user) {
    if (user.role !== 'coordination') return row;
    // Hide all financial fields from coordination role
    const out = { ...row };
    for (const f of ['revenue', 'cost', 'rate', 'profit', 'paid_amount', 'due_amount']) {
        if (f in out) out[f] = null;
    }
    return out;
}

module.exports = { runReport, summary, buildReportWorkbook };