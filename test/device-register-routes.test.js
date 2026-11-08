"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerDeviceRegisterRoutes } = require("../routes/device-register");
const { deviceText, deviceMoney } = require("../utils/device-register");

function createHarness(pool) {
  const routes = new Map();
  const permissions = [];
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers.at(-1));
    },
    post(path, ...handlers) {
      routes.set("POST " + path, handlers.at(-1));
    },
    put(path, ...handlers) {
      routes.set("PUT " + path, handlers.at(-1));
    }
  };
  const requirePermission = permission => {
    permissions.push(permission);
    return (_req, _res, next) => next();
  };
  registerDeviceRegisterRoutes(app, {
    pool,
    requirePermission,
    deviceText,
    deviceMoney
  });
  return { routes, permissions };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test("device register routes are protected by the correct permissions", () => {
  const { routes, permissions } = createHarness({ async query() { return { rows: [] }; } });
  assert.deepEqual([...routes.keys()], [
    "GET /api/admin/device-register",
    "POST /api/admin/device-register",
    "PUT /api/admin/device-register/:id",
    "GET /api/admin/device-register/:id/operations",
    "POST /api/admin/device-register/:id/operations",
    "POST /api/admin/device-register/:id/archive"
  ]);
  assert.deepEqual(permissions, [
    "device_register.view",
    "device_register.update",
    "device_register.update",
    "device_register.view",
    "device_register.update",
    "device_register.update"
  ]);
});

test("device register list returns devices and disables caching", async () => {
  const devices = [{ id: 7, model: "iPhone 13" }];
  const { routes } = createHarness({
    async query(sql, params) {
      assert.match(sql, /operation_count/);
      assert.deepEqual(params, [false, null, ""]);
      return { rows: devices };
    }
  });
  const response = createResponse();

  await routes.get("GET /api/admin/device-register")({
    query: {}
  }, response);

  assert.deepEqual(response.body, { devices });
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("device register create rejects invalid input before database access", async () => {
  let queryCount = 0;
  const { routes } = createHarness({
    async query() {
      queryCount += 1;
      return { rows: [] };
    }
  });
  const response = createResponse();

  await routes.get("POST /api/admin/device-register")({
    body: { deviceType: "unknown" }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});

test("device register update validates ID before database access", async () => {
  let queryCount = 0;
  const { routes } = createHarness({
    async query() {
      queryCount += 1;
      return { rows: [] };
    }
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/device-register/:id")({
    params: { id: "0" },
    body: {}
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});

test("device operation rejects invalid operation type before database access", async () => {
  let queryCount = 0;
  const { routes } = createHarness({
    async query() {
      queryCount += 1;
      return { rows: [] };
    }
  });
  const response = createResponse();

  await routes.get("POST /api/admin/device-register/:id/operations")({
    params: { id: "12" },
    body: { operationType: "unsupported", additionalCost: 0, salePrice: 0 }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});

test("device archive validates ID before database access", async () => {
  let queryCount = 0;
  const { routes } = createHarness({
    async query() {
      queryCount += 1;
      return { rows: [] };
    }
  });
  const response = createResponse();

  await routes.get("POST /api/admin/device-register/:id/archive")({
    params: { id: "not-an-id" },
    body: { archived: true }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});
