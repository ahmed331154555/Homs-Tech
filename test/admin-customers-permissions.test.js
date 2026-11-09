"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ADMIN_PERMISSION_KEYS } = require("../utils/admin-permissions");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("customer management permissions are separate from customer viewing", () => {
  assert.ok(ADMIN_PERMISSION_KEYS.includes("customers.view"));
  assert.ok(ADMIN_PERMISSION_KEYS.includes("customers.update"));
  assert.ok(ADMIN_PERMISSION_KEYS.includes("customers.delete"));
});

test("customer API protects each mutation with its dedicated permission", () => {
  const routes = read("routes/admin-customers.js");
  assert.match(routes, /app\.get\("\/api\/admin\/customers", requirePermission\("customers\.view"\)/);
  assert.match(routes, /app\.post\("\/api\/admin\/customers", requirePermission\("customers\.update"\)/);
  assert.match(routes, /app\.put\("\/api\/admin\/customers\/:id", requirePermission\("customers\.update"\)/);
  assert.match(routes, /app\.put\("\/api\/admin\/customers\/:id\/password", requirePermission\("customers\.update"\)/);
  assert.match(routes, /app\.delete\("\/api\/admin\/customers\/:id", requirePermission\("customers\.delete"\)/);
});

test("customer admin actions enforce view, update and delete permissions in the browser", () => {
  const script = read("assets/homs-admin.js");
  assert.match(script, /async function loadCustomers\(\)\{\s*if\(!hasPermission\("customers\.view"\)\)return;/);
  assert.match(script, /async function createCustomer\(\)\{\s*if\(!hasPermission\("customers\.update"\)\)return;/);
  assert.match(script, /async function saveCustomerEdit\(\)\{\s*if\(!hasPermission\("customers\.update"\)\)return;/);
  assert.match(script, /async function saveCustomerPassword\(\)\{\s*if\(!hasPermission\("customers\.update"\)\)return;/);
  assert.match(script, /async function deleteCustomer\(id\)\{\s*if\(!hasPermission\("customers\.delete"\)\)return;/);
});
