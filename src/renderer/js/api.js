// ================================================================
// api.js — renderer-side helpers (shared across all pages)
// ================================================================

// ---- Toast notifications (stacking) ----
(function () {
  let container = null;
  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('role', 'status');
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }
    return container;
  }
  window.toast = function (msg, type) {
    const el = document.createElement('div');
    el.className = 'toast toast-' + (type || 'info');
    el.setAttribute('role', 'alert');
    el.textContent = msg;
    getContainer().appendChild(el);
    const isError = type === 'error';
    const dismiss = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 260); };
    if (isError) {
      el.style.cursor = 'pointer';
      el.title = 'Click to dismiss';
      el.addEventListener('click', dismiss);
    }
    setTimeout(dismiss, isError ? 5000 : 2800);
  };
})();

// ---- Format helpers ----
function fmtDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}
function fmtMoney(n, currency) {
  if (n == null || n === '') return '—';
  const num = Number(n) || 0;
  const formatted = num.toFixed(num % 1 === 0 ? 0 : 2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency || 'USD'} ${formatted}`;
}
function fmtNumber(n) {
  if (n == null || n === '') return '0';
  return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function badgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('paid'))     return 'badge-paid';
  if (s.includes('approved')) return 'badge-approved';
  if (s.includes('pending'))  return 'badge-pending';
  if (s.includes('partial'))  return 'badge-partial';
  return 'badge-other';
}
window.fmtDate    = fmtDate;
window.fmtMoney   = fmtMoney;
window.fmtNumber  = fmtNumber;
window.badgeClass = badgeClass;

// ---- List-table render helpers (shared by clients / providers list pages) ----
// Handles the empty-state + row-count plumbing that every list page repeats:
// toggles the no-results element and updates the count label. Returns true when
// there are rows to render (false → caller should clear the tbody and stop).
function renderTableState(rows, { noResultsId, rowCountId, label } = {}) {
  const count = rows ? rows.length : 0;
  if (noResultsId) {
    const nr = document.getElementById(noResultsId);
    if (nr) nr.style.display = count ? 'none' : 'block';
  }
  if (rowCountId) {
    const rc = document.getElementById(rowCountId);
    if (rc) rc.textContent = `${count} ${label}${count !== 1 ? 's' : ''}`;
  }
  return count > 0;
}
// Standard row-actions cell: Edit, then Delete, gated by permissions. Buttons
// carry data-id and the .btn-edit / .btn-del classes the page's delegated click
// handler keys off. Returns an empty cell when the user can do neither.
function rowActions(id, { canEdit, canDelete } = {}) {
  if (!canEdit && !canDelete) return '<td></td>';
  return '<td class="row-actions">' +
    (canEdit   ? `<button class="btn btn-edit" data-id="${id}">Edit</button>`   : '') +
    (canDelete ? `<button class="btn btn-del" data-id="${id}">Delete</button>` : '') +
    '</td>';
}
window.renderTableState = renderTableState;
window.rowActions       = rowActions;

// ---- Bulk show/hide ----
// Toggles the shared .pmp-hidden class on every element matching `selector`.
// Centralizes the financial-section show/hide that pages previously reimplemented
// inline with style.display. Callers decide the condition (financial visibility is
// role-based in some places, permission-based in others), so this only does the work.
function setHidden(selector, hidden) {
  document.querySelectorAll(selector).forEach(el => el.classList.toggle('pmp-hidden', !!hidden));
}
window.setHidden = setHidden;

// ---- Auto-associate field labels (a11y) ----
// Many pages render a `.field-label` (sometimes a <div>) as a sibling of its
// control without a for=/id link, so clicking the label doesn't focus the field
// and screen readers don't announce it. This wires up the association at load time
// without touching markup, and never overrides an explicit for= / aria-* attribute.
(function () {
  let _seq = 0;
  function linkFieldLabels(root) {
    (root || document).querySelectorAll('.field-label').forEach(label => {
      const wrap = label.parentElement;
      if (!wrap) return;
      const controls = wrap.querySelectorAll('input:not([type=hidden]), select, textarea');
      if (controls.length !== 1) return;            // ambiguous grouping — skip
      const ctrl = controls[0];
      if (label.tagName === 'LABEL') {
        if (label.htmlFor) return;                  // already associated
        if (!ctrl.id) ctrl.id = 'f_auto_' + (++_seq);
        label.htmlFor = ctrl.id;
      } else {                                      // <div class="field-label">
        if (ctrl.getAttribute('aria-label') || ctrl.getAttribute('aria-labelledby')) return;
        if (!label.id) label.id = 'fl_auto_' + (++_seq);
        ctrl.setAttribute('aria-labelledby', label.id);
      }
    });
  }
  window.linkFieldLabels = linkFieldLabels;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => linkFieldLabels());
  } else {
    linkFieldLabels();
  }
})();

// ---- Escape closes the open modal (a11y) ----
// Static page modals (.modal-backdrop with an id) have no Escape handling of their
// own. Pressing Escape clicks the modal's Cancel button so its normal close/cleanup
// runs. Scoped to [id] so it never interferes with the anonymous confirmDialog
// backdrop, which manages its own Escape key.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.modal-backdrop.active[id]');
  if (!open) return;
  const cancel = open.querySelector('.btn-cancel');
  if (cancel) cancel.click();
  else open.classList.remove('active');
});

// ---- Keyboard-activate non-native buttons (a11y) ----
// Elements styled as buttons but built from <span> (role="button" tabindex="0")
// aren't activated by Enter/Space like real buttons. This bridges that gap.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const el = e.target;
  if (el && el.getAttribute && el.getAttribute('role') === 'button' && el.tabIndex >= 0) {
    e.preventDefault();
    el.click();
  }
});

// ---- Auth helpers ----
async function requireAuth() {
  const user = await window.pmp.auth.me();
  if (!user) { await window.pmp.nav.goto('login'); return null; }
  return user;
}
window.requireAuth = requireAuth;

// ---- Navigation with context ----
function navWithContext(page, payload) {
  try { sessionStorage.setItem('pmp.navContext', JSON.stringify(payload || {})); } catch (_) {}
  return window.pmp.nav.goto(page);
}
function takeContext() {
  try {
    const raw = sessionStorage.getItem('pmp.navContext');
    sessionStorage.removeItem('pmp.navContext');
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}
window.navWithContext = navWithContext;
window.takeContext    = takeContext;

// ---- Permission helper ----
// The role/permission matrix is the shared single source of truth in
// perm-matrix.js (loaded as window.PERM_MATRIX by the <script> before this one,
// and require()'d by src/services/permissions.js on the Node side).
// hasPerm() derives PERM_DEFAULTS from it; the Settings page builds its
// reference table and per-user override grid from the same matrix (settings.js).
// Admin role always has every permission regardless of overrides.
// Usage: hasPerm(currentUser, 'managePricing')
(function () {
  // role -> { permKey: bool } defaults, derived once from the shared matrix.
  const PERM_DEFAULTS = {};
  ['admin','manager','coordination','accountant','user'].forEach(role => {
    PERM_DEFAULTS[role] = {};
    window.PERM_MATRIX.forEach(row => { PERM_DEFAULTS[role][row.key] = !!row[role]; });
  });
  window.PERM_DEFAULTS = PERM_DEFAULTS; // consumed by settings.js for its grid defaults

  window.hasPerm = function (user, key) {
    if (!user) return false;
    if (user.role === 'admin') return true; // Admin always has full access
    const defaults = PERM_DEFAULTS[user.role] || PERM_DEFAULTS.user;
    let overrides = {};
    if (user.permissions) {
      try { overrides = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : (user.permissions || {}); }
      catch (_) {}
    }
    return overrides.hasOwnProperty(key) ? !!overrides[key] : !!defaults[key];
  };
})();

// ---- Confirm dialog (replaces browser confirm()) ----
window.confirmDialog = function ({ title, message, confirmText, cancelText, danger } = {}) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop active';
    backdrop.innerHTML =
      `<div class="modal" style="width:400px">` +
        `<div class="modal-header">${esc(title || 'Confirm')}</div>` +
        `<div class="modal-body"><p style="margin:0;font-size:13px;color:#34495e;line-height:1.6">${esc(message || 'Are you sure?')}</p></div>` +
        `<div class="modal-footer">` +
          `<button class="btn btn-cancel" id="_cdCancel">${esc(cancelText || 'Cancel')}</button>` +
          `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="_cdConfirm">${esc(confirmText || 'Confirm')}</button>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(backdrop);
    function onKey(e) { if (e.key === 'Escape') cleanup(false); }
    const cleanup = result => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    backdrop.querySelector('#_cdConfirm').addEventListener('click', () => cleanup(true));
    backdrop.querySelector('#_cdCancel').addEventListener('click',  () => cleanup(false));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) cleanup(false); });
    document.addEventListener('keydown', onKey);
  });
};

