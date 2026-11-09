"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminBuybackOrderRoutes } = require("../routes/admin-buyback-orders");

function registerDeleteRoute(pool) {
  let handler;
  const app = new Proxy({}, {
    get(_target, method) {
      return (path, ...handlers) => {
        if (method === "delete" && path === "/api/admin/buyback-orders/:id") handler = handlers.at(-1);
      };
    }
  });
  registerAdminBuybackOrderRoutes(app, {
    pool,
    requirePermission: (_permission, _options) => (_req, _res, next) => next()
  });
  assert.equal(typeof handler, "function", "delete route should be registered");
  return handler;
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("buyback deletion rejects invalid IDs before querying the database", async () => {
  let queryCalled = false;
  const handler = registerDeleteRoute({ async query() { queryCalled = true; return { rows: [] }; } });
  const res = createResponse();

  await handler({ params: { id: "not-a-number" } }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Ongeldig aanvraag-ID.");
  assert.equal(queryCalled, false);
});

test("buyback deletion only targets standalone sale requests", async () => {
  let queryText = "";
  let queryParams = null;
  const handler = registerDeleteRoute({
    async query(sql, params) {
      queryText = sql;
      queryParams = params;
      return { rows: [{ id: 52 }] };
    }
  });
  const res = createResponse();

  await handler({ params: { id: "52" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.match(queryText, /trade_in\s*=\s*FALSE/i);
  assert.deepEqual(queryParams, [52]);
});
