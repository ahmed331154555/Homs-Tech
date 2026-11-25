"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerEasyUnlockerPublicRoutes,
  salePriceEur,
  cleanRate,
} = require("../routes/easy-unlocker-public");

function setup(rows) {
  const routes = {};
  const app = {};
  for (const m of ["get", "post", "put", "patch"]) {
    app[m] = (path, ...handlers) => {
      routes[m + " " + path] = handlers[handlers.length - 1];
    };
  }
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    return rows(sql, params);
  };
  registerEasyUnlockerPublicRoutes(app, {
    requirePermission: () => (_q, _s, next) => next(),
    queryWithConnectionRetry: query,
  });
  return { routes, calls };
}

function run(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      set() {},
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
    };
    handler({ ip: "1.1.1.1", body: {}, params: {}, ...req }, res);
  });
}

test("salePriceEur applies margin and rate, null without rate", () => {
  assert.equal(salePriceEur(100, 10, 0.9), 99);
  assert.equal(salePriceEur(70.8, null, 0.5), 35.4);
  assert.equal(salePriceEur(100, 10, null), null);
});

test("cleanRate accepts comma decimals and rejects junk", () => {
  assert.equal(cleanRate("0,86"), 0.86);
  assert.equal(cleanRate("0"), null);
  assert.equal(cleanRate("abc"), null);
  assert.equal(cleanRate("11"), null);
});

const svcRow = {
  product_id: "7", name: "Svc", category_name: "Cat", image_url: "", price: "100",
  margin_percent: "10", published: true, in_catalog: true,
  fields: [{ name: "username", type: "text", required: true }],
};

test("public list only exposes safe fields", async () => {
  const { routes } = setup((sql) =>
    sql.includes("eu_config") ? { rows: [{ value: "0.9" }] } : { rows: [svcRow] });
  const out = await run(routes["get /api/easy-unlocker/services"], {});
  assert.equal(out.body.services[0].priceEur, 99);
  assert.equal(out.body.services[0].price, undefined);
  assert.equal(out.body.services[0].uuid, undefined);
});

test("request validates fields and stores a row", async () => {
  const { routes, calls } = setup((sql) => {
    if (sql.includes("eu_config")) return { rows: [{ value: "0.9" }] };
    if (sql.includes("FROM eu_services")) return { rows: [svcRow] };
    return { rows: [] };
  });
  const post = routes["post /api/easy-unlocker/requests"];
  const bad = await run(post, { body: { serviceId: "7", name: "Ali", email: "x", fields: {} } });
  assert.equal(bad.status, 400);
  const missing = await run(post, { body: { serviceId: "7", name: "Ali", email: "a@b.nl", fields: {} } });
  assert.equal(missing.status, 400);
  const ok = await run(post, { body: { serviceId: "7", name: "Ali", email: "A@B.nl", fields: { username: "ali" } } });
  assert.equal(ok.status, 201);
  const insert = calls.find((c) => c.sql.includes("INSERT INTO eu_requests"));
  assert.equal(insert.params[2], 99);
  assert.equal(insert.params[4], "a@b.nl");
});

test("honeypot and unknown service are handled", async () => {
  const { routes } = setup((sql) =>
    sql.includes("FROM eu_services") ? { rows: [] } : { rows: [] });
  const post = routes["post /api/easy-unlocker/requests"];
  const bot = await run(post, { body: { website: "spam" } });
  assert.equal(bot.status, 200);
  const none = await run(post, { body: { serviceId: "9", name: "Ali", email: "a@b.nl" } });
  assert.equal(none.status, 404);
});

test("request status update rejects invalid values", async () => {
  const { routes } = setup(() => ({ rows: [{ id: 1 }] }));
  const patch = routes["patch /api/admin/easy-unlocker/requests/:id"];
  assert.equal((await run(patch, { params: { id: "1" }, body: { status: "hack" } })).status, 400);
  assert.equal((await run(patch, { params: { id: "1" }, body: { status: "paid" } })).status, 200);
});
