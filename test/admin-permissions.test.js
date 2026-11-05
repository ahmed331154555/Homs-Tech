"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAdminPermissions } = require("../utils/admin-permissions");

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
