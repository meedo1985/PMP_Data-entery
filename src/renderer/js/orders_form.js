// ================================================================
// orders_form.js — shared form logic for NEW and EDIT order pages
// ================================================================

window.OrdersForm = (function () {

  const state = {
    mode: 'new',
    orderId: null,
    currentUser: null,
    clients: [],
    providers: [],
    hideFinancial: false,
    _initializing: false,
    _locationCache: {},
    dirty: false
  };

  const SPACE_TYPES = ['space'];
  function isSpaceProvider(p)    { return p.type === 'space'; }
  function isLocationProvider(p) { return p.type !== 'space'; }

  // ================================================================
  // SHARED FORM BODY (sections 1–Notes)
  // Identical for new + edit pages — injected once here so the two HTML
  // files only carry their page-specific submit bar / modal. The submit
  // bar stays in each page's static HTML (it differs between new/edit).
  //
  // LAYOUT NOTE: this markup assumes its host has the `.order-form` class,
  // which makes `.form-grid` a 4-column grid (see styles.css). The
  // `col-span-2` / `col-span-4` values below are sized for 4 columns — if
  // this template is ever reused outside `.order-form`, revisit the spans.
  // ================================================================
  const ORDER_FORM_SECTIONS = `
    <!-- BASIC -->
    <div class="section-h">Basic Information</div>
    <div class="form-grid">
      <div class="field-wrap">
        <label class="field-label" for="fDate">Date *</label>
        <input class="field-input" type="date" id="fDate">
      </div>
      <div class="field-wrap">
        <label class="field-label" for="fClient">Client *</label>
        <select class="field-select" id="fClient"></select>
      </div>
      <div class="field-wrap">
        <label class="field-label" for="fCategory">Category *</label>
        <select class="field-select" id="fCategory">
          <option value="live">Live</option>
          <option value="package">Package</option>
          <option value="space">Space</option>
          <option value="crew">Crew</option>
        </select>
      </div>
      <div class="field-wrap" id="fCurrencyWrap">
        <label class="field-label" for="fCurrency">Currency</label>
        <select class="field-select" id="fCurrency"></select>
      </div>
      <div class="field-wrap col-span-2">
        <label class="field-label" for="fWOClient">Client WO #</label>
        <input class="field-input" id="fWOClient" placeholder="Optional">
      </div>
      <div class="field-wrap col-span-2">
        <label class="field-label" for="fWOInternal">Internal WO</label>
        <input class="field-input auto-field" id="fWOInternal" readonly placeholder="Auto">
      </div>
    </div>

    <!-- SERVICE -->
    <div class="section-h">Service</div>
    <div class="form-grid" id="sectionServiceGrid">
      <div class="field-wrap col-span-2">
        <label class="field-label" for="fService">Service *</label>
        <select class="field-select" id="fService"><option value="">— Select Category first —</option></select>
      </div>
      <div class="field-wrap col-span-2" id="rowProvider">
        <label class="field-label" id="labelProvider" for="fProvider">Provider</label>
        <select class="field-select" id="fProvider"></select>
      </div>
      <div class="field-wrap col-span-2" id="rowProviderPMP" style="display:none">
        <label class="field-label">Provider</label>
        <input class="field-input auto-field" value="PMP" readonly>
      </div>
      <div class="field-wrap col-span-2" id="rowSpaceProvider">
        <label class="field-label" for="fSpaceProvider">Space Provider</label>
        <select class="field-select" id="fSpaceProvider"></select>
      </div>
    </div>

    <!-- SERVICE DETAILS -->
    <div class="section-h">Service Details</div>
    <div class="form-grid" id="sectionDetailsGrid">
      <div class="field-wrap" id="rowLiveType">
        <label class="field-label" for="fLiveType">Live Type</label>
        <select class="field-select" id="fLiveType">
          <option value="per5">Base 15 + per 5</option>
          <option value="flat30">Flat 30</option>
          <option value="flat60">Flat 60</option>
        </select>
      </div>
      <div class="field-wrap" id="rowCrewType">
        <label class="field-label" for="fCrewType">Crew Type</label>
        <select class="field-select" id="fCrewType">
          <option value="full_day">Full Day</option>
          <option value="half_day">Half Day</option>
        </select>
      </div>
      <div class="field-wrap" id="rowStart">
        <label class="field-label" for="fStart">Start</label>
        <input class="field-input time24" type="text" id="fStart" placeholder="HH:MM" maxlength="5">
      </div>
      <div class="field-wrap" id="rowEnd">
        <label class="field-label" for="fEnd">End</label>
        <input class="field-input time24" type="text" id="fEnd" placeholder="HH:MM" maxlength="5">
      </div>
      <div class="field-wrap" id="rowDurationGroup">
        <label class="field-label" for="fDuration">Duration (min : sec)</label>
        <div class="dur-split">
          <input class="field-input auto-field" type="number" id="fDuration" min="0" readonly placeholder="min" aria-label="Duration minutes">
          <span class="dur-colon">:</span>
          <input class="field-input auto-field" type="number" id="fDurationSec" min="0" max="59" readonly placeholder="sec" aria-label="Duration seconds">
        </div>
      </div>
      <div class="field-wrap" id="rowBandwidth">
        <label class="field-label" for="fBandwidth">Bandwidth</label>
        <input class="field-input" type="number" id="fBandwidth" min="0" step="0.1">
      </div>
      <div class="field-wrap" id="rowPkgPrice">
        <label class="field-label" for="fPkgPrice">Package Price</label>
        <input class="field-input" type="number" id="fPkgPrice" min="0" step="0.01">
      </div>
      <div class="field-wrap col-span-2" id="fPlaceWrap">
        <label class="field-label" for="fPlace">Location</label>
        <input class="field-input" id="fPlace" disabled placeholder="Select provider first" aria-describedby="fPlaceHint">
        <span id="fPlaceHint" class="text-muted" style="font-size:11px;margin-top:3px">Select a provider first to set the location</span>
      </div>
      <div class="field-wrap col-span-2" id="fPlaceArWrap">
        <label class="field-label" for="fPlaceAr" dir="rtl" style="text-align:right">المكان (Arabic place)</label>
        <input class="field-input" id="fPlaceAr" dir="rtl" placeholder="اسم المكان بالعربية">
      </div>
      <div class="field-wrap col-span-2" id="rowReporter">
        <label class="field-label" for="fReporter">Reporter / Guest</label>
        <input class="field-input" id="fReporter">
      </div>
    </div>

    <!-- SPECIAL PRICE -->
    <div class="section-h" id="rowSpecialSection" style="display:none">Special Price</div>
    <div class="form-grid" id="rowSpecialGrid" style="display:none">
      <div class="field-wrap special-row">
        <label><input type="checkbox" id="fUseSpecial"> Use special price for this order</label>
        <input type="number" class="special-price-input" id="fSpecialPrice" placeholder="0.00" step="0.01" min="0">
        <span class="text-muted" style="font-size:11px;margin-top:3px">Leave empty to use default special rate</span>
      </div>
    </div>

    <!-- FINANCIAL -->
    <div class="section-h financial-section">Financial <span class="section-hint">auto-calculated from service &amp; pricing rules</span></div>
    <div class="form-grid financial-section">
      <div class="field-wrap">
        <label class="field-label" for="fRevenue">Revenue</label>
        <input class="field-input financial-input" type="number" id="fRevenue" min="0" step="0.01">
      </div>
      <div class="field-wrap">
        <label class="field-label" for="fCost">Cost</label>
        <input class="field-input financial-input" type="number" id="fCost" min="0" step="0.01">
      </div>
      <div class="field-wrap">
        <label class="field-label" for="fProfit">Profit</label>
        <input class="field-input auto-field" type="number" id="fProfit" readonly>
      </div>
      <div class="field-wrap">
        <label class="field-label" for="fStatus">Status</label>
        <select class="field-select" id="fStatus"></select>
      </div>
      <div class="field-wrap">
        <label class="field-label" for="fInvoice">Invoice No.</label>
        <input class="field-input" id="fInvoice">
      </div>
    </div>

    <!-- NOTES -->
    <div class="section-h">Notes</div>
    <div class="form-grid">
      <div class="field-wrap col-span-4">
        <label class="field-label" for="fNotes">Notes</label>
        <textarea class="field-textarea" id="fNotes" rows="2"></textarea>
      </div>
    </div>`;

  // ================================================================
  // INIT
  // ================================================================
  async function init({ mode }) {
    state.mode = mode;
    const isEdit = mode === 'edit';
    state.currentUser = await initChrome({
      page:  isEdit ? 'orders_edit' : 'orders_new',
      title: isEdit ? 'Edit Order' : 'New Service Order',
      back:  false   // this page wires its own btnBack with an unsaved-changes guard
    });
    if (!state.currentUser) return;

    document.getElementById('btnBack').addEventListener('click', async () => {
      if (state.dirty) {
        const ok = await confirmDialog({
          title: 'Unsaved Changes',
          message: 'You have unsaved changes. Leave without saving?',
          confirmText: 'Leave', danger: true
        });
        if (!ok) return;
      }
      window.pmp.nav.goto('dashboard');
    });

    const _formEl = document.querySelector('.form-container');
    // Inject the shared form body as the first children, before the page's submit bar.
    if (_formEl) _formEl.insertAdjacentHTML('afterbegin', ORDER_FORM_SECTIONS);
    const _overlay = document.createElement('div');
    _overlay.className = 'form-overlay';
    _overlay.textContent = 'Loading form data…';
    if (_formEl) _formEl.appendChild(_overlay);

    document.getElementById('fClient').innerHTML   = '<option>Loading…</option>';
    document.getElementById('fProvider').innerHTML = '<option>Loading…</option>';
    let _loadFailed = false;
    try {
      const [clients, providers] = await Promise.all([
        window.pmp.clients.list(),
        window.pmp.providers.list()
      ]);
      state.clients   = clients   || [];
      state.providers = providers || [];
    } catch (err) {
      _loadFailed = true;
      toast('Failed to load form data — please refresh the page', 'error');
      document.getElementById('btnSave').disabled = true;
      const btnSaveNew = document.getElementById('btnSaveNew');
      if (btnSaveNew) btnSaveNew.disabled = true;
    } finally {
      _overlay.remove();
    }
    if (_loadFailed) return;

    populateClientSelect();
    populateProviderSelects();
    populateCurrencySelect();
    populateStatusSelect();

    // Wire change handlers
    document.getElementById('fCategory').addEventListener('change', onCategoryChange);
    document.getElementById('fClient').addEventListener('change', onClientChange);
    document.getElementById('fProvider').addEventListener('change', onProviderChange);
    document.getElementById('fSpaceProvider').addEventListener('change', onSpaceProviderChange);
    document.getElementById('fStart').addEventListener('change', recalcDuration);
    document.getElementById('fEnd').addEventListener('change', recalcDuration);
    document.getElementById('fDuration').addEventListener('input', calcPricing);
    document.getElementById('fBandwidth').addEventListener('input', calcPricing);
    document.getElementById('fService').addEventListener('change', onServiceChange);
    document.getElementById('fLiveType').addEventListener('change', calcPricing);
    document.getElementById('fCrewType').addEventListener('change', onCrewTypeChange);
    const fUseSpecial = document.getElementById('fUseSpecial');
    const fSpecialPrice = document.getElementById('fSpecialPrice');
    if (fUseSpecial) fUseSpecial.addEventListener('change', calcPricing);
    if (fSpecialPrice) fSpecialPrice.addEventListener('input', calcPricing);

    document.getElementById('btnSave').addEventListener('click', onSave);
    const btnSaveNew = document.getElementById('btnSaveNew');
    if (btnSaveNew) btnSaveNew.addEventListener('click', () => onSave({ thenNew: true }));

    // Role gates
    if (state.currentUser.role === 'accountant') {
      _lockFieldsForAccountant();
      _attachPaymentsPanel();
    }
    if (!hasPerm(state.currentUser, 'viewFinancial')) {
      state.hideFinancial = true;
      setHidden('.financial-section', true);
      const cw = document.getElementById('fCurrencyWrap');
      if (cw) cw.style.display = 'none';
    }

    // Load order data or apply defaults
    if (mode === 'edit') {
      const ctx = takeContext();
      if (!ctx || !ctx.id) {
        toast('No order selected for editing', 'error');
        setTimeout(() => window.pmp.nav.goto('dashboard'), 1200);
        return;
      }
      state.orderId = ctx.id;
      await loadOrder(ctx.id);
    } else {
      state._initializing = true;
      const ctx     = takeContext();
      const prefill = ctx && ctx.prefill;

      const cat = (prefill && prefill.category) || 'live';
      document.getElementById('fDate').value     = (prefill && prefill.order_date)       || new Date().toISOString().slice(0, 10);
      document.getElementById('fCategory').value = cat;
      document.getElementById('fCurrency').value = (prefill && prefill.currency)         || 'USD';
      document.getElementById('fStatus').value   = (prefill && prefill.payment_status)   || 'Pending';

      await populateServiceSelect(cat);

      if (prefill) {
        if (prefill.client_id)   document.getElementById('fClient').value   = prefill.client_id;
        if (prefill.service) {
          _setServiceValue(prefill.service);
          if (cat === 'space') {
            const match = (prefill.service || '').match(/([\d.]+)\s*mhz/i);
            if (match) document.getElementById('fBandwidth').value = parseFloat(match[1]);
          }
        }
        if (prefill.start_time)  document.getElementById('fStart').value    = prefill.start_time;
        if (prefill.end_time)    document.getElementById('fEnd').value      = prefill.end_time;
        if (prefill.duration_minutes) document.getElementById('fDuration').value = prefill.duration_minutes;
        if (prefill.duration_seconds) { const ds = document.getElementById('fDurationSec'); if (ds) ds.value = prefill.duration_seconds; }
        if (prefill.bandwidth_mhz)    document.getElementById('fBandwidth').value = prefill.bandwidth_mhz;
        if (prefill.space_provider_id) document.getElementById('fSpaceProvider').value = prefill.space_provider_id;
        if (prefill.reporter)    document.getElementById('fReporter').value = prefill.reporter;
        if (prefill.place_ar)    { const el = document.getElementById('fPlaceAr'); if (el) el.value = prefill.place_ar; }
        if (prefill.notes)       document.getElementById('fNotes').value    = prefill.notes;
        if (prefill.live_type)   document.getElementById('fLiveType').value = prefill.live_type;
        if (prefill.crew_type)   document.getElementById('fCrewType').value = prefill.crew_type;
        const fUseSpecialPrefill = document.getElementById('fUseSpecial');
        const fSpecialPricePrefill = document.getElementById('fSpecialPrice');
        if (fUseSpecialPrefill) fUseSpecialPrefill.checked = !!prefill.use_special;
        if (fSpecialPricePrefill) fSpecialPricePrefill.value = prefill.special_price || '';

        if (cat === 'space') {
          if (prefill.place) {
            const wrap = document.getElementById('fPlaceWrap');
            if (wrap) _setPlaceAsInput(wrap, prefill.place, false);
          }
        } else if (prefill.provider_id) {
          document.getElementById('fProvider').value = prefill.provider_id;
          await populateLocationSelect(Number(prefill.provider_id), prefill.place || '');
        }
        if (prefill.client_id) await onClientChange();
        toast('Order copied — review and save', 'info');
      }

      onCategoryChange();
      state._initializing = false;
      if (prefill) calcPricing();
    }

    // Mark dirty on any user change AFTER init completes
    const formWrap = document.querySelector('.form-container');
    if (formWrap) {
      const markDirty = () => { if (!state._initializing) state.dirty = true; };
      formWrap.addEventListener('change', markDirty);
      formWrap.addEventListener('input',  markDirty);
    }
  }

  // ================================================================
  // POPULATE SELECTS
  // ================================================================
  function populateClientSelect() {
    document.getElementById('fClient').innerHTML =
      '<option value="">— Select Client —</option>' +
      state.clients.map(c =>
        `<option value="${c.id}">${esc(c.name)} (${esc(c.code)})</option>`
      ).join('');
  }

  function populateProviderSelects() {
    const locProviders   = state.providers.filter(isLocationProvider);
    const spaceProviders = state.providers.filter(isSpaceProvider);

    document.getElementById('fProvider').innerHTML =
      '<option value="">— Select Provider —</option>' +
      locProviders.map(p =>
        `<option value="${p.id}" data-place="${esc(p.place || '')}">${esc(p.name)}</option>`
      ).join('');

    document.getElementById('fSpaceProvider').innerHTML =
      '<option value="">— Select Space Provider —</option>' +
      spaceProviders.map(p =>
        `<option value="${p.id}">${esc(p.name)}</option>`
      ).join('');
  }

  function populateCurrencySelect() {
    document.getElementById('fCurrency').innerHTML =
      ['USD','EUR','ILS','JOD'].map(c => `<option value="${c}">${c}</option>`).join('');
  }

  function populateStatusSelect() {
    document.getElementById('fStatus').innerHTML =
      ['Pending','Approved','Paid','Partial']
        .map(s => `<option value="${s}">${s}</option>`).join('');
  }

  // ================================================================
  // SERVICE DROPDOWN
  // ================================================================
  async function populateServiceSelect(cat, currentValue) {
    const sel = document.getElementById('fService');
    sel.disabled = true;
    sel.innerHTML = '<option value="">— Loading… —</option>';
    try {
      const services = await window.pmp.catalog.list(cat) || [];
      sel.innerHTML = '<option value="">— Select Service —</option>' +
        services.map(s => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
    } catch (_) {
      const fallback = {
        live:    ['Live Studio','Live Stand Up','Live SNG','Live Studio - TVU','SNG Truck'],
        package: ['Report','Rushes','Interview','Vox Pop','As Live','Radio Package'],
        space:   ['Space segment 3 MHz','Space segment 4.5 MHz','Space segment 6 MHz','Space segment 9 MHz'],
        crew:    ['Camera Crew','TVU Crew','Live SNG Crew']
      };
      sel.innerHTML = '<option value="">— Select Service —</option>' +
        (fallback[cat] || []).map(s => `<option value="${s}">${s}</option>`).join('');
    }
    sel.disabled = false;
    if (currentValue) _setServiceValue(currentValue);
  }

  function _setServiceValue(value) {
    const sel = document.getElementById('fService');
    for (const opt of sel.options) {
      if (opt.value === value) { sel.value = value; return; }
    }
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = value + ' (legacy)';
    sel.appendChild(opt);
    sel.value = value;
  }

  // ================================================================
  // LOCATION DROPDOWN
  // ================================================================
  async function populateLocationSelect(providerId, currentValue) {
    const wrap = document.getElementById('fPlaceWrap');
    if (!wrap) return;

    if (!providerId) {
      _setPlaceAsInput(wrap, '', true);
      return;
    }

    try {
      let locs = state._locationCache[providerId];
      if (!locs) {
        locs = await window.pmp.locations.list(providerId) || [];
        state._locationCache[providerId] = locs;
      }

      if (locs.length > 0) {
        _setPlaceAsSelect(wrap, locs, currentValue);
      } else {
        const provider = state.providers.find(p => p.id === providerId);
        const fallbackPlace = (provider && provider.place) || '';
        _setPlaceAsInput(wrap, currentValue || fallbackPlace, false);
      }
    } catch (_) {
      _setPlaceAsInput(wrap, currentValue || '', false);
    }
  }

  function _setPlaceAsSelect(wrap, locs, selectedValue) {
    let el = document.getElementById('fPlace');
    if (!el || el.tagName.toLowerCase() !== 'select') {
      const old = el;
      el = document.createElement('select');
      el.id        = 'fPlace';
      el.className = 'field-select';
      if (old) wrap.replaceChild(el, old);
      else     wrap.appendChild(el);
    }
    el.innerHTML =
      '<option value="">— Select Location —</option>' +
      locs.map(l => `<option value="${esc(l.name)}">${esc(l.name)}</option>`).join('');
    el.disabled = false;
    if (selectedValue) el.value = selectedValue;
  }

  function _setPlaceAsInput(wrap, value, disabled) {
    let el = document.getElementById('fPlace');
    if (!el || el.tagName.toLowerCase() !== 'input') {
      const old = el;
      el = document.createElement('input');
      el.id          = 'fPlace';
      el.className   = 'field-input';
      el.placeholder = disabled ? 'Select a provider first' : 'Enter location';
      if (old) wrap.replaceChild(el, old);
      else     wrap.appendChild(el);
    }
    el.value    = value || '';
    el.disabled = disabled;
    el.placeholder = disabled ? 'Select a provider first' : 'Enter location or add in Providers page';
    if (disabled) el.setAttribute('aria-describedby', 'fPlaceHint');
    else          el.removeAttribute('aria-describedby');
    const hint = document.getElementById('fPlaceHint');
    if (hint) hint.style.display = disabled ? '' : 'none';
  }

  // ================================================================
  // CATEGORY CHANGE
  // ================================================================
  async function onCategoryChange() {
    const cat = document.getElementById('fCategory').value;

    const show = (id, yes) => {
      const el = document.getElementById(id);
      if (el) el.style.display = yes ? '' : 'none';
    };

    show('rowLiveType',      cat === 'live');
    show('rowCrewType',      cat === 'crew');
    show('rowBandwidth',     cat === 'space');
    show('rowProvider',      cat !== 'space');
    show('rowProviderPMP',   cat === 'space');
    show('rowSpaceProvider', cat === 'space');
    show('rowReporter',      cat !== 'space');
    show('fPlaceArWrap',     cat !== 'space');
    show('rowStart',         cat !== 'package');
    show('rowEnd',           cat !== 'package');
    show('rowPkgPrice',      cat === 'package' && !state.hideFinancial);
    show('rowSpecialSection', (cat === 'live' || cat === 'crew') && !state.hideFinancial);
    show('rowSpecialGrid',    (cat === 'live' || cat === 'crew') && !state.hideFinancial);

    // Special price section label
    const specialSection = document.getElementById('rowSpecialSection');
    if (specialSection) {
      specialSection.textContent = cat === 'live' ? 'Live Special Price' : cat === 'crew' ? 'Crew Special Price' : 'Special Price';
    }

    if (cat === 'space') {
      const wrap = document.getElementById('fPlaceWrap');
      if (wrap) {
        const curVal = document.getElementById('fPlace')?.value || '';
        _setPlaceAsInput(wrap, curVal, false);
      }
      document.getElementById('fProvider').value = '';
    }

    const placeLabel = document.querySelector('#fPlaceWrap .field-label');
    if (placeLabel) placeLabel.textContent = cat === 'space' ? 'Client Location' : 'Location';

    const provLabel = document.querySelector('#rowProvider .field-label');
    if (provLabel) {
      provLabel.textContent = cat === 'crew' ? 'Crew Provider' : 'Provider';
    }

    const dur = document.getElementById('fDuration');
    const durSec = document.getElementById('fDurationSec');
    if (cat === 'live' || cat === 'space' || cat === 'crew') {
      // duration auto-computed from Start/End in whole minutes — no seconds
      dur.readOnly = true; dur.classList.add('auto-field');
      if (durSec) { durSec.readOnly = true; durSec.classList.add('auto-field'); durSec.value = ''; }
    } else {
      dur.readOnly = false; dur.classList.remove('auto-field');
      if (durSec) { durSec.readOnly = false; durSec.classList.remove('auto-field'); }
    }
    if (cat === 'crew') onCrewTypeChange();

    if (!state._initializing) {
      await populateServiceSelect(cat);
    }
    updateSectionStates();
    calcPricing();
  }

  function onCrewTypeChange() {
    calcPricing();
  }

  function onServiceChange() {
    const cat = document.getElementById('fCategory').value;
    if (cat === 'space') {
      const service = document.getElementById('fService').value || '';
      const match = service.match(/([\d.]+)\s*mhz/i);
      document.getElementById('fBandwidth').value = match ? parseFloat(match[1]) : '';
    }
    updateSectionStates();
    calcPricing();
  }

  // ================================================================
  // SECTION STATE (visual dimming of dependent sections)
  // ================================================================
  function setSectionEnabled(sectionEl, enabled) {
    if (!sectionEl) return;
    sectionEl.style.opacity = enabled ? '' : '0.45';
    // `inert` removes the section from tab order + pointer interaction, so a
    // disabled-looking section can't be focused/typed into via keyboard.
    sectionEl.inert = !enabled;
  }

  function updateSectionStates() {
    const serviceVal = document.getElementById('fService').value;
    const hasService = !!serviceVal;
    setSectionEnabled(document.getElementById('sectionDetailsGrid'), hasService);
  }

  // ================================================================
  // CLIENT / PROVIDER CHANGE
  // ================================================================
  async function onClientChange() {
    const clientId = Number(document.getElementById('fClient').value);
    if (!clientId) return;
    try {
      const wo = await window.pmp.clients.nextWO(clientId);
      if (wo) {
        const fWO = document.getElementById('fWOInternal');
        if (state.mode === 'new' || !fWO.value) {
          fWO.value       = wo.formatted;
          fWO.placeholder = 'Will be assigned on save: ' + wo.formatted;
        }
      }
    } catch (_) {}
    calcPricing();
  }

  async function onProviderChange() {
    const cat = document.getElementById('fCategory').value;
    if (cat === 'space') { calcPricing(); return; }
    const providerId = Number(document.getElementById('fProvider').value) || null;
    if (providerId) delete state._locationCache[providerId];
    await populateLocationSelect(providerId, '');
    calcPricing();
  }

  async function onSpaceProviderChange() {
    calcPricing();
  }

  // ================================================================
  // TIME & PRICING
  // ================================================================
  function recalcDuration() {
    const cat = document.getElementById('fCategory').value;
    if (cat === 'package') return;
    const s = document.getElementById('fStart').value;
    const e = document.getElementById('fEnd').value;
    if (!s || !e) return;
    const [sh, sm] = s.split(':').map(Number);
    const [eh, em] = e.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 1440;
    document.getElementById('fDuration').value = diff;
    const durSec = document.getElementById('fDurationSec');
    if (durSec) durSec.value = ''; // computed from HH:MM — no seconds component
    calcPricing();
  }

  async function calcPricing() {
    if (state._initializing) return;
    const cat = document.getElementById('fCategory').value;
    const provEl = cat === 'space'
      ? document.getElementById('fSpaceProvider')
      : document.getElementById('fProvider');

    const fUseSpecial = document.getElementById('fUseSpecial');
    const fSpecialPrice = document.getElementById('fSpecialPrice');
    const useSpecial = (cat === 'live' || cat === 'crew') && fUseSpecial && fUseSpecial.checked;

    const input = {
      category:         cat,
      service:          document.getElementById('fService').value || null,
      duration_minutes: Number(document.getElementById('fDuration').value)   || 0,
      client_id:        Number(document.getElementById('fClient').value)      || null,
      provider_id:      provEl ? (Number(provEl.value) || null) : null,
      manual_price:     Number((document.getElementById('fPkgPrice') || {}).value) || 0,
      live_type:        cat === 'live' ? (document.getElementById('fLiveType').value || 'per5') : undefined,
      crew_type:        cat === 'crew' ? (document.getElementById('fCrewType').value || 'full_day') : undefined,
      use_special:      useSpecial,
      special_price:    useSpecial && fSpecialPrice ? (Number(fSpecialPrice.value) || null) : null
    };
    try {
      const r = await window.pmp.pricing.calculate(input);
      const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || 0; };
      sv('fRevenue', r.revenue); sv('fCost', r.cost); sv('fProfit', r.profit);
    } catch (err) {
      console.warn('[pricing] calculation failed:', err.message);
    }
  }

  // ================================================================
  // ACCOUNTANT LOCK
  // ================================================================
  function _lockFieldsForAccountant() {
    const editable = new Set(['fStatus','fInvoice']);
    document.querySelectorAll('input, select, textarea').forEach(el => {
      if (!editable.has(el.id)) { el.disabled = true; el.classList.add('auto-field'); }
    });
    ['btnDelete','btnCopy'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  // ================================================================
  // PAYMENTS PANEL
  // ================================================================
  async function _attachPaymentsPanel() {
    if (state.mode !== 'edit' || !state.orderId) return;
    const main = document.querySelector('.form-container');
    if (!main) return;
    const panel = document.createElement('div');
    panel.innerHTML = `
      <div class="section-h" style="margin-top:26px">💳 Payments</div>
      <div id="paymentsList" style="margin-bottom:14px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:8px;align-items:end">
        <div class="field-wrap"><label class="field-label">Date</label>
          <input type="date" class="field-input" id="payDate" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field-wrap"><label class="field-label">Amount</label>
          <input type="number" class="field-input" id="payAmt" step="0.01" min="0"></div>
        <div class="field-wrap"><label class="field-label">Method</label>
          <input type="text" class="field-input" id="payMethod" placeholder="Cash / Bank / Cheque"></div>
        <div class="field-wrap"><label class="field-label">Reference</label>
          <input type="text" class="field-input" id="payRef"></div>
        <button class="btn btn-primary" id="btnAddPay" style="height:36px;align-self:end">Add</button>
      </div>`;
    main.appendChild(panel);
    document.getElementById('btnAddPay').addEventListener('click', _addPayment);
    await _loadPayments();
  }

  async function _loadPayments() {
    try {
      const payments  = await window.pmp.payments.list(state.orderId);
      const container = document.getElementById('paymentsList');
      if (!payments || !payments.length) {
        container.innerHTML = '<div style="color:#95a5a6;font-style:italic;padding:8px 0;font-size:12px">No payments recorded</div>';
        return;
      }
      const total = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      container.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f4f6f8">
            <th style="padding:6px;text-align:left">Date</th>
            <th style="padding:6px;text-align:left">Amount</th>
            <th style="padding:6px;text-align:left">Method</th>
            <th style="padding:6px;text-align:left">Ref</th>
            <th></th>
          </tr></thead>
          <tbody>
            ${payments.map(p => `
              <tr style="border-bottom:1px solid #f0f4f8">
                <td style="padding:5px 6px">${esc(p.payment_date)}</td>
                <td style="padding:5px 6px;font-weight:600;color:#27ae60">${fmtMoney(p.amount,'')}</td>
                <td style="padding:5px 6px">${esc(p.method||'—')}</td>
                <td style="padding:5px 6px">${esc(p.reference||'—')}</td>
                <td style="padding:5px 6px">
                  <button class="btn btn-del" data-pay-id="${p.id}" style="padding:2px 8px;height:auto;font-size:11px">×</button>
                </td>
              </tr>`).join('')}
            <tr style="background:#eafaf1">
              <td style="padding:6px;font-weight:700">Total Paid</td>
              <td style="padding:6px;font-weight:700;color:#27ae60">${fmtMoney(total,'')}</td>
              <td colspan="3"></td>
            </tr>
          </tbody>
        </table>`;
      container.querySelectorAll('[data-pay-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!await confirmDialog({ title: 'Delete Payment', message: 'Delete this payment? This cannot be undone.', confirmText: 'Delete', danger: true })) return;
          try { await window.pmp.payments.remove(Number(btn.dataset.payId)); await _loadPayments(); }
          catch (err) { toast('Error: ' + (err.message || err), 'error'); }
        });
      });
    } catch (err) { toast('Failed to load payments: ' + (err.message || err), 'error'); }
  }

  async function _addPayment() {
    const data = {
      order_id:     state.orderId,
      payment_date: document.getElementById('payDate').value,
      amount:       Number(document.getElementById('payAmt').value) || 0,
      method:       document.getElementById('payMethod').value.trim() || null,
      reference:    document.getElementById('payRef').value.trim()   || null
    };
    if (!data.payment_date || !data.amount) { toast('Date and amount required', 'error'); return; }
    try {
      await window.pmp.payments.add(data);
      toast('Payment recorded', 'success');
      ['payAmt','payMethod','payRef'].forEach(id => document.getElementById(id).value = '');
      await _loadPayments();
      const r = await window.pmp.orders.get(state.orderId);
      if (r) document.getElementById('fStatus').value = r.payment_status;
    } catch (err) { toast('Error: ' + (err.message || err), 'error'); }
  }

  // ================================================================
  // LOAD EXISTING ORDER
  // ================================================================
  async function loadOrder(id) {
    try {
      state._initializing = true;
      const o = await window.pmp.orders.get(id);
      if (!o) { toast('Order not found', 'error'); return; }

      document.getElementById('fDate').value           = o.order_date || '';
      document.getElementById('fClient').value         = o.client_id  || '';
      document.getElementById('fCategory').value       = o.category   || 'live';
      document.getElementById('fWOClient').value       = o.wo_client  || '';
      document.getElementById('fWOInternal').value     = o.wo_internal || '';
      document.getElementById('fProvider').value       = o.provider_id || '';
      document.getElementById('fSpaceProvider').value  = o.space_provider_id || '';
      document.getElementById('fReporter').value       = o.reporter   || '';
      document.getElementById('fStart').value          = o.start_time || '';
      document.getElementById('fEnd').value            = o.end_time   || '';
      document.getElementById('fDuration').value       = o.duration_minutes || '';
      { const ds = document.getElementById('fDurationSec'); if (ds) ds.value = o.duration_seconds || ''; }
      document.getElementById('fBandwidth').value      = o.bandwidth_mhz   || '';
      document.getElementById('fNotes').value          = o.notes      || '';
      document.getElementById('fCurrency').value       = o.currency   || 'USD';
      document.getElementById('fStatus').value         = o.payment_status || 'Pending';
      document.getElementById('fInvoice').value        = o.invoice_no || '';
      if (o.revenue != null) document.getElementById('fRevenue').value = o.revenue;
      if (o.cost    != null) document.getElementById('fCost').value    = o.cost;
      if (o.profit  != null) document.getElementById('fProfit').value  = o.profit;
      if (o.live_type) document.getElementById('fLiveType').value = o.live_type;
      if (o.crew_type) document.getElementById('fCrewType').value = o.crew_type;

      const fUseSpecial = document.getElementById('fUseSpecial');
      const fSpecialPrice = document.getElementById('fSpecialPrice');
      if (fUseSpecial) fUseSpecial.checked = !!o.use_special;
      if (fSpecialPrice) fSpecialPrice.value = o.special_price || '';

      await populateServiceSelect(o.category || 'live', o.service || '');

      const fPlaceAr = document.getElementById('fPlaceAr');
      if (fPlaceAr) fPlaceAr.value = o.place_ar || '';

      if (o.category === 'space') {
        _setPlaceAsInput(document.getElementById('fPlaceWrap'), o.place || '', false);
        if (!o.bandwidth_mhz && o.service) {
          const match = (o.service || '').match(/([\d.]+)\s*mhz/i);
          if (match) document.getElementById('fBandwidth').value = parseFloat(match[1]);
        }
      } else if (o.provider_id) {
        await populateLocationSelect(Number(o.provider_id), o.place || '');
      } else {
        _setPlaceAsInput(document.getElementById('fPlaceWrap'), o.place || '', false);
      }

      onCategoryChange();
      updateSectionStates();
    } catch (err) {
      toast('Failed to load order: ' + (err.message || err), 'error');
    } finally {
      // Always clear the initializing flag so the dirty watcher works
      // regardless of whether the load succeeded or threw.
      state._initializing = false;
    }
  }

  // ================================================================
  // SAVE
  // ================================================================
  function requireField(id, message) {
    const el = document.getElementById(id);
    if (!el || !el.value) {
      if (el) {
        window.setFieldError(el, message);
        const clear = () => window.clearFieldError(el);
        el.addEventListener('input', clear, { once: true });
        el.addEventListener('change', clear, { once: true });
        el.focus();
      }
      toast(message, 'error');
      return false;
    }
    return true;
  }

  async function onSave({ thenNew } = {}) {
    const cat      = document.getElementById('fCategory').value;
    const clientId = Number(document.getElementById('fClient').value);
    const date     = document.getElementById('fDate').value;
    const service  = document.getElementById('fService').value;

    if (!requireField('fClient',  'Please select a client'))  return;
    if (!requireField('fDate',    'Please select a date'))    return;
    if (!requireField('fService', 'Please select a service')) return;
    if (cat === 'live') {
      if (!requireField('fStart', 'Start time is required for Live orders')) return;
      if (!requireField('fEnd',   'End time is required for Live orders'))   return;
    }

    const placeEl = document.getElementById('fPlace');
    const fUseSpecial = document.getElementById('fUseSpecial');
    const fSpecialPrice = document.getElementById('fSpecialPrice');
    const useSpecial = (cat === 'live' || cat === 'crew') && fUseSpecial && fUseSpecial.checked;

    const payload = {
      id: state.mode === 'edit' ? state.orderId : undefined,
      order_date:        date,
      client_id:         clientId,
      service:           service,
      category:          cat,
      wo_client:         document.getElementById('fWOClient').value.trim()     || null,
      wo_internal:       state.mode === 'edit'
                           ? document.getElementById('fWOInternal').value.trim() : null,
      place:             placeEl ? (placeEl.value || null) : null,
      place_ar:          document.getElementById('fPlaceAr')
                           ? (document.getElementById('fPlaceAr').value.trim() || null) : null,
      start_time:        document.getElementById('fStart').value               || null,
      end_time:          document.getElementById('fEnd').value                 || null,
      duration_minutes:  Number(document.getElementById('fDuration').value)    || null,
      duration_seconds:  Number(document.getElementById('fDurationSec').value) || null,
      bandwidth_mhz:     Number(document.getElementById('fBandwidth').value)   || null,
      provider_id:       Number(document.getElementById('fProvider').value)    || null,
      space_provider_id: Number(document.getElementById('fSpaceProvider').value) || null,
      reporter:          document.getElementById('fReporter').value.trim()     || null,
      rate:              0,
      revenue:           Number(document.getElementById('fRevenue').value)     || 0,
      cost:              Number(document.getElementById('fCost').value)        || 0,
      currency:          document.getElementById('fCurrency').value            || 'USD',
      payment_status:    document.getElementById('fStatus').value              || 'Pending',
      invoice_no:        document.getElementById('fInvoice').value.trim()      || null,
      notes:             document.getElementById('fNotes').value.trim()        || null,
      live_type:         cat === 'live' ? (document.getElementById('fLiveType').value || null) : null,
      crew_type:         cat === 'crew' ? (document.getElementById('fCrewType').value || null) : null,
      use_special:       useSpecial ? 1 : 0,
      special_price:     useSpecial && fSpecialPrice ? (Number(fSpecialPrice.value) || null) : null
    };

    if (state.currentUser.role === 'coordination') {
      delete payload.revenue; delete payload.cost; delete payload.rate;
    }

    const btn = document.getElementById('btnSave');
    btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Saving...';

    try {
      const res = await window.pmp.orders.save(payload);
      toast(
        state.mode === 'edit'
          ? 'Order updated successfully'
          : `Order saved — ${res.wo_internal || 'WO ' + res.id}`,
        'success'
      );
      setTimeout(async () => {
        try {
          await window.pmp.nav.goto(thenNew ? 'orders_new' : 'dashboard');
        } catch (navErr) {
          btn.disabled = false; btn.textContent = orig;
          toast('Navigation failed — please go back manually', 'error');
        }
      }, 700);
    } catch (err) {
      toast('Save failed: ' + (err.message || err), 'error');
      btn.disabled = false; btn.textContent = orig;
    }
  }

  return { init };
})();
