// ================================================================
// providers.js — providers page
// Each modal open creates a completely isolated session object.
// No shared mutable state that can leak between sessions.
// ================================================================
(function () {
  let currentUser = null;
  let allRows     = [];

  // Current modal session — replaced entirely on each openModal()
  // null when no modal is open
  let session = null;

  async function init() {
    currentUser = await initChrome({ page: 'providers', title: 'Provider Management' });
    if (!currentUser) return;

    document.getElementById('btnRefresh').addEventListener('click', load);
    document.getElementById('searchBox').addEventListener('input',
      (e) => render(filter(e.target.value)));

    document.getElementById('btnAdd').addEventListener('click',
      () => openModal(null));
    document.getElementById('btnCancel').addEventListener('click',
      closeModal);
    document.getElementById('btnSave').addEventListener('click',
      onSave);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });

    document.getElementById('btnLocAdd').addEventListener('click',
      addPendingLocation);
    document.getElementById('locInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addPendingLocation();
    });

    document.getElementById('tblBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      if (btn.classList.contains('btn-edit')) openModal(id);
      if (btn.classList.contains('btn-del'))  onDelete(id);
    });

    if (!hasPerm(currentUser, 'manageProviders'))
      document.getElementById('btnAdd').style.display = 'none';

    await load();
  }

  // ================================================================
  // LIST
  // ================================================================
  async function load() {
    try {
      allRows = await window.pmp.providers.list() || [];
      render(allRows);
    } catch (err) {
      toast('Failed to load providers: ' + (err.message || err), 'error');
    }
  }

  function filter(term) {
    term = (term || '').toLowerCase().trim();
    if (!term) return allRows;
    return allRows.filter(r =>
      (r.name  || '').toLowerCase().includes(term) ||
      (r.notes || '').toLowerCase().includes(term)
    );
  }

  function typeBadge(t) {
    if (t === 'space')
      return `<span class="badge badge-space">🛰️ Space</span>`;
    return `<span class="badge badge-location">📍 Location</span>`;
  }

  function render(rows) {
    const tbody     = document.getElementById('tblBody');
    const canEdit   = hasPerm(currentUser, 'manageProviders');
    const canDelete = hasPerm(currentUser, 'manageProviders') && currentUser.role === 'admin';

    if (!renderTableState(rows, { noResultsId: 'noResults', rowCountId: 'rowCount', label: 'provider' })) {
      tbody.innerHTML = '';
      return;
    }
    tbody.innerHTML = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${esc(r.name)}</strong></td>
        <td>${typeBadge(r.type)}</td>
        <td id="locs_${r.id}" class="locs-cell">
          <span style="color:#bdc3c7;font-size:11px">—</span>
        </td>
        <td>${esc(r.notes || '')}</td>
        ${rowActions(r.id, { canEdit, canDelete })}
      </tr>`).join('');

    rows.forEach(r => loadRowLocations(r.id));
  }

  async function loadRowLocations(providerId) {
    const cell = document.getElementById('locs_' + providerId);
    if (!cell) return;
    try {
      const locs = await window.pmp.locations.list(providerId) || [];
      if (!locs.length) {
        cell.innerHTML =
          '<span style="color:#bdc3c7;font-style:italic;font-size:11px">No locations</span>';
      } else {
        cell.innerHTML = locs.map(l =>
          `<span style="display:inline-block;background:#f4f6f8;border:1px solid #e2e8f0;` +
          `border-radius:10px;padding:1px 8px;font-size:11px;margin:1px">${esc(l.name)}</span>`
        ).join(' ');
      }
    } catch (err) {
      cell.innerHTML =
        `<span style="color:#e74c3c;font-size:11px">⚠ ${esc(err.message)}</span>`;
    }
  }

  // ================================================================
  // MODAL — creates a fresh isolated session object each time
  // ================================================================
  async function openModal(editId) {
    // Create a brand new session — completely isolated from any previous one
    const s = {
      editId:   editId || null,   // null = new provider
      toAdd:    [],               // location names to add
      toRemove: [],               // location IDs to remove
      existing: [],               // existing {id,name} from DB
      saving:   false             // prevent double-submit
    };

    if (editId) {
      const r = allRows.find(x => x.id === editId);
      if (!r) return;
      document.getElementById('modalTitle').textContent = 'Edit Provider';
      document.getElementById('fId').value    = r.id;
      document.getElementById('fName').value  = r.name  || '';
      document.getElementById('fType').value  = r.type === 'space' ? 'space' : 'location';
      document.getElementById('fNotes').value = r.notes || '';

      try {
        s.existing = await window.pmp.locations.list(editId) || [];
      } catch (err) {
        toast('Could not load locations: ' + (err.message || err), 'error');
      }
    } else {
      document.getElementById('modalTitle').textContent = 'Add Provider';
      document.getElementById('fId').value    = '';
      document.getElementById('fName').value  = '';
      document.getElementById('fType').value  = 'location';
      document.getElementById('fNotes').value = '';
    }

    document.getElementById('locInput').value = '';

    // Assign the session ONLY after all async loading is done
    session = s;
    renderLocTags();

    document.getElementById('modal').classList.add('active');
    setTimeout(() => document.getElementById('fName').focus(), 50);
  }

  function closeModal() {
    session = null;   // discard session entirely
    document.getElementById('modal').classList.remove('active');
    document.getElementById('locInput').value = '';
  }

  // ================================================================
  // LOCATION MANAGEMENT — all mutations go through session
  // ================================================================
  function addPendingLocation() {
    if (!session) return;

    const inp  = document.getElementById('locInput');
    const name = inp.value.trim();
    if (!name) { inp.focus(); return; }

    // Check duplicates (active items only)
    const activeNames = [
      ...session.existing
        .filter(l => !session.toRemove.includes(l.id))
        .map(l => l.name.toLowerCase()),
      ...session.toAdd.map(n => n.toLowerCase())
    ];
    if (activeNames.includes(name.toLowerCase())) {
      toast(`"${name}" already in list`, 'info');
      inp.value = '';
      inp.focus();
      return;
    }

    session.toAdd.push(name);
    inp.value = '';
    inp.focus();
    renderLocTags();
  }

  function removePendingLocation(name) {
    if (!session) return;

    // If pending (not yet saved), just remove from toAdd
    const idx = session.toAdd.indexOf(name);
    if (idx > -1) {
      session.toAdd.splice(idx, 1);
      renderLocTags();
      return;
    }

    // If existing (saved in DB), mark for removal
    const loc = session.existing.find(l => l.name === name);
    if (loc && !session.toRemove.includes(loc.id)) {
      session.toRemove.push(loc.id);
    }
    renderLocTags();
  }

  function renderLocTags() {
    const container = document.getElementById('locTags');
    if (!session) {
      container.innerHTML = '';
      return;
    }

    const active = [
      ...session.existing.filter(l => !session.toRemove.includes(l.id)),
      ...session.toAdd.map(n => ({ id: null, name: n, isNew: true }))
    ];

    if (!active.length) {
      container.innerHTML =
        '<span class="loc-empty">No locations yet — type above and press Add or Enter</span>';
      return;
    }

    container.innerHTML = active.map(l => `
      <span class="loc-tag">
        ${esc(l.name)}
        ${l.isNew
          ? '<span style="font-size:10px;color:#27ae60;margin-left:3px">new</span>'
          : ''}
        <span class="rm" role="button" tabindex="0" data-name="${esc(l.name)}" title="Remove" aria-label="Remove ${esc(l.name)}">×</span>
      </span>`).join('');

    // Wire remove buttons — each binds to current session name only
    container.querySelectorAll('.rm').forEach(btn => {
      const locName = btn.dataset.name;
      btn.addEventListener('click', () => removePendingLocation(locName));
    });
  }

  // ================================================================
  // SAVE — uses a snapshot of the session at click time
  // ================================================================
  async function onSave() {
    // Grab and validate session
    if (!session || session.saving) return;

    const name  = document.getElementById('fName').value.trim();
    const type  = document.getElementById('fType').value;
    const notes = document.getElementById('fNotes').value.trim();
    const editId = session.editId;

    if (!name) { toast('Name is required', 'error'); return; }

    // Lock this session against double-submit
    session.saving = true;

    // SNAPSHOT: copy location arrays right now, before any async
    const locsToAdd    = session.toAdd.slice();     // copy
    const locsToRemove = session.toRemove.slice();  // copy

    const btn = document.getElementById('btnSave');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      // 1. Save provider record
      let providerId;
      try {
        const res = await window.pmp.providers.save({
          id:    editId,
          name,
          type,
          place: null,
          notes: notes || null,
          active: 1
        });

        if (editId) {
          providerId = editId;
        } else {
          if (!res || !res.id) throw new Error('No ID returned: ' + JSON.stringify(res));
          providerId = res.id;
        }
      } catch (saveErr) {
        const msg = saveErr.message || String(saveErr);
        if (msg.includes('DUPLICATE_NAME_TYPE') ||
            msg.includes('UNIQUE') ||
            msg.includes('unique')) {
          toast(
            `A ${type === 'space' ? 'Space' : 'Location'} provider named "${name}" already exists.`,
            'error'
          );
        } else {
          toast('Save failed: ' + msg, 'error');
        }
        return;
      }

      // 2. Remove locations
      for (const lid of locsToRemove) {
        try { await window.pmp.locations.remove(lid); }
        catch (err) { console.error('Remove location', lid, 'failed:', err.message); }
      }

      // 3. Add locations — use the SNAPSHOT, not session (which may have changed)
      let added  = 0;
      let failed = 0;
      for (const locName of locsToAdd) {
        try {
          const r = await window.pmp.locations.add(providerId, locName);
          if (r && r.ok) added++;
          else { failed++; toast(`"${locName}" was not saved (duplicate?)`, 'info'); }
        } catch (err) {
          failed++;
          toast(`Location "${locName}" failed: ${err.message || err}`, 'error');
        }
      }

      // 4. Done
      let msg = editId ? 'Provider updated' : 'Provider added';
      if (added  > 0) msg += ` with ${added} location${added > 1 ? 's' : ''}`;
      if (failed > 0) msg += ` (${failed} location${failed > 1 ? 's' : ''} failed)`;
      toast(msg, failed > 0 ? 'info' : 'success');

      closeModal();
      await load();

    } catch (err) {
      toast('Unexpected error: ' + (err.message || err), 'error');
      if (session) session.saving = false;
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Provider';
    }
  }

  // ================================================================
  // DELETE
  // ================================================================
  async function onDelete(id) {
    const r = allRows.find(x => x.id === id);
    if (!r) return;
    const ok = await confirmDialog({
      title: 'Delete Provider',
      message: `Delete "${r.name}"? Linked records will be preserved.`,
      confirmText: 'Delete', danger: true
    });
    if (!ok) return;
    try {
      await window.pmp.providers.remove(id);
      toast('Provider deleted', 'success');
      await load();
    } catch (err) {
      toast('Delete failed: ' + (err.message || err), 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