// ---- HTML escape ----
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
window.esc = esc;

// ---- Page navigation bar ----
window.initPageNav = async function (currentPage) {
  const nav = document.getElementById('pageNav');
  if (!nav) return;
  let user;
  try { user = await window.pmp.auth.me(); } catch (_) { return; }
  if (!user) return;

  const items = [
    { label: '⌂ Home',        page: 'dashboard',  perm: null },
    { label: '+ New Order',   page: 'orders_new', perm: null },
    { label: '👥 Clients',    page: 'clients',    perm: null },
    { label: '🔧 Providers',  page: 'providers',  perm: null },
    { label: '📊 Reports',    page: 'reports',    perm: null },
    { label: '📄 Invoices',   page: 'invoices',   perm: 'viewFinancial' },
    { label: '💰 Pricing',    page: 'pricing',    perm: 'managePricing' },
    { label: '⚙ Settings',    page: 'settings',   perm: 'manageSettings' },
  ];

  const activePage = currentPage === 'orders_edit' ? 'orders_new' : currentPage;

  nav.innerHTML = items
    .filter(item => !item.perm || hasPerm(user, item.perm))
    .map(item => {
      const active = item.page === activePage;
      return `<button class="nav-btn${active ? ' nav-active' : ''}"${active ? ' aria-current="page"' : ''} data-nav-page="${esc(item.page)}">${esc(item.label)}</button>`;
    })
    .join('');

  nav.querySelectorAll('[data-nav-page]').forEach(btn => {
    btn.addEventListener('click', () => window.pmp.nav.goto(btn.dataset.navPage));
  });
};

