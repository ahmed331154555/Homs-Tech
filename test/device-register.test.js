"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { deviceText, deviceMoney } = require("../utils/device-register");

test("deviceText trims text and applies the default and custom limits", () => {
  assert.equal(deviceText("  iPhone  "), "iPhone");
  assert.equal(deviceText("123456", 4), "1234");
  assert.equal(deviceText(null), "");
});

test("deviceText preserves the existing string conversion behavior", () => {
  assert.equal(deviceText(123), "123");
  assert.equal(deviceText(false), "false");
});

test("deviceMoney accepts non-negative finite amounts within the limit", () => {
  assert.equal(deviceMoney("125.50"), 125.5);
  assert.equal(deviceMoney(0), 0);
  assert.equal(deviceMoney(null), 0);
  assert.equal(deviceMoney(100000000), 100000000);
});

test("deviceMoney rejects negative, non-finite and excessive amounts", () => {
  assert.equal(Number.isNaN(deviceMoney(-1)), true);
  assert.equal(Number.isNaN(deviceMoney("not-a-number")), true);
  assert.equal(Number.isNaN(deviceMoney(Infinity)), true);
  assert.equal(Number.isNaN(deviceMoney(100000001)), true);
});


test("device register summary returns commercial stock and realized profit KPIs", async () => {
  const { registerDeviceRegisterRoutes } = require("../routes/device-register");
  const routes = new Map();
  const pool = {
    async query(sql) {
      if (sql.includes("WITH operation_costs AS")) {
        assert.match(sql, /status='تم البيع'/);
        assert.match(sql, /SUM\(o\.additional_cost\)/);
        assert.match(sql, /SUM\(parts\.parts_cost\)/);
        return { rows: [{ total: 8, ready: 2, processing: 3, sold: 3, invested: "900.00", revenue: "1500.00", realized_profit: "420.00" }] };
      }
      if (sql.includes("FROM device_register d")) return { rows: [{ id: 5, model: "iPhone 14", status: "Klaar", recorded_cost: "25.00" }] };
      throw new Error("Unexpected query: " + sql);
    }
  };
  const app = { get(path, ...handlers) { routes.set(path, handlers[handlers.length - 1]); }, post(path, ...handlers) { routes.set(path, handlers[handlers.length - 1]); }, put(path, ...handlers) { routes.set(path, handlers[handlers.length - 1]); } };
  const requirePermission = () => (_req, _res, next) => next();
  registerDeviceRegisterRoutes(app, { pool, requirePermission, deviceText: (v, max=160) => String(v ?? "").trim().slice(0,max), deviceMoney: v => Number(v) });
  let payload;
  const res = { set() { return this; }, json(value) { payload = value; return this; }, status() { return this; } };
  await routes.get("/api/admin/device-register")({ query: {} }, res);
  assert.equal(payload.devices.length, 1);
  assert.equal(payload.summary.total, 8);
  assert.equal(payload.summary.realized_profit, "420.00");
});

test("sold commercial devices cannot receive new repair or refurbishment operations", async () => {
  const { registerDeviceRegisterRoutes } = require("../routes/device-register");
  const routes = new Map();
  const queries = [];
  let inserted = false;
  const client = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM device_register WHERE id=$1 AND archived=FALSE FOR UPDATE")) {
        return { rows: [{ id: 17, device_type: "commercial", status: "تم البيع" }] };
      }
      if (sql.includes("INSERT INTO device_register_operations")) {
        inserted = true;
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); },
    put(path, ...handlers) { routes.set("PUT " + path, handlers.at(-1)); }
  };
  registerDeviceRegisterRoutes(app, {
    pool: { async connect() { return client; }, async query() { return { rows: [] }; } },
    requirePermission: () => (_req, _res, next) => next(),
    deviceText: (v, max=160) => String(v ?? "").trim().slice(0, max),
    deviceMoney: v => Number(v)
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await routes.get("POST /api/admin/device-register/:id/operations")(
    { params: { id: "17" }, body: { operationType: "refurbishment", description: "Nieuwe batterij", additionalCost: 25, salePrice: 0 } },
    response
  );
  assert.equal(response.statusCode, 409);
  assert.equal(inserted, false);
  assert.ok(queries.some(item => item.sql.includes("FOR UPDATE")));
  assert.ok(queries.some(item => item.sql === "ROLLBACK"));
});
