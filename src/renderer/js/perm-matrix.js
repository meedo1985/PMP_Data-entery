// ================================================================
// perm-matrix.js — SINGLE SOURCE OF TRUTH for the role/permission matrix.
//
// Shared, no build step. Loaded two ways:
//   • Renderer (browser/Electron): via <script> before api.js → sets window.PERM_MATRIX
//   • Node main/server process:    via require('.../perm-matrix.js') → returns the array
//
// One row per permission: its key, human label, and the per-role default.
// api.js and src/services/permissions.js both DERIVE their role→permission
// defaults from this array, so policy lives in exactly one place.
// ================================================================
(function (root, factory) {
  const PERM_MATRIX = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = PERM_MATRIX; // Node
  if (root) root.PERM_MATRIX = PERM_MATRIX;                                          // renderer
})(typeof window !== 'undefined' ? window : null, function () {
  return [
    { key:'manageUsers',     label:'Manage Users',          admin:true, manager:false, coordination:false, accountant:false, user:false },
    { key:'editOrders',      label:'Create / Edit Orders',  admin:true, manager:true,  coordination:true,  accountant:true,  user:true  },
    { key:'deleteOrders',    label:'Delete Orders',         admin:true, manager:true,  coordination:false, accountant:false, user:false },
    { key:'viewFinancial',   label:'View Financial Data',   admin:true, manager:true,  coordination:false, accountant:true,  user:true  },
    { key:'managePayments',  label:'Manage Payments',       admin:true, manager:true,  coordination:false, accountant:true,  user:false },
    { key:'manageClients',   label:'Manage Clients',        admin:true, manager:true,  coordination:false, accountant:false, user:false },
    { key:'deleteClients',   label:'Delete Clients',        admin:true, manager:false, coordination:false, accountant:false, user:false },
    { key:'manageProviders', label:'Manage Providers',      admin:true, manager:true,  coordination:false, accountant:false, user:false },
    { key:'managePricing',   label:'Manage Pricing',        admin:true, manager:true,  coordination:false, accountant:false, user:false },
    { key:'manageCatalog',   label:'Manage Catalog',        admin:true, manager:true,  coordination:false, accountant:false, user:false },
    { key:'importData',      label:'Import Data',           admin:true, manager:false, coordination:false, accountant:false, user:false },
    { key:'manageSettings',  label:'Manage Settings / LAN', admin:true, manager:false, coordination:false, accountant:false, user:false },
    { key:'exportReports',   label:'Export Reports',        admin:true, manager:true,  coordination:true,  accountant:true,  user:true  },
  ];
});
