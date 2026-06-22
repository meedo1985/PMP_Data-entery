// ================================================================
// preload.js — runs in renderer, exposes window.pmp to HTML pages
// This REPLACES the old document.title polling channel.
// ================================================================
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('pmp', {
  // Auth
  auth: {
    login: (username, password) => invoke('auth:login', { username, password }),
    logout: () => invoke('auth:logout'),
    me: () => invoke('auth:me'),
    changePassword: (oldPassword, newPassword) =>
      invoke('auth:changePassword', { oldPassword, newPassword })
  },

  // Navigation (opens a new page in the same window)
  nav: {
    goto: (page) => invoke('nav:goto', page),
    NAV_PAGES: ['login','dashboard','orders_new','orders_edit','clients','providers','pricing','reports','settings','invoices']
  },

  // Users (admin)
  users: {
    list:       ()      => invoke('users:list'),
    create:     (data)  => invoke('users:create', data),
    update:     (data)  => invoke('users:update', data),
    remove:     (id)    => invoke('users:delete', id),
    updateSelf: (data)  => invoke('users:updateSelf', data)
  },

  // Clients
  clients: {
    list:    ()      => invoke('clients:list'),
    get:     (id)    => invoke('clients:get', id),
    save:    (data)  => invoke('clients:save', data),
    remove:  (id)    => invoke('clients:delete', id),
    nextWO:  (id)    => invoke('clients:nextWO', id)
  },

  // Providers
  providers: {
    list:   ()      => invoke('providers:list'),
    get:    (id)    => invoke('providers:get', id),
    save:   (data)  => invoke('providers:save', data),
    remove: (id)    => invoke('providers:delete', id)
  },

  // Orders
  orders: {
    list:    (filters) => invoke('orders:list', filters || {}),
    get:     (id)      => invoke('orders:get', id),
    save:    (data)    => invoke('orders:save', data),
    remove:  (id)      => invoke('orders:delete', id),
    recent:  (limit)   => invoke('orders:recent', limit),
    kpis:    ()        => invoke('orders:kpis')
  },

  // Payments (accountant + admin + manager)
  payments: {
    list:   (orderId) => invoke('payments:list', orderId),
    add:    (data)    => invoke('payments:add', data),
    remove: (id)      => invoke('payments:remove', id)
  },

  // Reports
  reports: {
    run:         (filters) => invoke('reports:run', filters || {}),
    summary:     (filters) => invoke('reports:summary', filters || {}),
    exportExcel: (filters) => invoke('reports:exportExcel', filters || {})
  },

  // Pricing
  pricing: {
    getDefault:       ()       => invoke('pricing:getDefault'),
    getForClient:     (cid)    => invoke('pricing:getForClient', cid),
    getForProvider:   (pid)    => invoke('pricing:getForProvider', pid),
    saveDefault:      (data)   => invoke('pricing:saveDefault', data),
    saveClientRate:   (data)   => invoke('pricing:saveClientRate', data),
    saveProviderCost: (data)   => invoke('pricing:saveProviderCost', data),
    deleteDefault:        (id) => invoke('pricing:deleteDefault', id),
    deleteClientRate:     (id) => invoke('pricing:deleteClientRate', id),
    deleteProviderCost:   (id) => invoke('pricing:deleteProviderCost', id),
    calculate:        (input)  => invoke('pricing:calculate', input)
  },

  // System
  sys: {
    userDataPath: () => invoke('sys:userDataPath'),
    version:      () => invoke('sys:version'),
    migratePreview:        () => invoke('migrate:preview'),
    migrateConfirm:        (data) => invoke('migrate:confirm', data),
    migrateCleanDuplicates: () => invoke('migrate:cleanDuplicates'),
    auditLog:         () => invoke('sys:auditLog'),
    lanStatus: () => invoke('sys:lanStatus'),
    lanToggle: (opts) => invoke('sys:lanToggle', opts),
    qrcode:    () => invoke('sys:qrcode')
  },

  // Provider Locations
  locations: {
    list:   (providerId) => invoke('locations:list', providerId),
    add:    (providerId, name) => invoke('locations:add', { providerId, name }),
    remove: (id) => invoke('locations:remove', id)
  },

  // Services Catalog
  catalog: {
    list:   (category)  => invoke('catalog:list', category || null),
    add:    (data)      => invoke('catalog:add', data),
    remove: (id)        => invoke('catalog:remove', id)
  },

  // Invoices
  invoices: {
    fields:  ()                              => invoke('invoices:fields'),
    preview: (orderId)                       => invoke('invoices:preview', orderId),
    fill:    (templatePath, orderId, outputPath) => invoke('invoices:fill', { templatePath, orderId, outputPath }),
    clientData:    (clientId, filters)       => invoke('invoices:clientData', { clientId, filters: filters || {} }),
    generateClient:(clientId, filters, format) => invoke('invoices:generateClient', { clientId, filters: filters || {}, format })
  },

  // Settings
  settings: {
    getCompany:  ()     => invoke('settings:getCompany'),
    saveCompany: (data) => invoke('settings:saveCompany', data)
  },

  // Shell utilities (safe subset — only what the renderer actually needs)
  shell: {
    openPath: (p) => require('electron').shell.openPath(p)
  },

});
