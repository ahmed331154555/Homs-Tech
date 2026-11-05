"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminWebshopOrderRoutes } = require("../routes/admin-webshop-orders");

function createHarness(pool) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    put(path, ...handlers) { routes.set(`PUT ${path}`, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set(`DELETE ${path}`, handlers.at(-1)); }
  };
  const requirePermission = (permission) => {
    assert.ok(permission.startsWith("webshop_orders."));
    return (_req, _res, next) => next();
  };
  registerAdminWebshopOrderRoutes(app, { pool, requirePermission });
  return routes;
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

test("admin webshop order list returns database rows", async () => {
  const expectedOrders = [{ id: 12, name: "Customer", total: "129.00" }];
  const routes = createHarness({ async query() { return { rows: expectedOrders }; } });
  const response = createResponse();

  await routes.get("GET /api/admin/webshop-orders")({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { orders: expectedOrders });
});

test("webshop shipping rejects unsupported carriers before database update", async () => {
  let queryCalled = false;
  const routes = createHarness({ async query() { queryCalled = true; return { rows: [] }; } });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/shipping")({
    params: { id: "12" },
    body: { shipping_method: "Unknown", payment_status: "Unpaid" }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Kies alleen PostNL of DHL." });
  assert.equal(queryCalled, false);
});

test("webshop order status rejects values outside the allowed list", async () => {
  let queryCalled = false;
  const routes = createHarness({ async query() { queryCalled = true; return { rows: [] }; } });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/status")({
    params: { id: "12" },
    body: { status: "Paid" }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Ongeldige status." });
  assert.equal(queryCalled, false);
});
