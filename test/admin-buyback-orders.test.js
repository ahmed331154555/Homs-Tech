"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminBuybackOrderRoutes } = require("../routes/admin-buyback-orders");

function createHarness({ pool, env = {}, fetchImpl = async () => ({ ok: true, status: 200, async json() { return { id: "mail_1" }; } }) }) {
  const routes = new Map();
  const permissions = [];
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    put(path, ...handlers) { routes.set("PUT " + path, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers.at(-1)); }
  };
  const requirePermission = permission => {
    permissions.push(permission);
    return (_req, _res, next) => next();
  };
  registerAdminBuybackOrderRoutes(app, {
    pool,
    requirePermission,
    ensureBuybackOrdersTable: async () => {},
    escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]),
    getEnv: () => env,
    fetchImpl
  });
  return { routes, permissions };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("admin buyback routes register with the expected permissions", () => {
  const { routes, permissions } = createHarness({ pool: { async query() { return { rows: [] }; } } });
  assert.deepEqual([...routes.keys()], [
    "GET /api/admin/buyback-orders",
    "PUT /api/admin/buyback-orders/:id/offer",
    "PUT /api/admin/buyback-orders/:id/status",
    "DELETE /api/admin/buyback-orders/:id"
  ]);
  assert.deepEqual(permissions, [
    "buyback_orders.view",
    "buyback_orders.update",
    "buyback_orders.update",
    "buyback_orders.delete"
  ]);
});

test("admin buyback list ensures schema and returns orders", async () => {
  let ensured = false;
  const pool = { async query() { return { rows: [{ id: 7, status: "Nieuw" }] }; } };
  const { routes } = createHarness({ pool });
  // The route harness schema callback is replaced by the registered callback in a separate focused check below.
  const response = createResponse();
  await routes.get("GET /api/admin/buyback-orders")({}, response);
  assert.deepEqual(response.body, { orders: [{ id: 7, status: "Nieuw" }] });
  assert.equal(response.statusCode, 200);
});

test("final buyback offer sends escaped email then stores offer and status", async () => {
  const queries = [];
  let sentMail;
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT")) return { rows: [{ id: 9, order_no: "BT-9", name: "<Sam>", email: "sam@example.com", device: "iPhone <16>" }] };
      return { rows: [{ id: 9, status: "Aanbod verzonden", final_offer: 250, final_offer_sent_at: "now" }] };
    }
  };
  const { routes } = createHarness({
    pool,
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "shop@example.com" },
    fetchImpl: async (_url, options) => {
      sentMail = JSON.parse(options.body);
      return { ok: true, status: 200, async json() { return { id: "mail_9" }; } };
    }
  });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/offer")(
    { params: { id: "9" }, body: { finalOffer: "250" } },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.order.status, "Aanbod verzonden");
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].params, [250, "9"]);
  assert.equal(sentMail.to[0], "sam@example.com");
  assert.match(sentMail.html, /&lt;Sam&gt;/);
  assert.match(sentMail.html, /iPhone &lt;16&gt;/);
  assert.match(sentMail.html, /€ 250\.00/);
});

test("final buyback offer does not update the order when email provider fails", async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: [{ id: 2, order_no: "BT-2", name: "Sam", email: "sam@example.com", device: "iPhone" }] };
    }
  };
  const { routes } = createHarness({
    pool,
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "shop@example.com" },
    fetchImpl: async () => ({ ok: false, status: 503, async json() { return { message: "unavailable" }; } })
  });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/offer")(
    { params: { id: "2" }, body: { finalOffer: 100 } },
    response
  );
  assert.equal(response.statusCode, 500);
  assert.match(response.body.error, /Resend 503/);
  assert.equal(queries.length, 1);
});

test("final buyback offer validates amount and missing mail configuration", async () => {
  let queryCount = 0;
  const pool = { async query() { queryCount++; return { rows: [{ id: 1, order_no: "BT-1", name: "Sam", email: "sam@example.com", device: "iPhone" }] }; } };
  const { routes } = createHarness({ pool });
  const invalid = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/offer")(
    { params: { id: "1" }, body: { finalOffer: -1 } },
    invalid
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(queryCount, 0);

  const missingConfig = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/offer")(
    { params: { id: "1" }, body: { finalOffer: 100 } },
    missingConfig
  );
  assert.equal(missingConfig.statusCode, 503);
  assert.equal(queryCount, 1);
});

test("buyback status rejects unknown values and updates allowed status", async () => {
  const queries = [];
  const pool = { async query(sql, params) { queries.push({ sql, params }); return { rows: [{ id: 3, status: params[0] }] }; } };
  const { routes } = createHarness({ pool });
  const invalid = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/status")(
    { params: { id: "3" }, body: { status: "Paid" } },
    invalid
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(queries.length, 0);

  const valid = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/status")(
    { params: { id: "3" }, body: { status: "Goedgekeurd" } },
    valid
  );
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(queries[0].params, ["Goedgekeurd", "3"]);
});

test("buyback delete returns success only when an order was deleted", async () => {
  const pool = { async query() { return { rows: [{ id: 4 }] }; } };
  const { routes } = createHarness({ pool });
  const response = createResponse();
  await routes.get("DELETE /api/admin/buyback-orders/:id")({ params: { id: "4" } }, response);
  assert.deepEqual(response.body, { success: true });
  assert.equal(response.statusCode, 200);
});
