// ================================================================
// reports.js — reports page
// ================================================================
(function () {
  let currentUser = null;

  async function init() {
    currentUser = await initChrome({ page: 'reports', title: 'Reports' });
    if (!currentUser) return;

    setHidden('.financial-section, .col-fin', currentUser.role === 'coordination');

    const [clients, providers] = await Promise.all([
      window.pmp.clients.list(), window.pmp.providers.list()
    ]);
    const cs = document.getElementById('fClient');
    cs.innerHTML = clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const ps = document.getElementById('fProvider');
    providers.forEach(p => ps.innerHTML += `<option value="${p.id}">${esc(p.name)}</option>`);

    // Default: current month
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById('fFrom').value = `${y}-${m}-01`;
    document.getElementById('fTo').value   = new Date(y, now.getMonth() + 1, 0).toISOString().slice(0, 10);

    document.getElementById('btnApply').addEventListener('click', applyFilters);
    document.getElementById('btnClear').addEventListener('click', clearFilters);
    document.getElementById('btnExport').addEventListener('click', exportExcel);
    const staleLink = document.getElementById('staleApplyLink');
    if (staleLink) staleLink.addEventListener('click', (e) => { e.preventDefault(); applyFilters(); });
    document.getElementById('fSearch').addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });

    // Show stale notice when filters change without applying
    ['fFrom','fTo','fClient','fProvider','fCategory','fStatus','fSearch'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', showStaleNotice);
    });
    document.getElementById('fSearch').addEventListener('input', showStaleNotice);

    document.getElementById('tblBody').addEventListener('dblclick', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) navWithContext('orders_edit', { id: Number(tr.dataset.id) });
    });

    await applyFilters();
  }

  function getFilters() {
    const clientIds = Array.from(document.getElementById('fClient').selectedOptions)
      .map(o => o.value).filter(Boolean);
    const f = {
      from:       document.getElementById('fFrom').value     || undefined,
      to:         document.getElementById('fTo').value       || undefined,
      clientIds:  clientIds.length ? clientIds.join(',') : undefined,
      providerId: document.getElementById('fProvider').value || undefined,
      category:   document.getElementById('fCategory').value || undefined,
      status:     document.getElementById('fStatus').value   || undefined,
      search:     document.getElementById('fSearch').value.trim() || undefined
    };
    Object.keys(f).forEach(k => f[k] === undefined && delete f[k]);
    return f;
  }

  function showStaleNotice() {
    const el = document.getElementById('staleNotice');
    if (el) el.style.display = 'block';
  }

  function hideStaleNotice() {
    const el = document.getElementById('staleNotice');
    if (el) el.style.display = 'none';
  }

  function clearFilters() {
    ['fFrom','fTo','fProvider','fCategory','fStatus','fSearch']
      .forEach(id => document.getElementById(id).value = '');
    document.getElementById('fClient').selectedIndex = -1; // deselect all clients
    applyFilters();
  }

  async function applyFilters() {
    hideStaleNotice();
    const filters = getFilters();
    try {
      const [rows, summary] = await Promise.all([
        window.pmp.reports.run(filters),
        window.pmp.reports.summary(filters)
      ]);
      renderSummary(summary);
      renderTable(rows || []);
    } catch (err) { toast('Failed to load report: ' + (err.message || err), 'error'); }
  }

  function renderSummary(s) {
    document.getElementById('sumTotal').textContent = fmtNumber(s.total_orders || 0);
    if (currentUser.role === 'coordination') return;

    document.getElementById('sumRev').textContent    = fmtMoney(s.total_revenue, 'USD');
    document.getElementById('sumCost').textContent   = fmtMoney(s.total_cost, 'USD');
    document.getElementById('sumProfit').textContent = fmtMoney(s.total_profit, 'USD');

    const bs = document.getElementById('byStatus');
    bs.innerHTML = (!s.by_status || !s.by_status.length)
      ? '<div class="breakdown-row"><span class="lbl">—</span><span class="val">0</span></div>'
      : s.by_status.map(b => `
          <div class="breakdown-row">
            <span class="lbl">${esc(b.status)} <span style="color:#95a5a6">(${b.count})</span></span>
            <span class="val">$${fmtNumber(b.revenue || 0)}</span>
          </div>`).join('');

    const bc = document.getElementById('byClient');
    bc.innerHTML = (!s.by_client || !s.by_client.length)
      ? '<div class="breakdown-row"><span class="lbl">—</span><span class="val">0</span></div>'
      : s.by_client.map(b => `
          <div class="breakdown-row">
            <span class="lbl">${esc(b.client_name)} <span style="color:#95a5a6">(${b.count})</span></span>
            <span class="val">$${fmtNumber(b.revenue || 0)}</span>
          </div>`).join('');
  }

  function renderTable(rows) {
    const tbody = document.getElementById('tblBody');
    document.getElementById('rowCount').textContent = `${rows.length} record${rows.length !== 1 ? 's' : ''}`;

    if (!rows.length) {
      tbody.innerHTML = '';
      document.getElementById('noResults').style.display = 'block';
      return;
    }
    document.getElementById('noResults').style.display = 'none';
    const isCoord = currentUser.role === 'coordination';

    tbody.innerHTML = rows.map((r, i) => {
      const finCells = isCoord ? '' : `
        <td class="amount col-fin">${fmtMoney(r.revenue, r.currency)}</td>
        <td class="amount col-fin">${fmtMoney(r.cost, r.currency)}</td>
        <td class="amount col-fin" style="color:${(r.profit||0)>=0?'#27ae60':'#c0392b'}">${fmtMoney(r.profit, r.currency)}</td>`;
      return `
        <tr data-id="${r.id}">
          <td>${i + 1}</td>
          <td>${fmtDate(r.order_date)}</td>
          <td>${esc(r.wo_client || '')}</td>
          <td>${esc(r.client_name || '')}</td>
          <td>${esc(r.service || '')}</td>
          <td>${esc(r.provider_name || '')}</td>
          <td>${esc(r.place || '')}</td>
          <td>${esc(r.start_time || '')}</td>
          <td>${esc(r.end_time || '')}</td>
          <td style="text-align:center">${r.duration_minutes || '—'}</td>
          ${finCells}
          <td><span class="badge ${badgeClass(r.payment_status)}">${esc(r.payment_status || '')}</span></td>
        </tr>`;
    }).join('');
  }

  async function exportExcel() {
    const btn = document.getElementById('btnExport');
    btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Exporting...';
    try {
      const res = await window.pmp.reports.exportExcel(getFilters());
      if (res && res.browser) toast('Download starting...', 'info');
      else if (res && res.ok)   toast(`Exported (${res.rowCount || 0} records)`, 'success');
      else if (!res || !res.canceled) toast('Export complete', 'success');
    } catch (err) { toast('Export failed: ' + (err.message || err), 'error'); }
    finally { btn.disabled = false; btn.textContent = orig; }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
