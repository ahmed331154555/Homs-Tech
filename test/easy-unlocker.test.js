"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseEasyUnlockerCatalog } = require("../utils/easy-unlocker-catalog");
const {
  registerAdminEasyUnlockerRoutes,
} = require("../routes/admin-easy-unlocker");

const sample = {
  status: "success",
  data: {
    currency: "USD",
    categories: { C5: { name: "JCID Tools" }, C6: { name: "IMEI Check" } },
    products: {
      1: {
        name: "JCID Season card",
        type: "server",
        cid: "C5",
        price: 11.2,
        image_url: "https://static.dhrufusion.net/a.webp",
        fields: [{ type: "quantity", name: "Quantity", required: true, min: "1" }],
      },
      2: { name: "IMEI check", type: "imei", cids: ["C6"], price: "0,5", image_url: "javascript:alert(1)" },
      3: { name: "", price: 1 },
    },
  },
};

test("parser flattens the catalogue and sanitises values", () => {
  const out = parseEasyUnlockerCatalog(sample);
  assert.equal(out.currency, "USD");
  assert.equal(out.services.length, 2);
  assert.equal(out.services[0].categoryName, "JCID Tools");
  assert.equal(out.services[0].price, 11.2);
  assert.equal(out.services[1].price, 0.5);
  assert.equal(out.services[1].categoryId, "C6");
  assert.equal(out.services[1].imageUrl, "");
});

test("parser rejects files without products", () => {
  assert.throws(() => parseEasyUnlockerCatalog({ data: {} }), /products/);
  assert.throws(
    () => parseEasyUnlockerCatalog({ data: { products: { 1: { name: "" } } } }),
    /Geen diensten/,
  );
});

function harness({ env = {}, fetchImpl, rows = [] } = {}) {
  const routes = new Map();
  const permissions = [];
  const queries = [];
  const app = {};
  for (const method of ["get", "post", "patch"]) {
    app[method] = (path, ...handlers) => routes.set(method.toUpperCase() + " " + path, handlers.at(-1));
  }
  const client = {
    async query(sql, params) { queries.push({ sql, params }); return { rows: [] }; },
    release() {},
  };
  registerAdminEasyUnlockerRoutes(app, {
    requirePermission: (p) => { permissions.push(p); return (_q, _s, n) => n(); },
    queryWithConnectionRetry: async (sql, params) => { queries.push({ sql, params }); return { rows, rowCount: 1 }; },
    pool: { connect: async () => client },
    fetchImpl,
    env,
  });
  const call = async (key, req) => {
    const res = { code: 200, body: null, headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await routes.get(key)({ params: {}, query: {}, body: {}, ...req }, res);
    return res;
  };
  return { call, permissions, queries };
}

test("all routes require site.save", () => {
  const h = harness();
  assert.ok(h.permissions.length >= 1);
  assert.ok(h.permissions.every((p) => p === "site.save"));
});

test("import saves in a transaction and never overwrites published/margin", async () => {
  const h = harness();
  const res = await h.call("POST /api/admin/easy-unlocker/import", { body: sample });
  assert.equal(res.code, 200);
  assert.equal(res.body.count, 2);
  const sqls = h.queries.map((q) => q.sql);
  assert.equal(sqls[0], "BEGIN");
  assert.ok(sqls.some((s) => /ON CONFLICT/.test(s)));
  const upsert = sqls.find((s) => /ON CONFLICT/.test(s));
  assert.ok(!/published|margin_percent/.test(upsert));
  assert.equal(sqls.at(-1), "COMMIT");
});

test("import rejects an invalid file with 400", async () => {
  const res = await harness().call("POST /api/admin/easy-unlocker/import", { body: { nope: 1 } });
  assert.equal(res.code, 400);
});

test("sync reports missing configuration", async () => {
  const res = await harness({ env: {} }).call("POST /api/admin/easy-unlocker/sync", {});
  assert.equal(res.code, 503);
  assert.match(res.body.error, /EASYUNLOCKER/);
});

test("sync only sends a GET with the bearer token and never leaks it", async () => {
  const calls = [];
  const h = harness({
    env: { EASYUNLOCKER_BASE_URL: "https://api.example.com/api/reseller/v1/", EASYUNLOCKER_API_TOKEN: "SECRET-TOKEN" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, async text() { return JSON.stringify(sample); } };
    },
  });
  const res = await h.call("POST /api/admin/easy-unlocker/sync", {});
  assert.equal(res.code, 200);
  assert.equal(calls[0].url, "https://api.example.com/api/reseller/v1/products");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer SECRET-TOKEN");
  assert.ok(!JSON.stringify(res.body).includes("SECRET-TOKEN"));
});

test("a 401 from the supplier gives an IP/token hint", async () => {
  const h = harness({
    env: { EASYUNLOCKER_BASE_URL: "https://api.example.com/v1", EASYUNLOCKER_API_TOKEN: "SECRET-TOKEN" },
    fetchImpl: async () => ({ ok: false, status: 401, async text() { return "{}"; } }),
  });
  const res = await h.call("POST /api/admin/easy-unlocker/test", {});
  assert.equal(res.code, 502);
  assert.match(res.body.error, /IP-adres/);
  assert.ok(!res.body.error.includes("SECRET-TOKEN"));
});

test("non-https base URLs are refused", async () => {
  const res = await harness({ env: { EASYUNLOCKER_BASE_URL: "http://api.example.com", EASYUNLOCKER_API_TOKEN: "t" } }).call("POST /api/admin/easy-unlocker/test", {});
  assert.equal(res.code, 503);
  assert.match(res.body.error, /https/);
});

test("margin is validated", async () => {
  const h = harness({ rows: [{ product_id: "1", name: "A", price: "1", fields: [], in_catalog: true, published: false, margin_percent: "20" }] });
  const bad = await h.call("PATCH /api/admin/easy-unlocker/services/:id", { params: { id: "1" }, body: { marginPercent: 900 } });
  assert.equal(bad.code, 400);
  const ok = await h.call("PATCH /api/admin/easy-unlocker/services/:id", { params: { id: "1" }, body: { marginPercent: 20, published: true } });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.service.marginPercent, 20);
});
