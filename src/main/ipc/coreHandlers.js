const clients   = require('../../services/clients');
const providers = require('../../services/providers');
const orders    = require('../../services/orders');
const pricing   = require('../../services/pricing');
const payments  = require('../../services/payments');
const locations = require('../../services/locations');
const catalog   = require('../../services/catalog');

module.exports = ({ ipcMain, requireAuth, requireRole, requirePermission }) => {
  // Clients
  ipcMain.handle('clients:list',   requireAuth(() => clients.list()));
  ipcMain.handle('clients:get',    requireAuth((u, id) => clients.get(id)));
  ipcMain.handle('clients:save',   requirePermission('manageClients', (u, data) => clients.save(data)));
  ipcMain.handle('clients:delete', requirePermission('deleteClients', (u, id) => clients.remove(id)));
  ipcMain.handle('clients:nextWO', requireAuth((u, clientId) => clients.peekNextWO(clientId)));

  // Providers
  ipcMain.handle('providers:list',   requireAuth(() => providers.list()));
  ipcMain.handle('providers:get',    requireAuth((u, id) => providers.get(id)));
  ipcMain.handle('providers:save',   requirePermission('manageProviders', (u, data) => providers.save(data)));
  ipcMain.handle('providers:delete', requireRole(['admin'], (u, id) => providers.remove(id)));

  // Orders
  ipcMain.handle('orders:list',   requireAuth((u, filters) => orders.list(filters, u)));
  ipcMain.handle('orders:get',    requireAuth((u, id) => orders.get(id, u)));
  ipcMain.handle('orders:save',   requireAuth((u, data) => orders.save(data, u)));
  ipcMain.handle('orders:delete', requireRole(['admin','manager'], (u, id) => orders.remove(id)));
  ipcMain.handle('orders:recent', requireAuth((u, limit) => orders.recent(limit || 50, u)));
  ipcMain.handle('orders:kpis',   requireAuth((u) => orders.getKpis(u)));

  // Payments
  ipcMain.handle('payments:list', requireAuth((u, orderId) => payments.listForOrder(orderId)));
  ipcMain.handle('payments:add',  requireRole(['admin','manager','accountant'], (u, data) => payments.add(data, u)));
  ipcMain.handle('payments:remove', requireRole(['admin','manager','accountant'], (u, id) => payments.remove(id, u)));

  // Pricing
  ipcMain.handle('pricing:getDefault',       requireAuth(() => pricing.getDefault()));
  ipcMain.handle('pricing:getForClient',     requireAuth((u, clientId) => pricing.getForClient(clientId)));
  ipcMain.handle('pricing:getForProvider',   requireAuth((u, providerId) => pricing.getForProvider(providerId)));
  
  ipcMain.handle('pricing:saveDefault',      requirePermission('managePricing', (u, data) => pricing.saveDefault(data)));
  ipcMain.handle('pricing:saveClientRate',   requirePermission('managePricing', (u, data) => pricing.saveClientRate(data)));
  ipcMain.handle('pricing:saveProviderCost', requirePermission('managePricing', (u, data) => pricing.saveProviderCost(data)));

  ipcMain.handle('pricing:deleteDefault',      requirePermission('managePricing', (u, id) => pricing.deleteDefault(id)));
  ipcMain.handle('pricing:deleteClientRate',   requirePermission('managePricing', (u, id) => pricing.deleteClientRate(id)));
  ipcMain.handle('pricing:deleteProviderCost', requirePermission('managePricing', (u, id) => pricing.deleteProviderCost(id)));

  ipcMain.handle('pricing:calculate', requireAuth((u, input) => pricing.calculate(input)));

  // Catalog & Locations
  ipcMain.handle('catalog:list', requireAuth((u, cat) => cat ? catalog.listByCategory(cat) : catalog.listAll()));
  ipcMain.handle('catalog:add',    requirePermission('manageCatalog', (u, data) => catalog.add(data)));
  ipcMain.handle('catalog:remove', requirePermission('manageCatalog', (u, id) => catalog.remove(id)));

  ipcMain.handle('locations:list', requireAuth((u, pid) => locations.listForProvider(pid)));
  ipcMain.handle('locations:add',    requirePermission('manageProviders', (u, { providerId, name }) => locations.add(providerId, name)));
  ipcMain.handle('locations:remove', requirePermission('manageProviders', (u, id) => locations.remove(id)));
};