// ---- Page chrome (shared header + nav + standard wiring) ----
// Injects the shared header into <header id="appHeader">, ensures the page-nav
// element exists, fills #spanUser, wires #btnLogout and (unless back:false) #btnBack,
// then builds the nav. Returns the authenticated user, or null if not logged in
// (in which case requireAuth has already redirected to login).
//
// Options:
//   page   — current page key, passed to initPageNav for active-tab highlighting
//   title  — header title (trusted static HTML; may contain entities like &#183;)
//   search — when true, injects the header search box (#searchBox) — dashboard only
//   back   — set false to keep a page's own #btnBack handler (e.g. order forms with
//            an unsaved-changes guard); defaults to navigating to the dashboard
window.initChrome = async function ({ page, title, search, back = true } = {}) {
  const user = await requireAuth();
  if (!user) return null;

  const host = document.getElementById('appHeader');
  if (host) {
    const searchHtml = search
      ? '<div class="header-search">' +
          '<span class="search-icon">&#128269;</span>' +
          '<input class="search-input" type="text" id="searchBox" aria-label="Search records" placeholder="Search records...">' +
        '</div>'
      : '';
    host.className = 'header';
    host.innerHTML =
      '<div class="header-logo">PMP</div>' +
      '<div class="header-title">' + (title || '') + '</div>' +
      searchHtml +
      '<div class="header-user">Welcome, <strong id="spanUser">—</strong></div>' +
      '<button class="btn-logout" id="btnLogout">Logout</button>';

    // The nav sits between header and .main — create it if the page didn't.
    if (!document.getElementById('pageNav')) {
      const nav = document.createElement('nav');
      nav.id = 'pageNav';
      nav.className = 'page-nav';
      host.insertAdjacentElement('afterend', nav);
    }
  }

  const spanUser = document.getElementById('spanUser');
  if (spanUser) spanUser.textContent = user.full_name || user.username;

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', () => window.pmp.auth.logout());

  if (back) {
    const btnBack = document.getElementById('btnBack');
    if (btnBack) btnBack.addEventListener('click', () => window.pmp.nav.goto('dashboard'));
  }

  // While a password change is owed, every data API is blocked — don't show the
  // nav so the user can only use the change-password form on the settings page.
  if (!user.must_change_pwd) await initPageNav(page);
  return user;
};

