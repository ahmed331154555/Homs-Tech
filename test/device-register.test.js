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
      if (sql.includes("FROM device_register d")) return { rows: [{ id: 5, model: "iPhone 14", status: "Klaar", recorded_cost: "25.00" }] };
      if (sql.includes("WITH operation_costs AS")) {
        assert.match(sql, /status='تم البيع'/);
        assert.match(sql, /SUM\(o\.additional_cost\)/);
        assert.match(sql, /SUM\(parts\.parts_cost\)/);
        return { rows: [{ total: 8, ready: 2, processing: 3, sold: 3, invested: "900.00", revenue: "1500.00", realized_profit: "420.00" }] };
      }
      throw new Error("Unexpected query: " + sql);
    }
  };
  const app = { get(path, ...handlers) { routes.set(path, handlers[handlers.length - 1]); } };
  const requirePermission = () => (_req, _res, next) => next();
  registerDeviceRegisterRoutes(app, { pool, requirePermission, deviceText: (v, max=160) => String(v ?? "").trim().slice(0,max), deviceMoney: v => Number(v) });
  let payload;
  const res = { set() { return this; }, json(value) { payload = value; return this; }, status() { return this; } };
  await routes.get("/api/admin/device-register")({ query: {} }, res);
  assert.equal(payload.devices.length, 1);
  assert.equal(payload.summary.total, 8);
  assert.equal(payload.summary.realized_profit, "420.00");
});
