"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminWebshopOrderRoutes } = require("../routes/admin-webshop-orders");

const REQUIRED_CHECKS = [
  "model_storage_color", "screen_touch", "battery", "face_id_touch_id",
  "cameras", "speakers_microphone", "charging", "network_wifi_sim",
  "icloud_activation_lock", "cosmetic_condition", "cleaning",
  "accessories", "secure_packaging", "shipping_address"
];

function harness(pool) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    put(path, ...handlers) { routes.set("PUT " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers.at(-1)); }
  };
  const requirePermission = () => (_req, _res, next) => next();
  registerAdminWebshopOrderRoutes(app, {
    pool,
    requirePermission,
    deductPaidOrderInventory: async () => ({ deducted: true }),
    ensureBuybackOrdersTable: async () => {}
  });
  return routes;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("phone inspection saves all required checks and marks completion", async () => {
  let savedSql = "";
  let savedParams = [];
  const routes = harness({
    async query(sql, params) {
      savedSql = sql;
      savedParams = params;
      return { rows: [{
        order_id: 27,
        checks: JSON.parse(params[1]),
        inspected_by: "HOMS TECH Admin",
        completed_at: "2026-11-09T10:00:00Z"
      }] };
    }
  });
  const checks = Object.fromEntries(REQUIRED_CHECKS.map(key => [key, true]));
  const res = response();

  await routes.get("PUT /api/admin/webshop-orders/:id/inspection")({
    params: { id: "27" }, body: { checks }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.complete, true);
  assert.equal(res.body.required, REQUIRED_CHECKS.length);
  assert.equal(Object.values(res.body.inspection.checks).every(Boolean), true);
  assert.match(savedSql, /INSERT INTO webshop_order_inspections/);
  assert.match(savedSql, /ON CONFLICT \(order_id\) DO UPDATE/);
  assert.equal(savedParams[2], true);
});

test("partial phone inspection remains incomplete and is saved", async () => {
  const routes = harness({
    async query(sql, params) {
      return { rows: [{
        order_id: 27,
        checks: JSON.parse(params[1]),
        inspected_by: "HOMS TECH Admin",
        completed_at: null
      }] };
    }
  });
  const res = response();

  await routes.get("PUT /api/admin/webshop-orders/:id/inspection")({
    params: { id: "27" },
    body: { checks: { screen_touch: true, battery: true } }
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.complete, false);
  assert.equal(res.body.inspection.checks.screen_touch, true);
  assert.equal(res.body.inspection.checks.battery, true);
  assert.equal(Object.values(res.body.inspection.checks).filter(Boolean).length, 2);
});

test("shipping metadata is blocked until every phone inspection check is complete", async () => {
  const calls = [];
  const routes = harness({
    async query(sql) {
      calls.push(sql);
      if (sql.includes("LEFT JOIN webshop_order_inspections")) {
        return { rows: [{ items:[{type:"phone",name:"iPhone"}], checks: { screen_touch: true, battery: true } }] };
      }
      throw new Error("Shipping must not be saved before inspection");
    }
  });
  const res = response();

  await routes.get("PUT /api/admin/webshop-orders/:id/shipping")({
    params: { id: "27" },
    body: { shipping_method: "PostNL", payment_status: "Paid", tracking_number: "3S123" }
  }, res);

  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /controlepunten/i);
  assert.equal(calls.length, 1);
});

test("order cannot be marked shipped or completed before inspection is complete", async () => {
  const routes = harness({
    async query(sql) {
      if (sql.includes("SELECT checks FROM webshop_order_inspections")) {
        return { rows: [{ items:[{type:"phone",name:"iPhone"}], trade_in_order_id:null, trade_in_status:null, checks: {} }] };
      }
      throw new Error("Status update must not run before inspection");
    }
  });

  for (const status of ["Verzonden", "Voltooid"]) {
    const res = response();
    await routes.get("PUT /api/admin/webshop-orders/:id/status")({
      params: { id: "27" }, body: { status }
    }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /controlepunten/i);
  }
});
