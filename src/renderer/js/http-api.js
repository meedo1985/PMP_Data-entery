// ================================================================
// http-api.js — browser-side fallback for window.pmp
//
// Loaded ONLY when running in a normal browser (not Electron).
// Creates the same window.pmp.* API surface, backed by fetch() + cookies.
// ================================================================
(function () {
  if (window.pmp) return; // Electron preload already set it up.

  async function call(path, opts) {
    try {
      const res = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        ...opts
      });
      let body = null;
      try { body = await res.json(); } catch (_) {}

      if (res.status === 401) {
        // Not authenticated — bounce to login
        if (location.pathname !== '/login' && !location.pathname.endsWith('login.html')) {
          location.href = '/login';
        }
        throw new Error('NOT_AUTHENTICATED');
      }
      if (res.status === 403) throw new Error('FORBIDDEN');
      if (!res.ok) throw new Error((body && body.error) || ('HTTP_' + res.status));
      return body && body.data !== undefined ? body.data : body;
    } catch (err) {
      console.error('[HTTP-API] Request failed:', err);
      // If a 'toast' function exists, show it, otherwise alert once
      throw err;
    }
  }

  const GET    = (p, q)    => call(p + (q ? '?' + new URLSearchParams(q) : ''));
  const POST   = (p, body) => call(p, { method: 'POST',   body: JSON.stringify(body || {}) });
  const PUT    = (p, body) => call(p, { method: 'PUT',    body: JSON.stringify(body || {}) });
  const DELETE = (p)       => call(p, { method: 'DELETE' });

  // Map navigation to real URLs served by Express
  const NAV_URLS = {
    login:       '/login',
    dashboard:   '/dashboard',
    orders_new:  '/orders/new',
    orders_edit: '/orders/edit',
    clients:     '/clients',
    providers:   '/providers',
    pricing:     '/pricing',
    reports:     '/reports',
    settings:    '/settings',
    invoices:    '/invoices'
  };

  window.pmp = {
    __transport: 'http',

    auth: {
      login: async (username, password) => {
        try {
          const r = await POST('/api/auth/login', { username, password });
          return { ok: true, user: r.user };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      },
      logout: async () => {
        await POST('/api/auth/logout');
        location.href = '/login';
        return { ok: true };
      },
      me: () => GET('/api/auth/me'),
      changePassword: (oldPassword, newPassword) =>
        POST('/api/auth/change-password', { oldPassword, newPassword })
    },

    nav: {
      goto: async (page) => {
        const u = NAV_URLS[page];
        if (!u) throw new Error('UNKNOWN_PAGE: ' + page);
        location.href = u;
        return { ok: true };
      }
    },

    users: {
      list:       ()  => GET('/api/users'),
      create:     (d) => POST('/api/users', d),
      update:     (d) => PUT('/api/users/' + d.id, d),
      remove:     (id) => DELETE('/api/users/' + id),
      updateSelf: (d) => PUT('/api/users/me', d)
    },

    clients: {
      list:    ()    => GET('/api/clients'),
      get:     (id)  => GET('/api/clients/' + id),
      save:    (d)   => d.id ? PUT('/api/clients/' + d.id, d) : POST('/api/clients', d),
      remove:  (id)  => DELETE('/api/clients/' + id),
      nextWO:  (id)  => GET('/api/clients/' + id + '/next-wo')
    },

    providers: {
      list:   ()    => GET('/api/providers'),
      get:    (id)  => GET('/api/providers/' + id),
      save:   (d)   => d.id ? PUT('/api/providers/' + d.id, d) : POST('/api/providers', d),
      remove: (id)  => DELETE('/api/providers/' + id)
    },

    orders: {
      list:    (f)   => GET('/api/orders', f || {}),
      get:     (id)  => GET('/api/orders/' + id),
      save:    (d)   => d.id ? PUT('/api/orders/' + d.id, d) : POST('/api/orders', d),
      remove:  (id)  => DELETE('/api/orders/' + id),
      recent:  (n)   => GET('/api/orders/recent', { limit: n || 50 }),
      kpis:    ()    => GET('/api/orders/kpis')
    },

    payments: {
      list:   (orderId) => GET('/api/orders/' + orderId + '/payments'),
      add:    (data)    => POST('/api/payments', data),
      remove: (id)      => DELETE('/api/payments/' + id)
    },

    reports: {
      run:     (f)   => GET('/api/reports/run', f || {}),
      summary: (f)   => GET('/api/reports/summary', f || {}),
      exportExcel: async (f) => {
        // Trigger browser download
        const qs = f ? new URLSearchParams(f).toString() : '';
        window.location.href = '/api/reports/export' + (qs ? '?' + qs : '');
        return { ok: true, browser: true };
      }
    },

    pricing: {
      getDefault:       ()      => GET('/api/pricing/default'),
      getForClient:     (cid)   => GET('/api/pricing/client/' + cid),
      getForProvider:   (pid)   => GET('/api/pricing/provider/' + pid),
      saveDefault:      (d)     => POST('/api/pricing/default', d),
      saveClientRate:   (d)     => POST('/api/pricing/client', d),
      saveProviderCost: (d)     => POST('/api/pricing/provider', d),
      deleteDefault:        (id) => DELETE('/api/pricing/default/' + id),
      deleteClientRate:     (id) => DELETE('/api/pricing/client/' + id),
      deleteProviderCost:   (id) => DELETE('/api/pricing/provider/' + id),
      calculate:        (i)     => POST('/api/pricing/calculate', i)
    },

    locations: {
      list:   (providerId) => GET('/api/providers/' + providerId + '/locations'),
      add:    (providerId, name) => POST('/api/providers/' + providerId + '/locations', { name }),
      remove: (id) => DELETE('/api/locations/' + id)
    },

    catalog: {
      list:   (category) => GET('/api/catalog', category ? { category } : undefined),
      add:    (data)     => POST('/api/catalog', data),
      remove: (id)       => DELETE('/api/catalog/' + id)
    },

    invoices: {
      fields:  ()        => GET('/api/invoices/fields'),
      preview: (orderId) => GET('/api/invoices/preview/' + orderId),
      fill:    ()        => Promise.resolve({ ok: false, error: 'Use browser download mode' }),
      clientData: (clientId, filters) => GET('/api/invoices/client/' + clientId, filters || {}),
      generateClient: async (clientId, filters, format) => {
        const qs = new URLSearchParams({ ...(filters || {}), format: format || 'excel' }).toString();
        const res = await fetch('/api/invoices/generate-client?' + qs, { credentials: 'same-origin' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err && err.error) || ('HTTP_' + res.status));
        }
        const cd = res.headers.get('Content-Disposition') || '';
        const fnMatch = cd.match(/filename="([^"]+)"/);
        const filename = fnMatch ? fnMatch[1] : `Invoice_${clientId}.${format === 'word' ? 'docx' : 'xlsx'}`;
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return { ok: true, filePath: filename };
      }
    },


    sys: {
      version:          async () => (await GET('/api/sys/info')).version,
      userDataPath:     async () => null,
      migratePreview:        async () => { throw new Error('UNAVAILABLE_IN_BROWSER'); },
      migrateConfirm:        async () => { throw new Error('UNAVAILABLE_IN_BROWSER'); },
      migrateCleanDuplicates:async () => { throw new Error('UNAVAILABLE_IN_BROWSER'); },
      auditLog:         async () => GET('/api/sys/audit-log'),
      lanStatus:        async () => GET('/api/sys/lan-status'),
      lanToggle:        async () => { throw new Error('UNAVAILABLE_IN_BROWSER'); },
      qrcode:           async () => ({ ok: false, error: 'UNAVAILABLE_IN_BROWSER' })
    },

    settings: {
      getCompany:  ()     => GET('/api/settings/company'),
      saveCompany: (data) => PUT('/api/settings/company', data)
    }
  };
})();
