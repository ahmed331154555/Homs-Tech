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
    assert.ok(permission.startsWith("webshop_orders.") || permission.startsWith("buyback_orders."));
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
      if (sql.includes("LEFT JOIN webshop_order_inspections")) {
        return { rows: [{ items:[{type:"phone",name:"iPhone"}], checks: {
          model_storage_color:true, screen_touch:true, battery:true, face_id_touch_id:true,
          cameras:true, speakers_microphone:true, charging:true, network_wifi_sim:true,
          icloud_activation_lock:true, cosmetic_condition:true, cleaning:true,
          accessories:true, secure_packaging:true, shipping_address:true
        } }] };
      }
      if (sql.includes("UPDATE webshop_orders")) updateSql = sql;
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

test("admin can change the fulfillment status of a fully inspected paid phone order", async () => {
  let updateQuery = "";
  const routes = createHarness({
    async query(sql) {
      if(sql.includes("LEFT JOIN webshop_order_inspections")){
        assert.match(sql,/webshop_orders.items/);
        return { rows: [{ items:[{type:"phone",name:"iPhone 13"}], trade_in_order_id:null, trade_in_status:null, checks:{"model_storage_color":true,"screen_touch":true,"battery":true,"face_id_touch_id":true,"cameras":true,"speakers_microphone":true,"charging":true,"network_wifi_sim":true,"icloud_activation_lock":true,"cosmetic_condition":true,"cleaning":true,"accessories":true,"secure_packaging":true,"shipping_address":true} }] };
      }
      updateQuery = sql;
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
  assert.match(updateQuery, /NOT \(payment_status = 'Paid' AND \$1 = 'Geannuleerd'\)/);
});


test("admin cannot ship a phone order until every mandatory inspection check is saved", async () => {
  let statusUpdateCalled = false;
  const routes = createHarness({
    async query(sql) {
      if(sql.includes("LEFT JOIN webshop_order_inspections")){
        return { rows: [{ items:[{type:"phone",name:"iPhone 13"}], trade_in_order_id:null, trade_in_status:null, checks:{battery:true} }] };
      }
      statusUpdateCalled = true;
      return { rows: [{ id: 12, status: "Verzonden" }] };
    }
  });
  const response = createResponse();
  await routes.get("PUT /api/admin/webshop-orders/:id/status")({
    params:{id:"12"},body:{status:"Verzonden"}
  },response);
  assert.equal(response.statusCode,409);
  assert.match(response.body.error,/alle verplichte controlepunten/i);
  assert.equal(statusUpdateCalled,false);
});


test("shop-only order does not require phone inspection before shipping", async () => {
  const routes = createHarness({
    async query(sql) {
      if(sql.includes("LEFT JOIN webshop_order_inspections")){
        return { rows: [{ items:[{type:"shop",name:"Case"}], trade_in_order_id:null, trade_in_status:null, checks:{} }] };
      }
      return { rows: [{ id: 13, status: "Verzonden" }] };
    }
  });
  const response=createResponse();
  await routes.get("PUT /api/admin/webshop-orders/:id/status")({
    params:{id:"13"},body:{status:"Verzonden"}
  },response);
  assert.equal(response.statusCode,200);
});


test("trade-in inspection requires explicit payout confirmation even when inspected value matches estimate", async () => {
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql, params });
      if (sql.includes("SELECT id,trade_in_order_id,trade_in_estimated_value,trade_in_status")) {
        return { rows: [{ id: 31, trade_in_order_id: 77, trade_in_estimated_value: "165.00", trade_in_status: "AwaitingDevice", payment_status: "Paid" }] };
      }
      if (sql.includes("SELECT id,offered_price FROM buyback_orders")) return { rows: [{ id: 77, offered_price: "165.00" }] };
      if (sql.includes("UPDATE webshop_orders")) {
        return { rows: [{ id: 31, trade_in_order_id: 77, trade_in_estimated_value: "165.00", trade_in_inspected_value: 165, trade_in_adjustment: 0, trade_in_status: "AdjustmentRequired" }] };
      }
      if (sql.includes("UPDATE buyback_orders")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const routes = createHarness(pool);
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/trade-in-inspection")({
    params: { id: "31" },
    body: { inspectedValue: 165, reason: "Toestel gecontroleerd, waarde bevestigd." }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.order.trade_in_status, "AdjustmentRequired");
  assert.ok(statements.some(({ sql, params }) => sql.includes("UPDATE webshop_orders") && params[2] === "AdjustmentRequired"));
  assert.ok(statements.some(({ sql }) => sql === "COMMIT"));
});

test("customer can accept or reject the inspected trade-in offer using a one-time token", async () => {
  const crypto = require("node:crypto");
  const token = "a".repeat(64);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({sql,params});
      if (sql.includes("SELECT id,trade_in_order_id,trade_in_status,trade_in_snapshot")) {
        return { rows: [{ id: 31, trade_in_order_id: 77, trade_in_status: "AwaitingCustomerApproval", payment_status: "Paid", trade_in_snapshot: { customerApprovalTokenHash: tokenHash, customerApprovalExpiresAt: new Date(Date.now()+60000).toISOString() } }] };
      }
      if (sql.includes("SELECT id FROM buyback_orders")) return { rows: [{ id: 77 }] };
      return { rows: []; }
    },
    release() {}
  };
  const routes = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("POST /api/trade-in/decision")({ body: { token, decision: "accept" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "CustomerAccepted");
  assert.ok(statements.some(({sql,params}) => sql.includes("UPDATE webshop_orders") && params[0] === "CustomerAccepted"));
  assert.ok(statements.some(({sql}) => sql === "COMMIT"));
});

test("trade-in settlement cannot be completed before customer acceptance", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT id,trade_in_order_id,trade_in_status,trade_in_snapshot")) {
        return { rows: [{ id: 31, trade_in_order_id: 77, trade_in_status: "AwaitingCustomerApproval", trade_in_snapshot: {} }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const routes = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("PUT /api/admin/webshop-orders/:id/trade-in-settlement")({
    params: { id: "31" }, body: { settlementNote: "Overgemaakt naar klant op 08-11." }
  }, response);
  assert.equal(response.statusCode, 409);
});

test("trade-in payout is marked settled only after customer acceptance and admin payout note", async () => {
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql, params });
      if (sql.includes("SELECT id,trade_in_order_id,trade_in_status,trade_in_snapshot")) {
        return { rows: [{ id: 31, trade_in_order_id: 77, trade_in_status: "CustomerAccepted", payment_status: "Paid", trade_in_snapshot: {} }] };
      }
      if (sql.includes("SELECT id FROM buyback_orders")) return { rows: [{ id: 77 }] };
      if (sql.includes("UPDATE webshop_orders SET trade_in_status='Settled'")) {
        return { rows: [{ id: 31, trade_in_status: "Settled", trade_in_snapshot: { settlementNote: params[0] } }] };
      }
      if (sql.includes("UPDATE buyback_orders")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const routes = createHarness({ async connect() { return client; } });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/trade-in-settlement")({
    params: { id: "31" },
    body: { settlementNote: "Overgemaakt op 08-11-2026, bankreferentie 12345." }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.order.trade_in_status, "Settled");
  assert.ok(statements.some(({ sql }) => sql === "COMMIT"));
});


