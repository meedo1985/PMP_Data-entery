// ================================================================
// clients.js — clients page
// ================================================================
(function () {
  let currentUser = null;
  let allRows = [];
  let searchTimeout = null;

  async function init() {
    currentUser = await initChrome({ page: 'clients', title: 'Client Management' });
    if (!currentUser) return;

    document.getElementById('btnRefresh').addEventListener('click', load);
    document.getElementById('searchBox').addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => render(filter(e.target.value)), 150);
    });
    document.getElementById('btnAdd').addEventListener('click', () => openModal(null));
    document.getElementById('btnCancel').addEventListener('click', closeModal);
    document.getElementById('btnSave').addEventListener('click', onSave);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });
    document.getElementById('tblBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (btn.classList.contains('btn-edit')) return openModal(id);
      if (btn.classList.contains('btn-del'))  return onDelete(id);
    });

    const canEdit = hasPerm(currentUser, 'manageClients');
    if (!canEdit) document.getElementById('btnAdd').style.display = 'none';

    await load();
  }

  async function load() {
    try {
      allRows = await window.pmp.clients.list() || [];
      render(allRows);
    } catch (err) {
      toast('Failed to load clients: ' + (err.message || err), 'error');
    }
  }

  function filter(term) {
    term = (term || '').toLowerCase().trim();
    if (!term) return allRows;
    return allRows.filter(r =>
      (r.name || '').toLowerCase().indexOf(term) > -1 ||
      (r.code || '').toLowerCase().indexOf(term) > -1 ||
      (r.group_name || '').toLowerCase().indexOf(term) > -1
    );
  }

  function render(rows) {
    const tbody    = document.getElementById('tblBody');
    const canEdit   = hasPerm(currentUser, 'manageClients');
    const canDelete = hasPerm(currentUser, 'deleteClients');

    if (!renderTableState(rows, { noResultsId: 'noResults', rowCountId: 'rowCount', label: 'client' })) {
      tbody.innerHTML = '';
      return;
    }
    tbody.innerHTML = rows.map((r, i) => {
      const group = r.group_name ? `<span class="group-badge">${esc(r.group_name)}</span>` : '—';
      return `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${esc(r.name)}</strong></td>
          <td><code>${esc(r.code)}</code></td>
          <td>${group}</td>
          <td>${fmtNumber(r.last_wo)}</td>
          ${rowActions(r.id, { canEdit, canDelete })}
        </tr>`;
    }).join('');
  }

  function openModal(id) {
    if (id) {
      const r = allRows.find(x => x.id === id);
      if (!r) return;
      document.getElementById('modalTitle').textContent = 'Edit Client';
      document.getElementById('fId').value    = r.id;
      document.getElementById('fName').value  = r.name  || '';
      document.getElementById('fCode').value  = r.code  || '';
      document.getElementById('fGroup').value = r.group_name || '';
      document.getElementById('fNotes').value = r.notes || '';
    } else {
      document.getElementById('modalTitle').textContent = 'Add Client';
      ['fId','fName','fCode','fGroup','fNotes'].forEach(id => document.getElementById(id).value = '');
    }
    document.getElementById('modal').classList.add('active');
    setTimeout(() => document.getElementById('fName').focus(), 50);
  }

  function closeModal() { document.getElementById('modal').classList.remove('active'); }

  async function onSave() {
    const id    = Number(document.getElementById('fId').value) || null;
    const name  = document.getElementById('fName').value.trim();
    const code  = document.getElementById('fCode').value.trim().toUpperCase();
    const group = document.getElementById('fGroup').value.trim();
    const notes = document.getElementById('fNotes').value.trim();

    if (!name || !code) { toast('Name and code are required', 'error'); return; }

    try {
      await window.pmp.clients.save({ id, name, code, group_name: group || null, notes: notes || null, active: 1 });
      toast(id ? 'Client updated' : 'Client added', 'success');
      closeModal(); await load();
    } catch (err) { toast('Save failed: ' + (err.message || err), 'error'); }
  }

  async function onDelete(id) {
    const r = allRows.find(x => x.id === id);
    if (!r) return;
    const ok = await confirmDialog({
      title: 'Delete Client',
      message: `Delete "${r.name}"? Linked records will be preserved.`,
      confirmText: 'Delete', danger: true
    });
    if (!ok) return;
    try {
      await window.pmp.clients.remove(id);
      toast('Client deleted', 'success'); await load();
    } catch (err) { toast('Delete failed: ' + (err.message || err), 'error'); }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
