"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminWebshopOrderRoutes } = require("../routes/admin-webshop-orders");

function createHarness(pool, deductPaidOrderInventory = async () => ({ deducted: true })) {
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
  registerAdminWebshopOrderRoutes(app, { pool, requirePermission, deductPaidOrderInventory });
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


test("admin marking a webshop order Paid deducts inventory", async () => {
  let deductionOrderId = null;
  let updateSql = "";
  const routes = createHarness({
    async query(sql) {
      updateSql = sql;
      return { rows: [{ id: 12, payment_status: "Paid", shipping_method: "PostNL" }] };
    }
  }, async (id) => {
    deductionOrderId = id;
    return { deducted: true };
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/shipping")({
    params: { id: "12" },
    body: { shipping_method: "PostNL", payment_status: "Paid" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(deductionOrderId, 12);
  assert.match(updateSql, /payment_status <> 'Paid' OR \$2 = 'Paid'/);
  assert.deepEqual(response.body, {
    success: true,
    order: { id: 12, payment_status: "Paid", shipping_method: "PostNL" }
  });
});

test("admin Paid update reports a stock deduction failure without hiding it", async () => {
  const routes = createHarness({
    async query() {
      return { rows: [{ id: 12, payment_status: "Paid" }] };
    }
  }, async () => ({ error: true }));
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/shipping")({
    params: { id: "12" },
    body: { payment_status: "Paid" }
  }, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.body.error, /voorraad kon niet worden bijgewerkt/i);
});

test("admin cannot revert a paid webshop order to Unpaid", async () => {
  let calls = 0;
  const routes = createHarness({
    async query(sql) {
      calls += 1;
      if (sql.startsWith("UPDATE")) return { rows: [] };
      return { rows: [{ id: 12, payment_status: "Paid", inventory_deducted_at: "2026-11-05T12:00:00Z" }] };
    }
  }, async () => {
    throw new Error("Inventory must not be deducted for a rejected downgrade.");
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/shipping")({
    params: { id: "12" },
    body: { payment_status: "Unpaid" }
  }, response);

  assert.equal(response.statusCode, 409);
  assert.equal(calls, 2);
  assert.match(response.body.error, /kan niet worden teruggezet/i);
});