test("trade-in customer offer cannot reopen an already settled trade-in", async () => {
  let queryCount = 0;
  const routes = createHarness({
    async query() {
      queryCount += 1;
      return { rows: [{
        id: 91, email: "customer@example.com", payment_status: "Paid",
        trade_in_inspected_value: 150, trade_in_status: "Settled",
        trade_in_snapshot: {}
      }] };
    }
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/trade-in-offer")({
    params: { id: "91" }, body: {}
  }, response);

  assert.equal(response.statusCode, 409);
  assert.match(response.body.error, /definitieve inspectiewaarde/i);
  assert.equal(queryCount, 1, "settled offer must stop before changing the approval token");
});

test("trade-in customer offer requires a paid order before creating an approval link", async () => {
  let queryCount = 0;
  const routes = createHarness({
    async query() {
      queryCount += 1;
      return { rows: [{
        id: 92, email: "customer@example.com", payment_status: "Pending",
        trade_in_inspected_value: 150, trade_in_status: "AdjustmentRequired",
        trade_in_snapshot: {}
      }] };
    }
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/trade-in-offer")({
    params: { id: "92" }, body: {}
  }, response);

  assert.equal(response.statusCode, 409);
  assert.equal(queryCount, 1, "unpaid order must not receive an approval token");
});

test("trade-in customer offer requires a customer email before creating an approval link", async () => {
  let queryCount = 0;
  const routes = createHarness({
    async query() {
      queryCount += 1;
      return { rows: [{
        id: 93, email: "", payment_status: "Paid",
        trade_in_inspected_value: 150, trade_in_status: "AdjustmentRequired",
        trade_in_snapshot: {}
      }] };
    }
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/webshop-orders/:id/trade-in-offer")({
    params: { id: "93" }, body: {}
  }, response);

  assert.equal(response.statusCode, 409);
  assert.equal(queryCount, 1, "missing email must not create or rotate an approval token");
});

test("trade-in customer decision rejects an unpaid order before changing the linked buyback", async () => {
  const crypto = require("node:crypto");
  const token = "b".repeat(64);
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (sql.includes("SELECT id,trade_in_order_id,trade_in_status,trade_in_snapshot")) {
        return { rows: [{ id: 32, trade_in_order_id: 78, trade_in_status: "AwaitingCustomerApproval", payment_status: "Pending", trade_in_snapshot: { customerApprovalTokenHash: tokenHash, customerApprovalExpiresAt: new Date(Date.now()+60000).toISOString() } }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const routes = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("POST /api/trade-in/decision")({ body: { token, decision: "accept" } }, response);
  assert.equal(response.statusCode, 409);
  assert.ok(!statements.some(sql => sql.startsWith("UPDATE buyback_orders")));
  assert.ok(statements.includes("ROLLBACK"));
});

test("trade-in settlement rejects an unpaid webshop order", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("SELECT id,trade_in_order_id,trade_in_status,trade_in_snapshot")) {
        return { rows: [{ id: 33, trade_in_order_id: 79, trade_in_status: "CustomerAccepted", payment_status: "Pending", trade_in_snapshot: {} }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const routes = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("PUT /api/admin/webshop-orders/:id/trade-in-settlement")({
    params: { id: "33" }, body: { settlementNote: "Overgemaakt op 10-11." }
  }, response);
  assert.equal(response.statusCode, 409);
});
