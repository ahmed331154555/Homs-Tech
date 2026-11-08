"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminWebshopOrderRoutes } = require("../routes/admin-webshop-orders");

function createHarness(pool, deductPaidOrderInventory = async () => ({ deducted: true })) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    put(path, ...handlers) { routes.set(`PUT ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
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

test("admin webshop order list includes inventory processing diagnostics", async () => {
  const expectedOrders = [{
    id: 12,
    name: "Customer",
    total: "129.00",
    inventory_error: "Missing variant",
    status_history: [{ status: "In behandeling", created_at: "2026-11-07T12:00:00Z" }],
    notes: [{ note: "Klant terugbellen", created_by: "HOMS TECH Admin" }]
  }];
  let selectSql = "";
  const routes = createHarness({ async query(sql) { selectSql = sql; return { rows: expectedOrders }; } });
  const response = createResponse();

  await routes.get("GET /api/admin/webshop-orders")({}, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { orders: expectedOrders });
  assert.match(selectSql, /inventory_deducted_at/);
  assert.match(selectSql, /inventory_error/);
  assert.match(selectSql, /webshop_order_status_history/);
  assert.match(selectSql, /webshop_order_notes/);
});


test("admin can set payment status to Paid when the stored payment status is NULL", async () => {
  let updateSql = "";
  let deductedId = null;
  const routes = createHarness({
    async query(sql, params) {
      if (sql.startsWith("UPDATE webshop_orders")) {
        updateSql = sql;
        assert.equal(params[0], "Paid");
        return { rows: [{ id: 21, payment_status: "Paid", inventory_deducted_at: null }] };
      }
      if (sql.includes("SELECT id,payment_status,inventory_deducted_at,inventory_error")) {
        return { rows: [{ id: 21, payment_status: "Paid", inventory_deducted_at: "2026-11-07T12:00:00Z", inventory_error: "" }] };
      }
      throw new Error("Unexpected query: " + sql);
    }
  }, async (id) => { deductedId = id; return { deducted: true }; });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/payment")({
    params: { id: "21" }, body: { payment_status: "Paid" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(deductedId, 21);
  assert.match(updateSql, /COALESCE\(payment_status,'Unpaid'\) <> 'Paid' OR \$1 = 'Paid'/);
  assert.equal(response.body.order.payment_status, "Paid");
  assert.equal(response.body.inventory_warning, null);
});

test("payment status remains visibly Paid and reports stock warning when inventory deduction fails", async () => {
  const routes = createHarness({
    async query(sql) {
      if (sql.startsWith("UPDATE webshop_orders")) return { rows: [{ id: 22, payment_status: "Paid" }] };
      if (sql.includes("SELECT inventory_error")) return { rows: [{ inventory_error: "Variant not found" }] };
      if (sql.includes("SELECT id,payment_status,inventory_deducted_at,inventory_error")) {
        return { rows: [{ id: 22, payment_status: "Paid", inventory_deducted_at: null, inventory_error: "Variant not found" }] };
      }
      throw new Error("Unexpected query: " + sql);
    }
  }, async () => ({ error: true }));
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/payment")({
    params: { id: "22" }, body: { payment_status: "Paid" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.order.payment_status, "Paid");
  assert.equal(response.body.inventory_warning, "Variant not found");
});

test("admin can save an internal note on a webshop order", async () => {
  let insertSql = "";
  const routes = createHarness({
    async query(sql, params) {
      insertSql = sql;
      return { rows: [{ id: 8, note: params[1], created_by: "HOMS TECH Admin" }] };
    }
  });
  const response = createResponse();

  await routes.get("POST /api/admin/webshop-orders/:id/notes")({
    params: { id: "12" },
    body: { note: "Klant terugbellen" }
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.note.note, "Klant terugbellen");
  assert.match(insertSql, /INSERT INTO webshop_order_notes/);
});

test("webshop order notes reject empty or oversized text", async () => {
  let queryCalled = false;
  const routes = createHarness({ async query() { queryCalled = true; return { rows: [] }; } });
  const response = createResponse();

  await routes.get("POST /api/admin/webshop-orders/:id/notes")({
    params: { id: "12" },
    body: { note: "   " }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCalled, false);
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
  assert.match(updateSql, /COALESCE\(payment_status,'Unpaid'\) <> 'Paid' OR \$2 = 'Paid'/);
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
  assert.equal(calls, 3);
  assert.match(response.body.error, /kan niet worden teruggezet/i);
});


test("admin cannot delete a paid or payment-linked webshop order", async () => {
  let deleteSql = "";
  const routes = createHarness({
    async query(sql) {
      if (sql.startsWith("DELETE")) {
        deleteSql = sql;
        return { rows: [] };
      }
      return { rows: [{ id: 12, payment_status: "Paid", inventory_deducted_at: "2026-11-05T12:00:00Z" }] };
    }
  });
  const response = createResponse();

  await routes.get("DELETE /api/admin/webshop-orders/:id")({
    params: { id: "12" }
  }, response);

  assert.equal(response.statusCode, 409);
  assert.match(deleteSql, /payment_status <> 'Paid'/);
  assert.match(deleteSql, /payment_status <> 'Pending'/);
  assert.match(deleteSql, /inventory_deducted_at IS NULL/);
  assert.match(deleteSql, /paypal_order_id/);
  assert.match(deleteSql, /mollie_payment_id/);
  assert.match(response.body.error, /kan niet worden verwijderd/i);
});

test("admin can delete an unpaid webshop order with no payment provider reference", async () => {
  let lookupCalled = false;
  const routes = createHarness({
    async query(sql) {
      assert.match(sql, /^DELETE FROM webshop_orders/);
      return { rows: [{ id: 13 }] };
    }
  });
  const response = createResponse();

  await routes.get("DELETE /api/admin/webshop-orders/:id")({
    params: { id: "13" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true });
  assert.equal(lookupCalled, false);
});


test("webshop order status validates the order ID before database access", async () => {
  let queryCalled = false;
  const routes = createHarness({ async query() { queryCalled = true; return { rows: [] }; } });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/status")({
    params: { id: "0" },
    body: { status: "Geannuleerd" }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Ongeldig order-ID." });
  assert.equal(queryCalled, false);
});

test("admin cannot directly cancel a paid webshop order", async () => {
  const calls = [];
  const routes = createHarness({
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("WITH previous AS")) return { rows: [] };
      return { rows: [{ id: 12, payment_status: "Paid" }] };
    }
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/status")({
    params: { id: "12" },
    body: { status: "Geannuleerd" }
  }, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.body.error, /betaalde bestelling kan niet rechtstreeks worden geannuleerd/i);
  assert.match(calls[0].sql, /NOT \(payment_status = 'Paid' AND \$1 = 'Geannuleerd'\)/);
  assert.equal(calls[0].params[1], 12);
  assert.equal(calls.length, 2);
});

test("admin can change the fulfillment status of a paid webshop order without changing payment state", async () => {
  let query = "";
  const routes = createHarness({
    async query(sql) {
      query = sql;
      return { rows: [{ id: 12, status: "Verzonden" }] };
    }
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/status")({
    params: { id: "12" },
    body: { status: "Verzonden" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, order: { id: 12, status: "Verzonden" } });
  assert.match(query, /NOT \(payment_status = 'Paid' AND \$1 = 'Geannuleerd'\)/);
});
