"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ADMIN_PERMISSION_KEYS, normalizeAdminPermissions, sanitizeStoredAdminPermissions } = require("../utils/admin-permissions");

const allowed = ["orders.view", "site.save", "admins.manage", "device_register.view"];

test("admin permissions accepts only known permission keys and removes duplicates", () => {
  assert.deepEqual(normalizeAdminPermissions(["orders.view", "orders.view", "device_register.view"], allowed), {
    permissions: ["orders.view", "device_register.view"]
  });
});

test("admin permissions rejects wildcard and unknown permission escalation", () => {
  assert.match(normalizeAdminPermissions(["*"], allowed).error, /niet toegestaan/i);
  assert.match(normalizeAdminPermissions(["admins.manage", "root"], allowed).error, /niet toegestaan/i);
});

test("admin permissions safely defaults non-array input to no permissions", () => {
  assert.deepEqual(normalizeAdminPermissions("*", allowed), { permissions: [] });
});

test("stored permissions are filtered against the application permission allowlist", () => {
  assert.deepEqual(
    sanitizeStoredAdminPermissions(["*", "orders.view", "root", "site.save", "orders.view"]),
    ["orders.view", "site.save"]
  );
  assert.ok(ADMIN_PERMISSION_KEYS.includes("device_register.update"));
});
