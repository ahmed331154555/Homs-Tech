"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminOrderRoutes } = require("../routes/admin-orders");

function createRouteHarness(pool) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); },
    put(path, ...handlers) { routes.set(`PUT ${path}`, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set(`DELETE ${path}`, handlers.at(-1)); }
  };
  const requirePermission = (permission) => {
    assert.ok(permission.startsWith("orders."));
    return (_req, _res, next) => next();
  };

  registerAdminOrderRoutes(app, { pool, requirePermission });
  return routes;
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    set(name, value) { this.headers[name] = value; return this; },
    send(value) { this.body = value; return this; }
  };
}

test("admin order list replaces repair photo data URLs with on-demand URLs", async () => {
  const pool = {
    async query() {
      return { rows: [{
        id: 42,
        service_category: "reparatie",
        extra_fields: JSON.stringify({
          repairQuote: true,
          photos: [
            { name: "front.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,SECRET" },
            { dataUrl: "data:image/png;base64,SECRET2" }
          ],
          note: "keep me"
        })
      }] };
    }
  };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("GET /api/admin/orders")({}, response);

  assert.equal(response.statusCode, 200);
  const metadata = JSON.parse(response.body.orders[0].extra_fields);
  assert.deepEqual(metadata.photos, [
    { name: "front.jpg", type: "image/jpeg", url: "/api/admin/repair-requests/42/photos/0" },
    { name: "foto-2", type: "image/jpeg", url: "/api/admin/repair-requests/42/photos/1" }
  ]);
  assert.equal(metadata.note, "keep me");
  assert.equal(JSON.stringify(response.body).includes("SECRET"), false);
});

test("admin order status rejects unsupported values without querying the database", async () => {
  let queryCalled = false;
  const pool = { async query() { queryCalled = true; return { rows: [] }; } };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("PUT /api/admin/orders/:id/status")({ body: { status: "paid" }, params: { id: "5" } }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Ongeldige status." });
  assert.equal(queryCalled, false);
});

test("admin order deletion validates the ID before issuing a query", async () => {
  let queryCalled = false;
  const pool = { async query() { queryCalled = true; return { rows: [] }; } };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("DELETE /api/admin/orders/:id")({ params: { id: "0" } }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Ongeldig order-ID." });
  assert.equal(queryCalled, false);
});
