"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminOrderRoutes } = require("../routes/admin-orders");

function createHarness({ order, env = {}, fetchResponse = { ok: true, status: 200, json: async () => ({ id: "email_123" }) } }) {
  const routes = new Map();
  const queries = [];
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); },
    put(path, ...handlers) { routes.set("PUT " + path, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers.at(-1)); }
  };
  const pool = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.startsWith("SELECT id, name, email")) return { rows: order ? [order] : [] };
      if (sql.includes("SET price =")) {
        return { rows: [{ id: order.id, price: values[0], status: "Wacht op klant", extra_fields: values[1] }] };
      }
      if (sql.includes("SET extra_fields =")) {
        return { rows: [{ id: order.id, price: "85,50", status: "Wacht op klant", extra_fields: values[0] }] };
      }
      throw new Error("Unexpected SQL in test: " + sql);
    }
  };
  const fetchCalls = [];
  registerAdminOrderRoutes(app, {
    pool,
    requirePermission: () => (_req, _res, next) => next(),
    escapeHtml: value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]),
    fetchImpl: async (...args) => { fetchCalls.push(args); return fetchResponse; },
    getEnv: () => env
  });

  const handler = routes.get("POST /api/admin/repair-requests/:id/offer");
  assert.equal(typeof handler, "function", "repair offer POST route must be registered");

  const response = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  return { handler, queries, fetchCalls, response };
}

test("registers the repair offer endpoint and saves the offer before sending email", async () => {
  const order = {
    id: 42, name: "Jan", email: "jan@example.nl", service_name: "iPhone 14",
    notes: "Gebarsten scherm", extra_fields: JSON.stringify({ repairQuote: true, brand: "Apple", model: "iPhone 14" })
  };
  const h = createHarness({
    order,
    env: { RESEND_API_KEY: "test_key", RESEND_FROM_EMAIL: "HOMS TECH <noreply@homs-tech.nl>" }
  });

  await h.handler({ params: { id: "42" }, body: { price: "85,50", message: "Wij kunnen dit herstellen.", duration: "1 dag", validity: "14 dagen" } }, h.response);

  assert.equal(h.response.statusCode, 200);
  assert.equal(h.response.payload.success, true);
  assert.equal(h.response.payload.emailSent, true);
  assert.equal(h.queries.length, 3);
  assert.match(h.queries[1].sql, /SET price = \$1, status = 'Wacht op klant'/);
  assert.equal(h.queries[1].values[0], "85,50");
  assert.equal(h.fetchCalls.length, 1);
  const email = JSON.parse(h.fetchCalls[0][1].body);
  assert.deepEqual(email.to, ["jan@example.nl"]);
  assert.match(email.subject, /#42/);
});

test("saves the quote and returns a clear warning when Resend is not configured", async () => {
  const order = { id: 7, name: "Sam", email: "sam@example.nl", service_name: "iPhone", notes: "", extra_fields: JSON.stringify({ repairQuote: true }) };
  const h = createHarness({ order });

  await h.handler({ params: { id: "7" }, body: { price: "100", message: "Prijsindicatie" } }, h.response);

  assert.equal(h.response.statusCode, 200);
  assert.equal(h.response.payload.success, true);
  assert.equal(h.response.payload.emailSent, false);
  assert.match(h.response.payload.warning, /RESEND_API_KEY/);
  assert.equal(h.queries.length, 2);
  assert.equal(h.fetchCalls.length, 0);
});

test("rejects invalid prices without changing the order", async () => {
  const order = { id: 9, name: "Sam", email: "sam@example.nl", extra_fields: JSON.stringify({ repairQuote: true }) };
  const h = createHarness({ order });

  await h.handler({ params: { id: "9" }, body: { price: "-1", message: "Prijsindicatie" } }, h.response);

  assert.equal(h.response.statusCode, 400);
  assert.equal(h.queries.length, 0);
});

test("refuses to create an offer for an order that is not a repair quote", async () => {
  const order = { id: 10, name: "Sam", email: "sam@example.nl", extra_fields: JSON.stringify({ repairQuote: false }) };
  const h = createHarness({ order });

  await h.handler({ params: { id: "10" }, body: { price: "80", message: "Prijsindicatie" } }, h.response);

  assert.equal(h.response.statusCode, 400);
  assert.match(h.response.payload.error, /geen repair request/);
  assert.equal(h.queries.length, 1);
});
