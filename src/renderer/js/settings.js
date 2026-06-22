// ================================================================
// settings.js — settings page logic (with Services Catalog + Users tabs)
// ================================================================
(function () {
  const isBrowser = window.pmp && window.pmp.__transport === 'http';
  let currentUser = null;
  let lanState    = null;

  const CATEGORIES = ['live', 'package', 'space', 'crew'];
  const CAT_LABELS = { live:'Live', package:'Package', space:'Space', crew:'Crew' };

  // ================================================================
  // PERMISSIONS REFERENCE DATA
  // Single source of truth lives in api.js (window.PERM_MATRIX); the table
  // and the per-user override grid below are built from it.
  // ================================================================
  const PERM_ROWS = window.PERM_MATRIX;

  const ROLE_META = {
    admin:       { label:'Admin',       color:'#1a3a5c', bg:'#eaf0fb' },
    manager:     { label:'Manager',     color:'#148f77', bg:'#e8f8f5' },
    coordination:{ label:'Coordination',color:'#d97706', bg:'#fef3c7' },
    accountant:  { label:'Accountant',  color:'#7c3aed', bg:'#f3f0ff' },
    user:        { label:'User',        color:'#6b7280', bg:'#f4f6f8' }
  };

  // ================================================================
  // USERS STATE
  // ================================================================
  let allUsers    = [];
  let userSession = null;   // { editId, saving }

  async function init() {
    currentUser = await initChrome({ page: 'settings', title: 'Settings' });
    if (!currentUser) return;

    // Settings tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // General tab
    document.getElementById('btnChangePwd').addEventListener('click', onChangePassword);

    if (currentUser.must_change_pwd) {
      switchTab('general');
      const banner = document.createElement('div');
      banner.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:12px 16px;margin-bottom:16px;color:#92400e;font-size:13px;font-weight:600';
      banner.textContent = 'You must change your password before continuing. Please use the form below.';
      const pwdSection = document.getElementById('btnChangePwd');
      if (pwdSection && pwdSection.parentNode) pwdSection.parentNode.insertBefore(banner, pwdSection);
      // Stop here: every other section's loader hits the MUST_CHANGE_PASSWORD gate.
      // Only the change-password form (wired above) is usable until the pwd is changed.
      return;
    }

    if (isBrowser) {
      document.getElementById('browserNotice').style.display = 'block';
      disableLanControls();
      // Show LAN info + QR code in read-only mode for browser-mode admins
      if (hasPerm(currentUser, 'manageSettings')) await loadLanStatus();
    } else if (!hasPerm(currentUser, 'manageSettings')) {
      disableLanControls('Admin access required');
    } else {
      document.getElementById('btnSavePort').addEventListener('click', onSavePort);
      document.getElementById('btnToggleLan').addEventListener('click', onToggleLan);
      await loadLanStatus();
    }

    // Import tab
    if (isBrowser || !hasPerm(currentUser, 'importData')) {
      const cardImport = document.getElementById('cardImport');
      if (cardImport) cardImport.style.display = 'none';
    } else {
      document.getElementById('btnImport').addEventListener('click', onImportExcel);
      const btnClean = document.getElementById('btnCleanDuplicates');
      if (btnClean) btnClean.addEventListener('click', onCleanDuplicates);
    }

    if (hasPerm(currentUser, 'manageSettings')) {
      loadAuditLog();
      const btnBackupNow = document.getElementById('btnBackupNow');
      if (btnBackupNow) btnBackupNow.addEventListener('click', onBackupNow);
      loadBackups();
    } else {
      const cardAudit = document.getElementById('cardAudit');
      if (cardAudit) cardAudit.style.display = 'none';
      const cardBackup = document.getElementById('cardBackup');
      if (cardBackup) cardBackup.style.display = 'none';
    }

    // Services catalog tab
    if (hasPerm(currentUser, 'manageCatalog')) {
      await loadCatalog();
    } else {
      const stabServices = document.getElementById('stab-services');
      if (stabServices) stabServices.innerHTML =
        '<p style="color:#95a5a6;font-size:13px;padding:20px 0">You do not have permission to manage services.</p>';
    }

    // Users tab — admin sees full user management; others see only their own profile
    // Company tab — admin only
    const stabBtnCompany = document.getElementById('stabBtnCompany');
    if (hasPerm(currentUser, 'manageSettings')) {
      if (stabBtnCompany) stabBtnCompany.classList.remove('pmp-hidden');
      await loadCompanySettings();
      const btnSaveCompany = document.getElementById('btnSaveCompany');
      if (btnSaveCompany) btnSaveCompany.addEventListener('click', onSaveCompanySettings);
    }

    if (hasPerm(currentUser, 'manageUsers')) {
      // Admin: also show My Account for name + password in Users tab
      const cardMyAccount = document.getElementById('cardMyAccount');
      if (cardMyAccount) {
        cardMyAccount.style.display = 'block';
        document.getElementById('myUsername').value = currentUser.username;
        document.getElementById('myFullName').value = currentUser.full_name || '';
      }
      document.getElementById('btnSaveProfile').addEventListener('click', onSaveProfile);
      document.getElementById('btnChangePwdAccount').addEventListener('click', onChangePasswordAccount);
      initPermTable();
      document.getElementById('permToggle').addEventListener('click', togglePermTable);
      await loadUsers();
      document.getElementById('btnAddUser').style.display = 'inline-block';
      document.getElementById('btnAddUser').addEventListener('click', () => openUserModal(null));
      document.getElementById('btnSaveUser').addEventListener('click', onSaveUser);
      document.getElementById('btnCancelUser').addEventListener('click', closeUserModal);
      document.getElementById('uResetChk').addEventListener('change', function() {
        document.getElementById('uNewPwd').style.display = this.checked ? 'block' : 'none';
      });
      document.getElementById('userModal').addEventListener('click', function(e) {
        if (e.target === this) closeUserModal();
      });
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          const modal = document.getElementById('userModal');
          if (modal && modal.classList.contains('active')) closeUserModal();
        }
      });
      document.getElementById('uRole').addEventListener('change', function() {
        const permWrap = document.getElementById('uPermWrap');
        const newRole  = this.value;
        if (permWrap && newRole !== 'admin') {
          permWrap.style.display = 'block';
          buildPermGrid();
          applyPermState(newRole, null);
        } else if (permWrap) {
          permWrap.style.display = 'none';
        }
      });
    } else {
      // Hide admin-only sections, show My Account card
      const cardPermRef = document.getElementById('cardPermRef');
      const cardUsers   = document.getElementById('cardUsers');
      if (cardPermRef) cardPermRef.style.display = 'none';
      if (cardUsers)   cardUsers.style.display   = 'none';
      const cardMyAccount = document.getElementById('cardMyAccount');
      if (cardMyAccount) {
        cardMyAccount.style.display = 'block';
        document.getElementById('myUsername').value  = currentUser.username;
        document.getElementById('myFullName').value  = currentUser.full_name || '';
      }
      document.getElementById('btnSaveProfile').addEventListener('click', onSaveProfile);
      document.getElementById('btnChangePwdAccount').addEventListener('click', onChangePasswordAccount);
    }
  }

  // ---- Tab switching ----
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c =>
      c.classList.toggle('active', c.id === 'stab-' + name));
  }

  // ---- LAN controls ----
  function disableLanControls(msg) {
    ['lanPort','btnSavePort','btnToggleLan'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
    if (msg) {
      const el = document.getElementById('lanStatusText');
      if (el) el.textContent = msg;
    }
  }

  async function loadLanStatus() {
    try {
      const s = await window.pmp.sys.lanStatus();
      renderLanStatus(s);
    } catch (err) { toast('Failed to load network status: ' + (err.message || err), 'error'); }
  }

  function renderLanStatus(s) {
    lanState = s;
    const dot = document.getElementById('lanDot');
    const txt = document.getElementById('lanStatusText');
    const btn = document.getElementById('btnToggleLan');
    const portInput = document.getElementById('lanPort');
    const qrRow = document.getElementById('qrRow');
    const qrImg = document.getElementById('qrImage');
    if (!dot) return;

    if (s.running) {
      dot.className   = 'status-dot status-on';
      txt.textContent = `Active on port ${s.port}`;
      btn.textContent = 'Disable LAN Access';
      btn.className   = 'btn btn-toggle-off';
      if (qrRow) qrRow.style.display = 'flex';
      loadQrCode(s.port);
    } else {
      dot.className   = 'status-dot status-off';
      txt.textContent = 'Disabled';
      btn.textContent = 'Enable LAN Access';
      btn.className   = 'btn btn-toggle-on';
      if (qrRow) qrRow.style.display = 'none';
      if (qrImg) qrImg.src = '';
    }
    portInput.value = s.port || 3000;

    if (s.addresses && s.addresses.length) {
      document.getElementById('lanIps').innerHTML =
        s.addresses.map(ip =>
          `<div><a href="http://${ip}:${s.port}" target="_blank">http://${ip}:${s.port}</a></div>`
        ).join('');
    }
  }

  async function loadQrCode(port) {
    const qrImg = document.getElementById('qrImage');
    if (!qrImg) return;
    try {
      if (isBrowser) {
        // In browser mode, fetch the QR image from the server directly
        qrImg.src = `/api/sys/qrcode?port=${port}&t=${Date.now()}`;
      } else {
        // In Electron mode, use IPC to get the data URL
        const res = await window.pmp.sys.qrcode();
        if (res && res.ok && res.dataUrl) {
          qrImg.src = res.dataUrl;
        }
      }
    } catch (err) {
      console.error('QR load failed:', err);
    }
  }

  async function onToggleLan() {
    if (!lanState) return;
    try {
      const newState = await window.pmp.sys.lanToggle({ enabled: !lanState.running, port: lanState.port });
      renderLanStatus(newState);
      toast(newState.running ? 'LAN access enabled' : 'LAN access disabled', 'success');
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  async function onSavePort() {
    const port = Number(document.getElementById('lanPort').value);
    if (!port || port < 1024 || port > 65535) {
      toast('Port must be between 1024 and 65535', 'error'); return;
    }
    try {
      const newState = await window.pmp.sys.lanToggle({ enabled: !!(lanState && lanState.running), port });
      renderLanStatus(newState);
      toast('Port saved', 'success');
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ---- Change password ----
  async function onChangePassword() {
    const oldP  = document.getElementById('oldPwd').value;
    const newP  = document.getElementById('newPwd').value;
    const newP2 = document.getElementById('newPwd2').value;
    if (!oldP || !newP)  { toast('Please fill in all fields', 'error'); return; }
    if (newP !== newP2)  { toast('Passwords do not match', 'error');    return; }
    if (newP.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    try {
      const res = await window.pmp.auth.changePassword(oldP, newP);
      if (res && res.ok) {
        toast('Password changed successfully', 'success');
        ['oldPwd','newPwd','newPwd2'].forEach(id => document.getElementById(id).value = '');
      } else {
        toast((res && res.error) || 'Failed to change password', 'error');
      }
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ---- My Account (non-admin profile edit) ----
  async function onSaveProfile() {
    const name = document.getElementById('myFullName').value.trim();
    try {
      await window.pmp.users.updateSelf({ full_name: name });
      currentUser.full_name = name;
      document.getElementById('spanUser').textContent = name || currentUser.username;
      toast('Name updated', 'success');
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  async function onChangePasswordAccount() {
    const oldP  = document.getElementById('myOldPwd').value;
    const newP  = document.getElementById('myNewPwd').value;
    const newP2 = document.getElementById('myNewPwd2').value;
    if (!oldP || !newP)  { toast('Please fill in all fields', 'error'); return; }
    if (newP !== newP2)  { toast('Passwords do not match', 'error');    return; }
    if (newP.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    try {
      const res = await window.pmp.auth.changePassword(oldP, newP);
      if (res && res.ok) {
        toast('Password changed', 'success');
        ['myOldPwd','myNewPwd','myNewPwd2'].forEach(id => document.getElementById(id).value = '');
      } else {
        toast((res && res.error) || 'Failed to change password', 'error');
      }
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ================================================================
  // SERVICES CATALOG
  // ================================================================
  let catalogData = {};   // { live: [{id,name},...], package: [...], ... }

  async function loadCatalog() {
    try {
      const all = await window.pmp.catalog.list() || [];
      catalogData = {};
      CATEGORIES.forEach(cat => {
        catalogData[cat] = all.filter(r => r.category === cat);
      });
      renderCatalog();
    } catch (err) {
      toast('Failed to load services catalog: ' + (err.message || err), 'error');
    }
  }

  function renderCatalog() {
    const container = document.getElementById('catalogContainer');
    if (!container) return;

    container.innerHTML = CATEGORIES.map(cat => `
      <div class="cat-section">
        <div class="cat-header">
          <h4>${CAT_LABELS[cat]}</h4>
          <span style="font-size:11px;color:#95a5a6">${(catalogData[cat] || []).length} services</span>
        </div>
        <div class="cat-add-row">
          <input class="field-input" id="newSvc_${cat}" placeholder="Add a new ${CAT_LABELS[cat]} service..." maxlength="80">
          <button class="btn btn-add" onclick="window._addService('${cat}')" style="height:32px;padding:0 14px;font-size:12px">＋ Add</button>
        </div>
        <div class="service-tags" id="tags_${cat}">
          ${renderTags(cat)}
        </div>
      </div>
    `).join('<hr style="border:none;border-top:1px solid #ecf0f1;margin:4px 0 18px">');

    // Wire keydown for each input
    CATEGORIES.forEach(cat => {
      const inp = document.getElementById(`newSvc_${cat}`);
      if (inp) inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') window._addService(cat);
      });
    });

    // Wire delete buttons (event delegation per tag container)
    CATEGORIES.forEach(cat => {
      const el = document.getElementById(`tags_${cat}`);
      if (el) el.addEventListener('click', (e) => {
        const btn = e.target.closest('.del-tag');
        if (btn) removeService(Number(btn.dataset.id), cat);
      });
    });
  }

  function renderTags(cat) {
    const items = catalogData[cat] || [];
    if (!items.length) return '<span style="color:#95a5a6;font-size:12px;font-style:italic">No services yet</span>';
    return items.map(s =>
      `<span class="service-tag">
        ${esc(s.name)}
        <span class="del-tag" role="button" tabindex="0" data-id="${s.id}" title="Remove" aria-label="Remove ${esc(s.name)}">×</span>
      </span>`
    ).join('');
  }

  // Exposed globally so inline onclick works
  window._addService = async function (cat) {
    const inp  = document.getElementById(`newSvc_${cat}`);
    const name = inp ? inp.value.trim() : '';
    if (!name) { toast('Enter a service name', 'error'); return; }
    try {
      await window.pmp.catalog.add({ category: cat, name });
      if (inp) inp.value = '';
      toast(`"${name}" added to ${CAT_LABELS[cat]}`, 'success');
      await loadCatalog();
    } catch (err) {
      toast('Failed: ' + (err.message || err), 'error');
    }
  };

  async function removeService(id, cat) {
    const item = (catalogData[cat] || []).find(s => s.id === id);
    if (!item) return;
    const ok = await confirmDialog({
      title: 'Remove Service',
      message: `Remove "${item.name}" from ${CAT_LABELS[cat]}?`,
      confirmText: 'Remove', danger: true
    });
    if (!ok) return;
    try {
      await window.pmp.catalog.remove(id);
      toast('Service removed', 'success');
      await loadCatalog();
    } catch (err) { toast('Failed: ' + (err.message || err), 'error'); }
  }

  // ================================================================
  // IMPORT / AUDIT
  // ================================================================
  async function onCleanDuplicates() {
    const btn = document.getElementById('btnCleanDuplicates');
    const ok = await confirmDialog({
      title: 'Remove Duplicate Orders',
      message: 'This will find orders with the same Date + Client + Service + Start Time and delete all but the first (oldest). This cannot be undone.',
      confirmText: 'Remove Duplicates', danger: true
    });
    if (!ok) return;

    btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Cleaning...';
    try {
      const res = await window.pmp.sys.migrateCleanDuplicates();
      if (res && res.ok) {
        if (res.deleted > 0) {
          toast(`Removed ${res.deleted} duplicate order${res.deleted !== 1 ? 's' : ''}`, 'success');
        } else {
          toast('No duplicate orders found', 'info');
        }
        const reportBox = document.getElementById('importReport');
        if (reportBox) {
          reportBox.innerHTML = `<div style="color:#148f77;font-weight:600">
            ✅ Duplicate cleanup complete — ${res.deleted} record${res.deleted !== 1 ? 's' : ''} removed.
          </div>`;
          reportBox.style.display = 'block';
        }
      }
    } catch (err) {
      toast('Clean failed: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  }

  // Shows a modal when duplicate orders are detected.
  // Resolves to: 'overwrite' | 'skip' | 'cancel'
  function askDuplicateChoice(totalOrders, dupCount) {
    return new Promise(resolve => {
      const newCount = totalOrders - dupCount;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
      overlay.innerHTML = `
        <div style="background:#fff;border-radius:8px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.18)">
          <h3 style="margin:0 0 12px;color:#1a3a5c;font-size:16px">Duplicate Orders Detected</h3>
          <p style="margin:0 0 8px;color:#34495e;font-size:14px">
            <strong style="color:#b7770d">${dupCount}</strong> order${dupCount!==1?'s':''} in this file already exist in the database.
          </p>
          <p style="margin:0 0 20px;color:#5a6a7a;font-size:13px">
            New orders to add: <strong>${newCount}</strong><br>
            Already existing: <strong>${dupCount}</strong>
          </p>
          <p style="margin:0 0 20px;color:#34495e;font-size:13px">What would you like to do with the existing records?</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button id="_dupOverwrite" style="padding:9px 16px;background:#e67e22;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:600;text-align:left">
              Overwrite existing — update them with data from the file
            </button>
            <button id="_dupSkip" style="padding:9px 16px;background:#2980b9;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:600;text-align:left">
              Skip existing — only add the ${newCount} new order${newCount!==1?'s':''}
            </button>
            <button id="_dupCancel" style="padding:9px 16px;background:#ecf0f1;color:#5a6a7a;border:none;border-radius:5px;cursor:pointer;font-size:13px;text-align:left">
              Cancel — do not import anything
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const cleanup = choice => { overlay.remove(); resolve(choice); };
      overlay.querySelector('#_dupOverwrite').onclick = () => cleanup('overwrite');
      overlay.querySelector('#_dupSkip').onclick      = () => cleanup('skip');
      overlay.querySelector('#_dupCancel').onclick    = () => cleanup('cancel');
    });
  }

  async function onImportExcel() {
    const btn = document.getElementById('btnImport');
    const reportBox = document.getElementById('importReport');
    btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Reading file...';
    reportBox.style.display = 'none';
    try {
      // Step 1: Open file dialog + parse Excel (no DB writes yet)
      const res = await window.pmp.sys.migratePreview();
      if (!res)        { toast('Nothing was imported', 'info'); return; }
      if (res.canceled){ toast('Import cancelled', 'info');     return; }
      const rep = res.report;
      if (!rep) throw new Error('Report missing');

      // Step 2: If duplicates detected, ask the user what to do
      const dupCount = rep.counts.orders_duplicate || 0;
      let overwrite = false;
      if (dupCount > 0) {
        btn.disabled = false; // re-enable so UI doesn't feel frozen during modal
        const choice = await askDuplicateChoice(rep.counts.orders, dupCount);
        btn.disabled = true;
        if (choice === 'cancel') { toast('Import cancelled', 'info'); return; }
        overwrite = (choice === 'overwrite');
      }

      // Step 3: Commit — include source path, overwrite flag, and existing IDs
      btn.textContent = 'Saving...';
      const commitRes = await window.pmp.sys.migrateConfirm({
        ...rep.parsedData,
        _source:    rep.source,
        _overwrite: overwrite
      });
      if (!commitRes || !commitRes.ok) throw new Error('Commit failed');
      const cr = commitRes.report;

      const warnHtml = rep.warnings.length
        ? `<div style="color:#b7770d;margin-top:8px"><strong>⚠️ Warnings (${rep.warnings.length}):</strong><ul style="padding-left:18px;margin-top:4px">${rep.warnings.slice(0,20).map(w => `<li>${esc(w)}</li>`).join('')}${rep.warnings.length>20?`<li><em>...and ${rep.warnings.length-20} more</em></li>`:''}</ul></div>` : '';
      const errHtml = (cr.errors && cr.errors.length)
        ? `<div style="color:#c0392b;margin-top:8px"><strong>❌ Errors (${cr.errors.length}):</strong><ul style="padding-left:18px;margin-top:4px">${cr.errors.slice(0,20).map(e => `<li>${esc(String(e))}</li>`).join('')}${cr.errors.length>20?`<li><em>...and ${cr.errors.length-20} more</em></li>`:''}</ul></div>` : '';
      reportBox.innerHTML = `
        <div style="font-weight:600;color:#148f77;margin-bottom:10px">✅ Import completed successfully</div>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:3px 0">📇 Clients:</td><td><strong>${cr.clients}</strong></td></tr>
          <tr><td style="padding:3px 0">🔧 Providers:</td><td><strong>${cr.providers}</strong></td></tr>
          <tr><td style="padding:3px 0">📍 Locations added:</td><td><strong>${cr.locations || 0}</strong></td></tr>
          <tr><td style="padding:3px 0">📋 Orders imported:</td><td><strong>${cr.orders}</strong></td></tr>
          ${cr.orders_skipped ? `<tr><td style="padding:3px 0;color:#b7770d">↪ Orders skipped (already existed):</td><td><strong>${cr.orders_skipped}</strong></td></tr>` : ''}
        </table>${warnHtml}${errHtml}`;
      reportBox.style.display = 'block';
      toast(`Imported ${cr.orders} orders${cr.orders_skipped ? `, skipped ${cr.orders_skipped}` : ''}`, 'success');
    } catch (err) {
      toast('Import failed: ' + (err.message || err), 'error');
      document.getElementById('importReport').innerHTML =
        `<div style="color:#c0392b">${esc(err.message || err)}</div>`;
      document.getElementById('importReport').style.display = 'block';
    } finally { btn.disabled = false; btn.textContent = orig; }
  }

  async function loadAuditLog() {
    try {
      const log = await window.pmp.sys.auditLog();
      const el  = document.getElementById('auditLog');
      if (!log || !log.length) { el.textContent = '(No operations logged)'; return; }
      el.innerHTML = log.map(e => {
        const lvl   = e.level || 'INFO';
        const color = lvl === 'ERROR' ? '#c0392b' : lvl === 'WARN' ? '#b7770d' : '#5a6a7a';
        let detail = '';
        if (e.action === 'IMPORT' && e.details) {
          try {
            const d = JSON.parse(e.details);
            detail = ` — "${esc(d.file)}" · ${d.orders} orders, ${d.clients} clients`;
          } catch (_) { detail = ' — ' + esc(e.details); }
        }
        return `<div style="color:${color}"><strong>[${esc(lvl)}]</strong> ${esc(e.ts)} · ${esc(e.action)} · ${esc(e.entity||'')}${e.username?' · @'+esc(e.username):''}${detail}</div>`;
      }).join('');
    } catch (err) {
      const el = document.getElementById('auditLog');
      if (el) el.textContent = 'Error: ' + (err.message || err);
    }
  }

  // ================================================================
  // BACKUPS
  // ================================================================
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  async function loadBackups() {
    const el = document.getElementById('backupList');
    if (!el) return;
    try {
      const rows = await window.pmp.sys.backupList();
      if (!rows || !rows.length) { el.textContent = '(No backups yet)'; return; }
      const canRestore = !isBrowser; // restore is desktop-only
      el.innerHTML = rows.map(b => `
        <div style="display:flex;align-items:center;gap:10px;padding:4px 0;border-bottom:1px solid #e6eaee">
          <span style="flex:1;font-family:monospace">${esc(b.name)}</span>
          <span style="color:#95a5a6">${fmtBytes(b.size)}</span>
          ${canRestore ? `<button class="btn" style="height:26px;padding:0 10px;font-size:11px" data-restore="${esc(b.name)}">Restore</button>` : ''}
        </div>`).join('');
      if (canRestore) {
        el.querySelectorAll('[data-restore]').forEach(btn =>
          btn.addEventListener('click', () => onRestore(btn.dataset.restore)));
      }
    } catch (err) {
      el.textContent = 'Error: ' + (err.message || err);
    }
  }

  async function onBackupNow() {
    const btn = document.getElementById('btnBackupNow');
    if (btn) { btn.disabled = true; btn.textContent = 'Backing up...'; }
    try {
      await window.pmp.sys.backupNow();
      await loadBackups();
    } catch (err) {
      alert('Backup failed: ' + (err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Back Up Now'; }
    }
  }

  async function onRestore(name) {
    if (!confirm(`Restore from "${name}"?\n\nThis replaces the current database. A safety backup of the current data is taken first. The app will return to the login screen.`)) return;
    try {
      await window.pmp.sys.backupRestore(name);
      // The window is bounced to login by the main process after restore.
    } catch (err) {
      alert('Restore failed: ' + (err.message || err));
    }
  }

  // ================================================================
  // PERMISSIONS TABLE
  // ================================================================
  function initPermTable() {
    const tbody = document.getElementById('permTbody');
    if (!tbody) return;
    const chk = v => v
      ? '<span style="color:#27ae60;font-weight:700;font-size:14px">✓</span>'
      : '<span style="color:#e2e8f0;font-size:13px">—</span>';
    tbody.innerHTML = PERM_ROWS.map((r, i) => `
      <tr style="border-bottom:1px solid #f0f3f7;background:${i%2===0?'#fff':'#fafbfc'}">
        <td style="padding:6px 10px;color:#34495e">${esc(r.label)}</td>
        <td style="padding:6px 8px;text-align:center">${chk(r.admin)}</td>
        <td style="padding:6px 8px;text-align:center">${chk(r.manager)}</td>
        <td style="padding:6px 8px;text-align:center">${chk(r.coordination)}</td>
        <td style="padding:6px 8px;text-align:center">${chk(r.accountant)}</td>
        <td style="padding:6px 8px;text-align:center">${chk(r.user)}</td>
      </tr>`).join('');
  }

  let _permVisible = true;
  function togglePermTable() {
    _permVisible = !_permVisible;
    document.getElementById('permTableWrap').style.display = _permVisible ? 'block' : 'none';
    document.getElementById('permArrow').textContent = _permVisible ? '▲ hide' : '▼ show';
  }

  // ================================================================
  // PERMISSIONS GRID IN MODAL
  // ================================================================
  function buildPermGrid() {
    const grid = document.getElementById('uPermGrid');
    if (!grid) return;
    grid.innerHTML = PERM_ROWS.map(r => `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:#34495e">
        <input type="checkbox" class="perm-chk" data-key="${r.key}" style="width:14px;height:14px;margin:0">
        ${esc(r.label)}
      </label>
    `).join('');
  }

  function getPermDefaults(role) {
    // Defaults are derived from the shared matrix in api.js.
    return { ...(window.PERM_DEFAULTS[role] || window.PERM_DEFAULTS.user) };
  }

  function readPermState(role) {
    const defs = getPermDefaults(role);
    const custom = {};
    document.querySelectorAll('.perm-chk').forEach(chk => {
      const key = chk.dataset.key;
      const isChecked = chk.checked;
      if (isChecked !== defs[key]) {
        custom[key] = isChecked;
      }
    });
    return Object.keys(custom).length ? custom : null;
  }

  function applyPermState(role, storedPerms) {
    const defs = getPermDefaults(role);
    let custom = {};
    if (storedPerms) {
      try {
        custom = typeof storedPerms === 'string' ? JSON.parse(storedPerms) : storedPerms;
      } catch (_) {}
    }
    document.querySelectorAll('.perm-chk').forEach(chk => {
      const key = chk.dataset.key;
      chk.checked = custom.hasOwnProperty(key) ? !!custom[key] : !!defs[key];
    });
  }

  // ================================================================
  // USERS LIST
  // ================================================================
  function roleBadge(role) {
    const m = ROLE_META[role] || ROLE_META.user;
    return `<span style="display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;color:${m.color};background:${m.bg}">${m.label}</span>`;
  }

  async function loadUsers() {
    try {
      allUsers = await window.pmp.users.list() || [];
      renderUsers();
    } catch (err) {
      document.getElementById('usersEmpty').style.display = 'block';
      document.getElementById('usersEmpty').textContent = 'Error: ' + (err.message || err);
    }
  }

  function renderUsers() {
    const tbody   = document.getElementById('usersTblBody');
    const empty   = document.getElementById('usersEmpty');
    const isAdmin = hasPerm(currentUser, 'manageUsers');
    if (!allUsers.length) { empty.style.display = 'block'; tbody.innerHTML = ''; return; }
    empty.style.display = 'none';
    tbody.innerHTML = allUsers.map((u, i) => `
      <tr style="border-bottom:1px solid #f0f3f7;${!u.active?'opacity:.55':''}">
        <td style="padding:7px 10px;color:#95a5a6;font-size:11px">${i+1}</td>
        <td style="padding:7px 10px;font-weight:600;color:#2c3e50">${esc(u.full_name || '—')}</td>
        <td style="padding:7px 10px;color:#5a6a7a;font-family:monospace;font-size:11px">${esc(u.username)}</td>
        <td style="padding:7px 10px">${roleBadge(u.role)}</td>
        <td style="padding:7px 10px">
          <span style="font-size:11px;font-weight:600;color:${u.active?'#27ae60':'#e74c3c'}">${u.active?'Active':'Inactive'}</span>
        </td>
        <td style="padding:7px 10px;color:#95a5a6;font-size:11px">${u.last_login ? u.last_login.slice(0,16).replace('T',' ') : '—'}</td>
        <td style="padding:7px 10px;text-align:right">
          ${isAdmin ? `
            <button class="btn btn-edit" data-id="${u.id}" style="font-size:11px;padding:3px 10px;margin-right:4px">Edit</button>
            ${u.id !== currentUser.id ? `<button class="btn btn-del" data-id="${u.id}" style="font-size:11px;padding:3px 10px">Delete</button>` : ''}
          ` : ''}
        </td>
      </tr>`).join('');

    if (isAdmin) {
      tbody.querySelectorAll('.btn-edit').forEach(btn =>
        btn.addEventListener('click', () => openUserModal(Number(btn.dataset.id))));
      tbody.querySelectorAll('.btn-del').forEach(btn =>
        btn.addEventListener('click', () => onDeleteUser(Number(btn.dataset.id))));
    }
  }

  // ================================================================
  // USER MODAL
  // ================================================================
  function openUserModal(editId) {
    userSession = { editId: editId || null, saving: false };
    const isNew = !editId;

    document.getElementById('userModalTitle').textContent = isNew ? 'Add User' : 'Edit User';
    document.getElementById('uId').value       = editId || '';
    document.getElementById('uPwdWrap').style.display   = isNew  ? 'block' : 'none';
    document.getElementById('uResetWrap').style.display = !isNew ? 'block' : 'none';
    document.getElementById('uResetChk').checked        = false;
    document.getElementById('uNewPwd').style.display    = 'none';
    document.getElementById('uNewPwd').value            = '';
    document.getElementById('uPwd').value               = '';

    const isAdmin = hasPerm(currentUser, 'manageUsers') && currentUser.role === 'admin';
    const permWrap = document.getElementById('uPermWrap');

    if (isNew) {
      document.getElementById('uName').value     = '';
      document.getElementById('uUsername').value = '';
      document.getElementById('uRole').value     = 'user';
      document.getElementById('uActive').checked = true;
      document.getElementById('uUsername').readOnly = false;
      // Show permissions for non-admin target roles
      if (permWrap) { permWrap.style.display = isAdmin ? 'block' : 'none'; }
      if (isAdmin) { buildPermGrid(); applyPermState('user', null); }
    } else {
      const u = allUsers.find(x => x.id === editId);
      if (!u) return;
      document.getElementById('uName').value       = u.full_name || '';
      document.getElementById('uUsername').value   = u.username;
      document.getElementById('uRole').value       = u.role;
      document.getElementById('uActive').checked   = !!u.active;
      document.getElementById('uUsername').readOnly = true;
      // Hide permissions when editing an admin (admin always has full access)
      const targetIsAdmin = u.role === 'admin';
      if (permWrap) { permWrap.style.display = (isAdmin && !targetIsAdmin) ? 'block' : 'none'; }
      if (isAdmin && !targetIsAdmin) { buildPermGrid(); applyPermState(u.role, u.permissions); }
    }

    const modal = document.getElementById('userModal');
    modal.classList.add('active');
    setTimeout(() => document.getElementById('uName').focus(), 50);
  }

  function closeUserModal() {
    userSession = null;
    document.getElementById('userModal').classList.remove('active');
  }

  async function onSaveUser() {
    if (!userSession || userSession.saving) return;
    const isNew  = !userSession.editId;
    const name   = document.getElementById('uName').value.trim();
    const uname  = document.getElementById('uUsername').value.trim();
    const role   = document.getElementById('uRole').value;
    const active = document.getElementById('uActive').checked ? 1 : 0;

    if (!uname) { toast('Username is required', 'error'); return; }

    let password = null;
    if (isNew) {
      password = document.getElementById('uPwd').value;
      if (!password) { toast('Password is required', 'error'); return; }
      if (password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    } else {
      if (document.getElementById('uResetChk').checked) {
        password = document.getElementById('uNewPwd').value;
        if (!password) { toast('Enter the new password', 'error'); return; }
        if (password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
      }
    }

    userSession.saving = true;
    document.getElementById('btnSaveUser').disabled = true;
    document.getElementById('btnSaveUser').textContent = 'Saving...';

    const permissions = (currentUser.role === 'admin' && role !== 'admin') ? readPermState(role) : null;

    try {
      if (isNew) {
        await window.pmp.users.create({ username: uname, full_name: name, role, active, password, permissions });
        toast('User created', 'success');
      } else {
        const payload = { id: userSession.editId, full_name: name, role, active };
        if (password) payload.password = password;
        if (permissions !== undefined) payload.permissions = permissions;
        await window.pmp.users.update(payload);
        toast('User updated', 'success');
      }
      closeUserModal();
      await loadUsers();
    } catch (err) {
      toast('Error: ' + (err.message || err), 'error');
      userSession.saving = false;
    } finally {
      document.getElementById('btnSaveUser').disabled = false;
      document.getElementById('btnSaveUser').textContent = 'Save';
    }
  }

  async function onDeleteUser(id) {
    const u = allUsers.find(x => x.id === id);
    if (!u) return;
    if (id === currentUser.id) { toast('Cannot delete your own account', 'error'); return; }
    const ok = await confirmDialog({
      title: 'Delete User',
      message: `Delete user "${u.username}"? This cannot be undone.`,
      confirmText: 'Delete', danger: true
    });
    if (!ok) return;
    try {
      await window.pmp.users.remove(id);
      toast('User deleted', 'success');
      await loadUsers();
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ================================================================
  // COMPANY SETTINGS
  // ================================================================
  async function loadCompanySettings() {
    try {
      const data = await window.pmp.settings.getCompany();
      if (!data) return;
      const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
      set('cName',    data.company_name);
      set('cDept',    data.department_name);
      set('cAddress', data.company_address);
      set('cPhone',   data.company_phone);
      set('cEmail',   data.company_email);
      set('cMgrName', data.manager_name);
      set('cMgrTitle',data.manager_title);
    } catch (err) {
      toast('Failed to load company settings: ' + (err.message || err), 'error');
    }
  }

  async function onSaveCompanySettings() {
    const btn = document.getElementById('btnSaveCompany');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
      const get = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
      await window.pmp.settings.saveCompany({
        company_name:    get('cName'),
        department_name: get('cDept'),
        company_address: get('cAddress'),
        company_phone:   get('cPhone'),
        company_email:   get('cEmail'),
        manager_name:    get('cMgrName'),
        manager_title:   get('cMgrTitle')
      });
      toast('Company settings saved', 'success');
    } catch (err) {
      toast('Error: ' + (err.message || err), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Company Info'; }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
