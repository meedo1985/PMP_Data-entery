// ================================================================
// pricing.js — pricing admin page
// ================================================================
(function () {
  let currentUser = null;
  let clients = [], providers = [];
  let defaults = [], cliRates = [], prvCosts = [];
  let selClientId = null, selProviderId = null;
  // catalog[category] = ['Service A', 'Service B', ...]
  let catalog = {};

  const PER_MINUTE_CATS = new Set(['live', 'space']);

  const LIVE_TYPES = [
    { value: 'base15', label: 'Base 15 min' },
    { value: 'per5', label: 'Per 5 min' },
    { value: 'flat30', label: 'Flat 30 min' },
    { value: 'flat60', label: 'Flat 60 min' },
    { value: 'special', label: 'Special' }
  ];

  const CREW_TYPES = [
    { value: 'full_day', label: 'Full Day (8h)' },
    { value: 'half_day', label: 'Half Day (4h)' },
    { value: 'special', label: 'Special' }
  ];

  const SPACE_TYPES = [
    { value: null, label: 'Per Minute' }
  ];

  const PACKAGE_TYPES = [
    { value: null, label: 'Flat' }
  ];

  const TYPE_MAP = {
    live: LIVE_TYPES,
    crew: CREW_TYPES,
    space: SPACE_TYPES,
    package: PACKAGE_TYPES
  };

  async function init() {
    currentUser = await initChrome({ page: 'pricing', title: 'Pricing Management' });
    if (!currentUser) return;
    if (!hasPerm(currentUser, 'managePricing')) {
      toast('Insufficient permissions', 'error');
      setTimeout(() => window.pmp.nav.goto('dashboard'), 1000);
      return;
    }

    document.querySelectorAll('.tab').forEach(t =>
      t.addEventListener('click', () => switchTab(t.dataset.tab))
    );

    // Load catalog for service dropdowns
    const allServices = await window.pmp.catalog.list();
    allServices.forEach(s => {
      if (!catalog[s.category]) catalog[s.category] = [];
      catalog[s.category].push(s.name);
    });

    // Default tab
    document.getElementById('defCat').addEventListener('change', () => {
      const cat = document.getElementById('defCat').value;
      fillTypes('defType', cat);
      fillServices('defService', cat);
      updatePriceLabel('defPriceLabel', cat);
    });
    document.getElementById('defType').addEventListener('change', () => {
      updatePriceLabel('defPriceLabel', document.getElementById('defCat').value);
    });
    document.getElementById('btnAddDef').addEventListener('click', onAddDefault);
    document.getElementById('defList').addEventListener('click', e => {
      const btn = e.target.closest('.btn-del');
      if (btn) onDeleteDefault(Number(btn.dataset.id));
    });
    fillTypes('defType', 'live');
    fillServices('defService', 'live');
    updatePriceLabel('defPriceLabel', 'live');

    // Client tab
    document.getElementById('cliCat').addEventListener('change', () => {
      const cat = document.getElementById('cliCat').value;
      fillTypes('cliType', cat);
      fillServices('cliService', cat);
      updatePriceLabel('cliPriceLabel', cat);
    });
    document.getElementById('cliType').addEventListener('change', () => {
      updatePriceLabel('cliPriceLabel', document.getElementById('cliCat').value);
    });
    document.getElementById('btnAddCli').addEventListener('click', onAddClientRate);
    document.getElementById('clientSel').addEventListener('change', async e => {
      selClientId = Number(e.target.value) || null;
      await loadClientRates();
    });
    document.getElementById('cliList').addEventListener('click', e => {
      const btn = e.target.closest('.btn-del');
      if (btn) onDeleteClientRate(Number(btn.dataset.id));
    });
    fillTypes('cliType', 'live');
    fillServices('cliService', 'live');
    updatePriceLabel('cliPriceLabel', 'live');

    // Provider tab
    document.getElementById('prvCat').addEventListener('change', () => {
      const cat = document.getElementById('prvCat').value;
      fillTypes('prvType', cat);
      fillServices('prvService', cat);
      updatePriceLabel('prvPriceLabel', cat);
    });
    document.getElementById('prvType').addEventListener('change', () => {
      updatePriceLabel('prvPriceLabel', document.getElementById('prvCat').value);
    });
    document.getElementById('btnAddPrv').addEventListener('click', onAddProviderCost);
    document.getElementById('providerSel').addEventListener('change', async e => {
      selProviderId = Number(e.target.value) || null;
      await loadProviderCosts();
    });
    document.getElementById('prvList').addEventListener('click', e => {
      const btn = e.target.closest('.btn-del');
      if (btn) onDeleteProviderCost(Number(btn.dataset.id));
    });
    fillTypes('prvType', 'live');
    fillServices('prvService', 'live');
    updatePriceLabel('prvPriceLabel', 'live');

    [clients, providers] = await Promise.all([
      window.pmp.clients.list(), window.pmp.providers.list()
    ]);
    populateSelect('clientSel',   clients,   'Select a client...');
    populateSelect('providerSel', providers, 'Select a provider...');
    await loadDefaults();
  }

  function populateSelect(id, items, placeholder) {
    document.getElementById(id).innerHTML =
      `<option value="">${placeholder}</option>` +
      items.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  }

  function fillTypes(selectId, category) {
    const types = TYPE_MAP[category] || [{ value: null, label: 'Flat' }];
    document.getElementById(selectId).innerHTML =
      types.map(t => `<option value="${t.value || ''}">${esc(t.label)}</option>`).join('');
  }

  function fillServices(selectId, category) {
    const services = catalog[category] || [];
    // Add a "(all services)" option for catch-all pricing
    document.getElementById(selectId).innerHTML =
      `<option value="">— All Services —</option>` +
      services.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  }

  function updatePriceLabel(labelId, category) {
    const el = document.getElementById(labelId);
    if (!el) return;
    const isCost = labelId.startsWith('prv');
    const typeEl = document.getElementById(labelId.replace('PriceLabel', 'Type'));
    const typeVal = typeEl ? typeEl.value : '';

    if (category === 'live') {
      if (typeVal === 'per5') el.textContent = isCost ? 'Cost (USD per 5 min)' : 'Price (USD per 5 min)';
      else if (typeVal === 'base15') el.textContent = isCost ? 'Cost (USD base 15)' : 'Price (USD base 15)';
      else el.textContent = isCost ? 'Cost (USD flat)' : 'Price (USD flat)';
    } else if (category === 'space') {
      el.textContent = isCost ? 'Cost (USD/min)' : 'Rate (USD/min)';
    } else {
      el.textContent = isCost ? 'Cost (USD flat)' : 'Price (USD flat)';
    }
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
  }

  function catLabel(c) { return { live:'Live', space:'Space', crew:'Crew', package:'Package' }[c] || c; }
  function typeLabel(t) {
    const all = [...LIVE_TYPES, ...CREW_TYPES, ...SPACE_TYPES, ...PACKAGE_TYPES];
    const found = all.find(x => x.value === t);
    return found ? found.label : (t || 'Flat');
  }

  // ---- Defaults ----
  async function loadDefaults() {
    try { defaults = await window.pmp.pricing.getDefault() || []; renderList('defList', defaults, 'price'); }
    catch (err) { toast('Failed to load prices: ' + (err.message || err), 'error'); }
  }
  async function onAddDefault() {
    const cat = document.getElementById('defCat').value;
    const data = {
      category: cat,
      type:     document.getElementById('defType').value || null,
      label:    document.getElementById('defService').value || null,
      price:    Number(document.getElementById('defPrice').value) || 0
    };
    if (!data.price && data.price !== 0) { toast('Enter a valid price', 'error'); return; }
    try {
      await window.pmp.pricing.saveDefault(data);
      toast('Rate saved', 'success');
      document.getElementById('defPrice').value = '';
      await loadDefaults();
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }
  async function onDeleteDefault(id) {
    if (!await confirmDialog({ title: 'Delete Rate', message: 'Delete this default rate?', confirmText: 'Delete', danger: true })) return;
    try { await window.pmp.pricing.deleteDefault(id); toast('Deleted', 'success'); await loadDefaults(); }
    catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ---- Client rates ----
  async function loadClientRates() {
    if (!selClientId) { document.getElementById('clientSection').style.display = 'none'; return; }
    document.getElementById('clientSection').style.display = '';
    try { cliRates = await window.pmp.pricing.getForClient(selClientId) || []; renderList('cliList', cliRates, 'price'); }
    catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }
  async function onAddClientRate() {
    if (!selClientId) { toast('Select a client first', 'error'); return; }
    const cat = document.getElementById('cliCat').value;
    const data = {
      client_id: selClientId,
      category:  cat,
      type:      document.getElementById('cliType').value || null,
      label:     document.getElementById('cliService').value || null,
      price:     Number(document.getElementById('cliPrice').value) || 0
    };
    if (!data.price && data.price !== 0) { toast('Enter a valid price', 'error'); return; }
    try {
      await window.pmp.pricing.saveClientRate(data);
      toast('Custom rate saved', 'success');
      document.getElementById('cliPrice').value = '';
      await loadClientRates();
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }
  async function onDeleteClientRate(id) {
    if (!await confirmDialog({ title: 'Delete Rate', message: 'Delete this custom client rate?', confirmText: 'Delete', danger: true })) return;
    try { await window.pmp.pricing.deleteClientRate(id); toast('Deleted', 'success'); await loadClientRates(); }
    catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ---- Provider costs ----
  async function loadProviderCosts() {
    if (!selProviderId) { document.getElementById('providerSection').style.display = 'none'; return; }
    document.getElementById('providerSection').style.display = '';
    try { prvCosts = await window.pmp.pricing.getForProvider(selProviderId) || []; renderList('prvList', prvCosts, 'cost'); }
    catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }
  async function onAddProviderCost() {
    if (!selProviderId) { toast('Select a provider first', 'error'); return; }
    const cat = document.getElementById('prvCat').value;
    const data = {
      provider_id: selProviderId,
      category:    cat,
      type:        document.getElementById('prvType').value || null,
      label:       document.getElementById('prvService').value || null,
      cost:        Number(document.getElementById('prvPrice').value) || 0
    };
    if (!data.cost && data.cost !== 0) { toast('Enter a valid cost', 'error'); return; }
    try {
      await window.pmp.pricing.saveProviderCost(data);
      toast('Cost saved', 'success');
      document.getElementById('prvPrice').value = '';
      await loadProviderCosts();
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }
  async function onDeleteProviderCost(id) {
    if (!await confirmDialog({ title: 'Delete Cost', message: 'Delete this provider cost?', confirmText: 'Delete', danger: true })) return;
    try { await window.pmp.pricing.deleteProviderCost(id); toast('Deleted', 'success'); await loadProviderCosts(); }
    catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ---- Render price list ----
  function renderList(containerId, rows, priceField) {
    const c = document.getElementById(containerId);
    if (!rows.length) { c.innerHTML = '<div class="empty-state">No rates saved yet</div>'; return; }
    c.innerHTML = rows.map(r => `
      <div class="price-row">
        <div class="cat">${esc(catLabel(r.category))}</div>
        <div class="type-tag">${esc(typeLabel(r.type))}</div>
        <div>${esc(r.label || '— all —')}</div>
        <div class="price">$${fmtNumber(r[priceField])}</div>
        <div class="actions"><button class="btn btn-del" data-id="${r.id}">Delete</button></div>
      </div>`).join('');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
