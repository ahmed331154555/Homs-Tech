"use strict";

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

module.exports = { normalizeAdminPermissions };
