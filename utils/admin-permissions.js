"use strict";

const ADMIN_PERMISSION_KEYS = Object.freeze([
  "general.view", "services.view", "phones.view", "phones.update",
  "categories.view", "why.view", "customers.view", "customers.update", "customers.delete",
  "orders.view", "orders.update", "orders.delete",
  "webshop_orders.view", "webshop_orders.update", "webshop_orders.delete",
  "buyback_orders.view", "buyback_orders.update", "buyback_orders.delete",
  "device_register.view", "device_register.update",
  "site.save", "search", "admins.manage"
]);

function normalizeAdminPermissions(value, allowedPermissions) {
  if (!Array.isArray(value)) return { permissions: [] };
  const permissions = [...new Set(value.map(permission => String(permission)))];
  const allowed = new Set(Array.isArray(allowedPermissions) ? allowedPermissions : []);
  const invalid = permissions.filter(permission => !allowed.has(permission));
  if (invalid.length) {
    return { error: "Een of meer gekozen beheerdersrechten zijn niet toegestaan." };
  }
  return { permissions };
}

function sanitizeStoredAdminPermissions(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(ADMIN_PERMISSION_KEYS);
  return [...new Set(value.map(String).filter(permission => allowed.has(permission)))];
}

module.exports = {
  ADMIN_PERMISSION_KEYS,
  normalizeAdminPermissions,
  sanitizeStoredAdminPermissions
};
