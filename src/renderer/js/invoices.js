// ================================================================
// invoices.js — invoice generator page
// ================================================================
(function () {
  let currentUser   = null;
  let allOrders     = [];
  let selectedId    = null;
  let templatePath  = null;
  let templateName  = null;
  let _searchTimer  = null;

  const PREVIEW_FIELDS = [
    ['wo_internal','WO Internal'],['wo_client','WO Client'],['order_date','Date'],
    ['client_name','Client'],['service','Service'],['category','Category'],
    ['provider_name','Provider'],['place','Location'],['reporter','Reporter'],
    ['start_time','Start'],['end_time','End'],['duration','Duration'],
    ['currency','Currency'],['revenue','Revenue'],['cost','Cost'],['profit','Profit'],
    ['payment_status','Status'],['invoice_no','Invoice No.'],
    ['paid_amount','Paid'],['due_amount','Due']
  ];

  let ciData = null; // cached client invoice preview data
  let ciClients = []; // cached clients list for group display

  function initHowTo(toggleId, bodyId, arrowId, storageKey) {
    const toggle = document.getElementById(toggleId);
    const body   = document.getElementById(bodyId);
    const arrow  = document.getElementById(arrowId);
    if (!toggle || !body) return;
    const collapsed = localStorage.getItem(storageKey) === '1';
    body.style.display = collapsed ? 'none' : 'block';
    if (arrow) arrow.textContent = collapsed ? '▼' : '▲';
    toggle.addEventListener('click', () => {
      const isNowCollapsed = body.style.display !== 'none';
      body.style.display = isNowCollapsed ? 'none' : 'block';
      if (arrow) arrow.textContent = isNowCollapsed ? '▼' : '▲';
      localStorage.setItem(storageKey, isNowCollapsed ? '1' : '0');
    });
  }

  async function init() {
    currentUser = await initChrome({ page: 'invoices', title: 'Invoice Generator' });
    if (!currentUser) return;

    initHowTo('howToWordToggle',   'howToWordBody',   'howToWordArrow',   'pmp.howto.word');
    initHowTo('howToClientToggle', 'howToClientBody', 'howToClientArrow', 'pmp.howto.client');

    // Template area
    const drop = document.getElementById('templateDrop');
    const file  = document.getElementById('templateFile');
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => onFileSelected(file.files[0]));
    document.getElementById('tplClear').addEventListener('click', clearTemplate);

    drop.addEventListener('dragover',  (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) onFileSelected(f);
    });

    // Field chips
    loadFieldChips();

    // Order search — debounced so rapid keystrokes don't re-filter on every character
    document.getElementById('orderSearch').addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(renderOrderList, 150);
    });
    document.getElementById('filterStatus').addEventListener('change', renderOrderList);

    // Generate
    document.getElementById('btnGenerate').addEventListener('click', onGenerate);

  // Client invoice controls
  document.getElementById('ciPreviewBtn').addEventListener('click', onClientPreview);
  document.getElementById('ciGenerateBtn').addEventListener('click', onClientGenerate);
  document.getElementById('ciClient').addEventListener('change', () => {
    ciData = null;
    document.getElementById('ciPreviewBox').style.display = 'none';
    document.getElementById('ciGenerateBtn').disabled = true;
    updateGroupDisplay();
  });
  // Format radio buttons update button label
  document.querySelectorAll('input[name="ciFormat"]').forEach(r => {
    r.addEventListener('change', updateGenerateButtonLabel);
  });

    await loadOrders();
    await loadClientsForInvoice();
  }

  function updateGroupDisplay() {
    const sel = document.getElementById('ciClient');
    const groupBox = document.getElementById('ciGroupBox');
    const groupEl = document.getElementById('ciGroup');
    const clientId = Number(sel.value);
    if (!clientId) { groupBox.style.display = 'none'; return; }
    const client = ciClients.find(c => c.id === clientId);
    if (client && client.group_name) {
      groupEl.textContent = client.group_name;
      groupBox.style.display = 'block';
    } else {
      groupBox.style.display = 'none';
    }
  }

  function updateGenerateButtonLabel() {
    const fmt = document.querySelector('input[name="ciFormat"]:checked').value;
    const btn = document.getElementById('ciGenerateBtn');
    btn.textContent = fmt === 'word' ? '📄 Generate Invoice' : '📊 Generate Invoice';
  }

  // ---- Client invoice: load clients ----
  async function loadClientsForInvoice() {
    try {
      const clients = await window.pmp.clients.list() || [];
      ciClients = clients;
      const sel = document.getElementById('ciClient');
      sel.innerHTML = '<option value="">— Select Client —</option>' +
        clients.map(c => `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`).join('');
    } catch (err) { console.error('Failed to load clients:', err); }
  }

  // ---- Client invoice: preview orders ----
  async function onClientPreview() {
    const clientId = Number(document.getElementById('ciClient').value);
    if (!clientId) { toast('Please select a client', 'error'); return; }

    const btn = document.getElementById('ciPreviewBtn');
    btn.disabled = true; btn.textContent = '⏳ Loading...';

    try {
      const filters = {};
      const from = document.getElementById('ciFrom').value;
      const to   = document.getElementById('ciTo').value;
      if (from) filters.from = from;
      if (to)   filters.to = to;

      ciData = await window.pmp.invoices.clientData(clientId, filters);
      if (!ciData.orders.length) {
        toast('No orders found for this client in the selected date range', 'info');
        document.getElementById('ciPreviewBox').style.display = 'none';
        document.getElementById('ciGenerateBtn').disabled = true;
        return;
      }

      document.getElementById('ciCount').textContent = ciData.orders.length;
      document.getElementById('ciTotalCost').textContent = '$' + fmtNumber(ciData.totals.total_cost);

      const list = document.getElementById('ciOrderList');
      list.innerHTML = ciData.orders.map(o => `
        <div style="padding:6px 10px;border-bottom:1px solid #f0f4f8;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:600;color:#1a5276">${esc(o.wo_internal || 'WO-'+o.id)}</div>
            <div style="color:#7f8c8d">${fmtDate(o.order_date)} · ${esc(o.service || '')} · ${esc(o.reporter || '')}</div>
          </div>
          <div style="font-weight:600;color:#2c3e50">$${fmtNumber(o.cost || 0)}</div>
        </div>
      `).join('');

      document.getElementById('ciPreviewBox').style.display = 'block';
      document.getElementById('ciGenerateBtn').disabled = false;
    } catch (err) {
      toast('Preview failed: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false; btn.textContent = '🔍 Preview Orders';
    }
  }

  // ---- Client invoice: generate (Word or Excel) ----
  async function onClientGenerate() {
    if (!ciData || !ciData.orders.length) return;
    const btn = document.getElementById('ciGenerateBtn');
    btn.disabled = true; btn.textContent = '⏳ Generating...';

    try {
      const filters = {};
      const from = document.getElementById('ciFrom').value;
      const to   = document.getElementById('ciTo').value;
      if (from) filters.from = from;
      if (to)   filters.to = to;

      const format = document.querySelector('input[name="ciFormat"]:checked').value;
      const res = await window.pmp.invoices.generateClient(ciData.client.id, filters, format);
      if (res && res.ok) {
        toast(`Invoice saved: ${res.filePath.split(/[\\/]/).pop()}`, 'success');
      } else if (res && res.canceled) {
        toast('Generation canceled', 'info');
      }
    } catch (err) {
      toast('Generation failed: ' + (err.message || err), 'error');
    } finally {
      updateGenerateButtonLabel();
    }
  }

  // ---- Template handling ----
  function onFileSelected(file) {
    if (!file) return;
    if (!file.name.endsWith('.docx')) {
      toast('Please select a .docx Word document', 'error'); return;
    }
    // In Electron we can use file.path; in browser we store the File object
    templatePath = file.path || file;
    templateName = file.name;
    document.getElementById('templateDrop').style.display = 'none';
    document.getElementById('tplName').textContent = templateName;
    document.getElementById('templateLoaded').style.display = 'flex';
    updateGenerateBtn();
    toast(`Template loaded: ${templateName}`, 'success');
  }

  function clearTemplate() {
    templatePath = null; templateName = null;
    document.getElementById('templateDrop').style.display = '';
    document.getElementById('templateLoaded').style.display = 'none';
    document.getElementById('templateFile').value = '';
    updateGenerateBtn();
  }

  // ---- Available field chips ----
  async function loadFieldChips() {
    let fields = [];
    try { fields = await window.pmp.invoices.fields() || []; }
    catch (_) {
      fields = [
        { field:'wo_internal' },{ field:'wo_client' },{ field:'order_date' },
        { field:'client_name' },{ field:'service' },{ field:'category' },
        { field:'provider_name' },{ field:'place' },{ field:'reporter' },
        { field:'start_time' },{ field:'end_time' },{ field:'duration' },
        { field:'revenue' },{ field:'cost' },{ field:'profit' },
        { field:'currency' },{ field:'payment_status' },{ field:'invoice_no' },
        { field:'paid_amount' },{ field:'due_amount' },{ field:'notes' },
        { field:'generated_date' },{ field:'generated_time' }
      ];
    }
    const container = document.getElementById('fieldChips');
    container.innerHTML = fields.map(f =>
      `<span class="field-chip" data-field="{{${f.field}}}" title="${f.label || f.field}">{{${f.field}}}</span>`
    ).join('');
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.field-chip');
      if (!chip) return;
      navigator.clipboard.writeText(chip.dataset.field).catch(() => {});
      toast(`Copied: ${chip.dataset.field}`, 'info');
    });
  }

  // ---- Orders list ----
  async function loadOrders() {
    try {
      allOrders = await window.pmp.orders.list({ limit: 200 }) || [];
      renderOrderList();
    } catch (err) { toast('Failed to load orders: ' + (err.message || err), 'error'); }
  }

  function renderOrderList() {
    const term   = (document.getElementById('orderSearch').value || '').toLowerCase().trim();
    const status = document.getElementById('filterStatus').value;
    let rows = allOrders;
    if (status) rows = rows.filter(r => r.payment_status === status);
    if (term)   rows = rows.filter(r =>
      (r.wo_internal  || '').toLowerCase().includes(term) ||
      (r.client_name  || '').toLowerCase().includes(term) ||
      (r.service      || '').toLowerCase().includes(term) ||
      (r.place        || '').toLowerCase().includes(term)
    );

    const list = document.getElementById('orderList');
    if (!rows.length) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:#95a5a6;font-size:12px">No orders found</div>';
      return;
    }
    list.innerHTML = rows.map(r => `
      <div class="order-item ${r.id === selectedId ? 'selected' : ''}" data-id="${r.id}">
        <div class="oi-wo">${esc(r.wo_internal || 'WO-'+r.id)}</div>
        <div class="oi-meta">
          ${esc(r.client_name || '')} — ${esc(r.service || '')}
          &nbsp;·&nbsp; ${fmtDate(r.order_date)}
          &nbsp;·&nbsp; <span class="badge ${badgeClass(r.payment_status)}">${esc(r.payment_status||'')}</span>
        </div>
      </div>`).join('');

    list.querySelectorAll('.order-item').forEach(item => {
      item.addEventListener('click', () => selectOrder(Number(item.dataset.id)));
    });
  }

  async function selectOrder(id) {
    selectedId = id;
    renderOrderList(); // refresh selection highlight

    try {
      const data = await window.pmp.invoices.preview(id);
      renderPreview(data);
    } catch (err) {
      toast('Failed to load order data: ' + (err.message || err), 'error');
    }
    updateGenerateBtn();
  }

  function renderPreview(data) {
    document.getElementById('previewEmpty').style.display   = 'none';
    document.getElementById('previewSection').style.display = '';

    const grid = document.getElementById('previewGrid');
    grid.innerHTML = PREVIEW_FIELDS.map(([key, label]) => {
      const val = data[key] || '—';
      const mono = ['wo_internal','wo_client','revenue','cost','profit','paid_amount','due_amount'].includes(key);
      return `<div class="pv-field">
        <div class="pv-label">${label}</div>
        <div class="pv-value ${mono ? 'mono' : ''}">${esc(val)}</div>
      </div>`;
    }).join('');
  }

  function updateGenerateBtn() {
    const ready = !!(templatePath && selectedId);
    document.getElementById('btnGenerate').disabled = !ready;
    const statusEl = document.getElementById('generateStatus');
    if (!templatePath && !selectedId) statusEl.textContent = 'Select a template and an order.';
    else if (!templatePath)           statusEl.textContent = 'Upload a .docx template.';
    else if (!selectedId)             statusEl.textContent = 'Select an order from the list.';
    else                              statusEl.textContent = 'Ready — click Generate to create the invoice.';
  }

  // ---- Generate ----
  async function onGenerate() {
    if (!templatePath || !selectedId) return;
    const btn = document.getElementById('btnGenerate');
    btn.disabled = true; btn.textContent = '⏳ Generating...';

    try {
      const order = allOrders.find(r => r.id === selectedId);
      const suggestedName = `Invoice_${order ? (order.wo_internal || order.id) : selectedId}.docx`;

      if (window.pmp.__transport === 'http') {
        // Browser mode: download via fetch
        await _generateBrowser(suggestedName);
      } else {
        // Electron mode: use file dialog
        await _generateElectron(suggestedName);
      }
    } catch (err) {
      toast('Generation failed: ' + (err.message || err), 'error');
    } finally {
      btn.disabled = false; btn.textContent = '⚡ Generate Invoice';
    }
  }

  async function _generateElectron(suggestedName) {
    // Ask user where to save
    const { dialog } = window.pmp.__electron || {};
    let outputPath;
    if (dialog) {
      const result = await dialog.showSaveDialog({ defaultPath: suggestedName, filters: [{ name:'Word', extensions:['docx'] }] });
      if (result.canceled) return;
      outputPath = result.filePath;
    } else {
      // Fallback: save to desktop
      const userDataPath = await window.pmp.sys.userDataPath();
      outputPath = `${userDataPath}/${suggestedName}`;
    }

    const res = await window.pmp.invoices.fill(templatePath, selectedId, outputPath);
    if (res && res.ok) {
      toast(`Invoice saved: ${outputPath.split(/[\\/]/).pop()}`, 'success');
      // Try to open the file
      try { window.pmp.shell.openPath(outputPath); } catch (_) {}
    }
  }

  async function _generateBrowser(suggestedName) {
    const file = templatePath;
    if (!(file instanceof File)) { toast('Template file not available', 'error'); return; }

    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Failed to read template file'));
      reader.readAsDataURL(file);
    });

    const res = await fetch('/api/invoices/generate', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateBase64: base64, orderId: selectedId })
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || String(res.status));
    }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = suggestedName;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Invoice downloaded: ' + suggestedName, 'success');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