// ---- 24-hour time input handler ----
// Attach to all inputs with class "time24"
// Accepts: "930" → "09:30", "1430" → "14:30", "9:30" → "09:30"
(function () {
  function initTime24(input) {
    input.addEventListener('input', function () {
      let v = this.value.replace(/[^0-9:]/g, '');
      // Auto-insert colon
      if (v.length === 3 && !v.includes(':')) {
        v = v.slice(0, 1) + ':' + v.slice(1);
      } else if (v.length === 4 && !v.includes(':')) {
        v = v.slice(0, 2) + ':' + v.slice(2);
      }
      if (v !== this.value) this.value = v;
    });

    input.addEventListener('blur', function () {
      let v = this.value.trim();
      if (!v) return;

      // Parse various formats
      v = v.replace(/[^0-9:]/g, '');
      let h, m;
      if (v.includes(':')) {
        [h, m] = v.split(':').map(Number);
      } else if (v.length <= 2) {
        h = Number(v); m = 0;
      } else if (v.length === 3) {
        h = Number(v.slice(0, 1)); m = Number(v.slice(1));
      } else {
        h = Number(v.slice(0, 2)); m = Number(v.slice(2, 4));
      }

      if (isNaN(h) || isNaN(m)) {
        this.value = '';
        this.classList.add('is-invalid');
        let _errSpan = this.parentElement && this.parentElement.querySelector('.field-error');
        if (!_errSpan) {
          _errSpan = document.createElement('span');
          _errSpan.className = 'field-error';
          this.parentElement.appendChild(_errSpan);
        }
        _errSpan.textContent = 'Invalid time — use HH:MM (24-hour)';
        return;
      }
      this.classList.remove('is-invalid');
      const _clearErr = this.parentElement && this.parentElement.querySelector('.field-error');
      if (_clearErr) _clearErr.remove();
      h = Math.max(0, Math.min(23, h));
      m = Math.max(0, Math.min(59, m));
      this.value = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');

      // Trigger change event for duration recalc
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Style feedback
    input.addEventListener('focus', function () {
      this.classList.remove('is-invalid');
      const _e = this.parentElement && this.parentElement.querySelector('.field-error');
      if (_e) _e.remove();
    });
  }

  function attachAll() {
    document.querySelectorAll('.time24').forEach(initTime24);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachAll);
  } else {
    attachAll();
  }
})();

// ---- Inline field validation helpers ----
window.setFieldError = function (el, msg) {
  if (!el) return;
  el.classList.add('is-invalid');
  let errSpan = el.parentElement && el.parentElement.querySelector('.field-error');
  if (!errSpan) {
    errSpan = document.createElement('span');
    errSpan.className = 'field-error';
    el.parentElement.appendChild(errSpan);
  }
  errSpan.textContent = msg;
};
window.clearFieldError = function (el) {
  if (!el) return;
  el.classList.remove('is-invalid');
  const errSpan = el.parentElement && el.parentElement.querySelector('.field-error');
  if (errSpan) errSpan.remove();
};
