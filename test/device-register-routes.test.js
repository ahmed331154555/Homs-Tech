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
    "POST /api/admin/device-register/:id/sale",
    "GET /api/admin/device-register/:id/operations",
    "POST /api/admin/device-register/:id/operations",
    "POST /api/admin/device-register/:id/archive"
  ]);
  assert.deepEqual(permissions, [
    "device_register.view",
    "device_register.update",
    "device_register.update",
    "device_register.update",
    "device_register.view",
    "device_register.update",
    "device_register.update"
  ]);
});

test("device register list returns devices and disables caching", async () => {
  const devices = [{ id: 7, model: "iPhone 13" }];
  let calls = 0;
  const { routes } = createHarness({
    async query(sql, params) {
      calls += 1;
      if (calls === 1) {
        assert.match(sql, /operation_count/);
        assert.deepEqual(params, [false, null, ""]);
        return { rows: devices };
      }
      assert.match(sql, /WITH operation_costs AS/);
      return { rows: [{ total: 1, ready: 0, processing: 0, sold: 0, invested: "0", revenue: "0", realized_profit: "0" }] };
    }
  });
  const response = createResponse();

  await routes.get("GET /api/admin/device-register")({
    query: {}
  }, response);

  assert.deepEqual(response.body, { devices, summary: { total: 1, ready: 0, processing: 0, sold: 0, invested: "0", revenue: "0", realized_profit: "0" } });
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


test("device sale records a ready commercial device atomically and only once", async () => {
  const statements = [];
  let releaseCalled = false;
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: 9, device_type: "commercial", status: "جاهز للبيع", model: "iPhone 13", identifier_value: "HT-9", purchase_cost: "300.00" }] };
      if (sql.startsWith("SELECT id FROM device_register_operations")) return { rows: [] };
      if (sql.startsWith("INSERT INTO device_register_operations")) return { rows: [{ id: 33, device_id: 9, operation_type: "sale", sale_price: "499.00" }] };
      if (sql.startsWith("UPDATE device_register SET status='تم البيع'")) return { rows: [{ id: 9, identifier_value: "HT-9", model: "iPhone 13", status: "تم البيع", purchase_cost: "300.00", sale_price: "499.00" }] };
      throw new Error("Unexpected query: " + sql);
    },
    release() { releaseCalled = true; }
  };
  const { routes } = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("POST /api/admin/device-register/:id/sale")(
    { params: { id: "9" }, body: { salePrice: "499", reference: "HT-SALE-2026-01", description: "Verkoop aan klant" } },
    response
  );
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.device.status, "تم البيع");
  assert.equal(response.body.device.sale_price, "499.00");
  assert.ok(statements.some(x => x.sql === "BEGIN"));
  assert.ok(statements.some(x => x.sql === "COMMIT"));
  assert.ok(statements.some(x => x.sql.startsWith("INSERT INTO device_register_operations")));
  assert.equal(releaseCalled, true);
});

test("device sale cannot be registered before it is ready for sale", async () => {
  let insertAttempted = false;
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FOR UPDATE")) return { rows: [{ id: 9, device_type: "commercial", status: "قيد التجديد" }] };
      if (sql.startsWith("INSERT INTO device_register_operations")) insertAttempted = true;
      return { rows: [] };
    },
    release() {}
  };
  const { routes } = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("POST /api/admin/device-register/:id/sale")(
    { params: { id: "9" }, body: { salePrice: 499 } },
    response
  );
  assert.equal(response.statusCode, 409);
  assert.equal(insertAttempted, false);
});

test("generic device operations cannot bypass the dedicated sale flow", async () => {
  let queryCount = 0;
  const { routes } = createHarness({ async query() { queryCount += 1; return { rows: [] }; } });
  const response = createResponse();
  await routes.get("POST /api/admin/device-register/:id/operations")(
    { params: { id: "9" }, body: { operationType: "sale", additionalCost: 0, salePrice: 499 } },
    response
  );
  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});


test("general device update cannot mark a device as sold", async () => {
  let updateAttempted = false;
  const { routes } = createHarness({
    async query(sql) {
      if (sql.startsWith("SELECT device_type FROM device_register")) return { rows: [{ device_type: "commercial", status: "جاهز للبيع" }] };
      if (sql.startsWith("UPDATE device_register")) updateAttempted = true;
      return { rows: [] };
    }
  });
  const response = createResponse();
  await routes.get("PUT /api/admin/device-register/:id")(
    { params: { id: "9" }, body: { status: "تم البيع", purchaseCost: 300, salePrice: 499 } },
    response
  );
  assert.equal(response.statusCode, 409);
  assert.equal(updateAttempted, false);
});


test("device sale links only a paid completed webshop order containing the device model", async () => {
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM device_register WHERE id=$1") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: 9, device_type: "commercial", status: "جاهز للبيع", model: "iPhone 13", identifier_value: "HT-9", purchase_cost: "300.00" }] };
      }
      if (sql.includes("FROM webshop_orders WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 77, status: "Voltooid", payment_status: "Paid", items: [{ name: "Apple iPhone 13 128GB" }] }] };
      }
      if (sql.startsWith("SELECT id FROM device_register WHERE source_webshop_order_id")) return { rows: [] };
      if (sql.startsWith("SELECT id FROM device_register_operations")) return { rows: [] };
      if (sql.startsWith("INSERT INTO device_register_operations")) return { rows: [{ id: 33, device_id: 9, operation_type: "sale", sale_price: "499.00" }] };
      if (sql.startsWith("UPDATE device_register SET status='تم البيع'")) {
        assert.equal(params[2], 77);
        return { rows: [{ id: 9, identifier_value: "HT-9", model: "iPhone 13", status: "تم البيع", purchase_cost: "300.00", sale_price: "499.00", source_webshop_order_id: 77 }] };
      }
      throw new Error("Unexpected query: " + sql);
    },
    release() {}
  };
  const { routes } = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("POST /api/admin/device-register/:id/sale")(
    { params: { id: "9" }, body: { salePrice: 499, webshopOrderId: "77" } },
    response
  );
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.device.source_webshop_order_id, 77);
  assert.ok(statements.some(x => x.sql.includes("FROM webshop_orders WHERE id=$1 FOR UPDATE")));
  assert.ok(statements.some(x => x.sql === "COMMIT"));
});

test("device sale refuses an unpaid or unfinished webshop order", async () => {
  let saleInserted = false;
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM device_register WHERE id=$1") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: 9, device_type: "commercial", status: "جاهز للبيع", model: "iPhone 13", identifier_value: "HT-9" }] };
      }
      if (sql.includes("FROM webshop_orders WHERE id=$1 FOR UPDATE")) {
        return { rows: [{ id: 77, status: "Verzonden", payment_status: "Paid", items: [{ name: "Apple iPhone 13" }] }] };
      }
      if (sql.startsWith("INSERT INTO device_register_operations")) saleInserted = true;
      return { rows: [] };
    },
    release() {}
  };
  const { routes } = createHarness({ async connect() { return client; } });
  const response = createResponse();
  await routes.get("POST /api/admin/device-register/:id/sale")(
    { params: { id: "9" }, body: { salePrice: 499, webshopOrderId: 77 } },
    response
  );
  assert.equal(response.statusCode, 409);
  assert.equal(saleInserted, false);
});
