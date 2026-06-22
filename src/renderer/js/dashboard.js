// ================================================================
// dashboard.js — dashboard page logic
// ================================================================
(function () {
  let currentUser    = null;
  let allRows        = [];
  let _searchTimer   = null;
  let _currentLimit  = 25;

  async function init() {
    currentUser = await initChrome({
      page: 'dashboard',
      title: 'PMP Data Record &nbsp;&#183;&nbsp; External Services System',
      search: true
    });
    if (!currentUser) return;

    if (!hasPerm(currentUser, 'viewFinancial')) {
      document.getElementById('cardTotalAmt').style.display = 'none';
      document.getElementById('cardMonthAmt').style.display = 'none';
      document.querySelectorAll('.col-amount').forEach(el => el.style.display = 'none');
    }

    document.getElementById('btnRefresh').addEventListener('click', refreshAll);
    // Debounced search — waits 200ms after last keystroke
    const _onSearch = (e) => {
      clearTimeout(_searchTimer);
      const val = e.target.value;
      _searchTimer = setTimeout(() => {
        doSearch(val);
        // Keep both inputs in sync
        const other = e.target.id === 'searchBox' ? 'searchBoxMobile' : 'searchBox';
        const otherEl = document.getElementById(other);
        if (otherEl && otherEl.value !== val) otherEl.value = val;
      }, 200);
    };
    document.getElementById('searchBox').addEventListener('input', _onSearch);
    const mobileSearch = document.getElementById('searchBoxMobile');
    if (mobileSearch) mobileSearch.addEventListener('input', _onSearch);

    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => window.pmp.nav.goto(btn.dataset.nav));
    });

    // Double-click row to edit (desktop)
    document.getElementById('tblBody').addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-action]')) return; // let button handler take it
      const tr = e.target.closest('tr[data-id]');
      if (tr) navWithContext('orders_edit', { id: Number(tr.dataset.id) });
    });

    // Tap/click action buttons (mobile + keyboard)
    document.getElementById('tblBody').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (btn.dataset.action === 'edit')   navWithContext('orders_edit', { id });
      if (btn.dataset.action === 'delete') await deleteOrder(id);
    });

    document.getElementById('btnLoadMore').addEventListener('click', () =>
      loadRecent(_currentLimit + 25));

    // Press N anywhere on dashboard to open new order form
    document.addEventListener('keydown', (e) => {
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey &&
          !e.target.matches('input,textarea,select,button'))
        window.pmp.nav.goto('orders_new');
    });

    await refreshAll();
  }

  async function refreshAll() {
    _currentLimit = 25;
    await Promise.all([loadKpis(), loadRecent(25)]);
    const now = new Date();
    document.getElementById('lastRefresh').textContent =
      `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  const KPI_IDS = ['kpiTotalJobs', 'kpiMonthJobs', 'kpiTotalAmt', 'kpiMonthAmt'];

  async function loadKpis() {
    KPI_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.classList.add('skeleton'); el.textContent = '    '; }
    });
    try {
      const k = await window.pmp.orders.kpis();
      document.getElementById('kpiTotalJobs').textContent = fmtNumber(k.total_orders);
      document.getElementById('kpiMonthJobs').textContent = fmtNumber(k.month_orders);
      document.getElementById('monthLabel1').textContent  = k.month_label || '';
      document.getElementById('monthLabel2').textContent  = k.month_label || '';
      if (k.total_revenue != null)
        document.getElementById('kpiTotalAmt').textContent = fmtMoney(k.total_revenue, 'USD');
      if (k.month_revenue != null)
        document.getElementById('kpiMonthAmt').textContent = fmtMoney(k.month_revenue, 'USD');
    } catch (err) {
      toast('Error loading KPIs: ' + (err.message || err), 'error');
    } finally {
      KPI_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('skeleton');
      });
    }
  }

  async function loadRecent(limit) {
    _currentLimit = limit !== undefined ? limit : 25;
    try {
      const rows = await window.pmp.orders.recent(_currentLimit);
      allRows = rows || [];
      renderTable(allRows);
      const btnMore = document.getElementById('btnLoadMore');
      if (btnMore) btnMore.style.display = rows.length >= _currentLimit ? 'inline' : 'none';
    } catch (err) {
      toast('Error loading records: ' + (err.message || err), 'error');
    }
  }

  function renderTable(rows) {
    const tbody = document.getElementById('tblBody');
    if (!rows.length) {
      tbody.innerHTML = '';
      document.getElementById('noResults').style.display = 'block';
      document.getElementById('rowCount').textContent = '0 records';
      return;
    }
    document.getElementById('noResults').style.display = 'none';
    document.getElementById('rowCount').textContent = `${rows.length} records`;

    const hideAmount  = !hasPerm(currentUser, 'viewFinancial');
    const canDelete   = hasPerm(currentUser, 'deleteOrders');
    tbody.innerHTML = rows.map(r => {
      const amountCell = hideAmount ? '' :
        `<td class="amount">${fmtMoney(r.revenue, r.currency)}</td>`;
      const dur = r.duration_minutes ? r.duration_minutes + ' min' : '—';
      const delBtn = canDelete
        ? `<button class="btn btn-del" data-action="delete" data-id="${r.id}" title="Delete">&#10005;</button>`
        : '';
      return `
        <tr data-id="${r.id}">
          <td>${esc(r.wo_internal || r.id)}</td>
          <td>${fmtDate(r.order_date)}</td>
          <td>${esc(r.client_name || '')}</td>
          <td>${esc(r.service || '')}</td>
          <td>${esc(r.provider_name || '')}</td>
          <td>${esc(r.place || '')}</td>
          <td>${esc(r.start_time || '—')}</td>
          <td>${esc(r.end_time || '—')}</td>
          <td>${dur}</td>
          ${amountCell}
          <td><span class="badge ${badgeClass(r.payment_status)}">${esc(r.payment_status || '')}</span></td>
          <td class="col-actions">
            <button class="btn btn-edit" data-action="edit" data-id="${r.id}" title="Edit">Edit</button>
            ${delBtn}
          </td>
        </tr>`;
    }).join('');
  }

  async function deleteOrder(id) {
    const row   = allRows.find(r => r.id === id);
    const label = row ? (row.wo_internal || `Order #${id}`) : `Order #${id}`;
    const ok = await confirmDialog({
      title:       'Delete Order',
      message:     `Delete "${label}"? This cannot be undone.`,
      confirmText: 'Delete',
      danger:      true
    });
    if (!ok) return;
    try {
      await window.pmp.orders.remove(id);
      toast('Order deleted', 'success');
      await loadRecent(_currentLimit);
    } catch (err) {
      toast('Delete failed: ' + (err.message || err), 'error');
    }
  }

  function doSearch(term) {
    term = (term || '').toLowerCase().trim();
    if (!term) { renderTable(allRows); return; }
    renderTable(allRows.filter(r => {
      const hay = [r.wo_internal, r.wo_client, r.client_name, r.service,
                   r.provider_name, r.place, r.payment_status].join(' ').toLowerCase();
      return hay.indexOf(term) > -1;
    }));
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  document.addEventListener('DOMContentLoaded', init);
})();
