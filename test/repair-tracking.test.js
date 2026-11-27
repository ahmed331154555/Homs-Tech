"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  registerRepairTrackingRoutes,
  ensureRepairTrackingSchema,
  publicLabel,
} = require("../routes/repair-tracking");

function harness(queryImpl, extra = {}) {
  const routes = new Map();
  const queries = [];
  const app = {};
  for (const m of ["get", "post", "put", "delete"]) {
    app[m] = (path, ...h) => routes.set(`${m.toUpperCase()} ${path}`, h.at(-1));
  }
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return queryImpl(sql, params);
    },
  };
  registerRepairTrackingRoutes(app, {
    pool,
    requirePermission: () => (_q, _s, n) => n(),
    escapeHtml: (v) => String(v),
    ...extra,
  });
  return { routes, queries };
}

function res() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

test("tracking maps internal statuses to customer labels", () => {
  assert.equal(publicLabel("Nieuw"), "Aanvraag ontvangen");
  assert.equal(publicLabel("Wacht op klant"), "Wacht op uw reactie");
  assert.equal(publicLabel("Onbekend"), "Onbekend");
});

test("public lookup requires a number and a valid email", async () => {
  const { routes } = harness(async () => ({ rows: [] }));
  const r = res();
  await routes.get("POST /api/repair/track")({ ip: "1.1.1.1", body: { requestNo: "abc", email: "x" } }, r);
  assert.equal(r.statusCode, 400);
});

test("public lookup returns 404 for a wrong email and never leaks details", async () => {
  const { routes, queries } = harness(async () => ({ rows: [] }));
  const r = res();
  await routes.get("POST /api/repair/track")({ ip: "1.1.1.2", body: { requestNo: "12", email: "A@B.nl" } }, r);
  assert.equal(r.statusCode, 404);
  assert.deepEqual(queries[0].params, [12, "a@b.nl"]);
  assert.match(queries[0].sql, /LOWER\(email\) = \$2/);
});

test("public lookup returns timeline, visible messages and a price only when numeric", async () => {
  const at = new Date("2026-11-27T10:00:00Z");
  const { routes } = harness(async (sql) => {
    if (sql.includes("FROM service_orders")) {
      return { rows: [{ id: 12, service_name: "Apple iPhone 13", price: "89,00", status: "In behandeling", created_at: at }] };
    }
    return {
      rows: [
        { kind: "status", status: "Nieuw", note: "", created_at: at },
        { kind: "message", status: null, note: "Scherm is binnen", created_at: at },
        { kind: "status", status: "In behandeling", note: "", created_at: at },
      ],
    };
  });
  const r = res();
  await routes.get("POST /api/repair/track")({ ip: "1.1.1.3", body: { requestNo: "#12", email: "a@b.nl" } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.price, "89,00");
  assert.equal(r.body.label, "In behandeling");
  assert.deepEqual(r.body.timeline.map((t) => t.type), ["status", "message", "status"]);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(JSON.stringify(r.body).includes("internal"), false);
});

test("public lookup hides 'Op aanvraag' and falls back for orders without history", async () => {
  const at = new Date("2026-11-20T10:00:00Z");
  const { routes } = harness(async (sql) =>
    sql.includes("FROM service_orders")
      ? { rows: [{ id: 5, service_name: "X", price: "Op aanvraag", status: "Nieuw", created_at: at }] }
      : { rows: [] },
  );
  const r = res();
  await routes.get("POST /api/repair/track")({ ip: "1.1.1.4", body: { requestNo: "5", email: "a@b.nl" } }, r);
  assert.equal(r.body.price, null);
  assert.equal(r.body.timeline.length, 1);
  assert.equal(r.body.timeline[0].label, "Aanvraag ontvangen");
});

test("public lookup is rate limited per IP", async () => {
  const { routes } = harness(async () => ({ rows: [] }));
  let last;
  for (let i = 0; i < 13; i += 1) {
    last = res();
    await routes.get("POST /api/repair/track")({ ip: "9.9.9.9", body: { requestNo: "1", email: "a@b.nl" } }, last);
  }
  assert.equal(last.statusCode, 429);
});

test("admin notes: empty is rejected, visible notes become customer messages", async () => {
  const { routes, queries } = harness(async (sql) =>
    sql.startsWith("SELECT 1") ? { rows: [{ "?column?": 1 }] } : { rows: [] },
  );
  const bad = res();
  await routes.get("POST /api/admin/orders/:id/notes")({ params: { id: "3" }, body: { note: "  " } }, bad);
  assert.equal(bad.statusCode, 400);
  const ok = res();
  await routes.get("POST /api/admin/orders/:id/notes")({ params: { id: "3" }, body: { note: "Scherm besteld", visible: true } }, ok);
  assert.equal(ok.statusCode, 201);
  const insert = queries.find((q) => q.sql.includes("INSERT INTO repair_order_events"));
  assert.deepEqual(insert.params, [3, "message", "Scherm besteld", true]);
});

test("notify needs email configuration and sends the status label", async () => {
  const { routes } = harness(async () => ({ rows: [{ id: 3, name: "Ali", email: "a@b.nl", service_name: "iPhone", status: "Voltooid" }] }), {
    getEnv: () => ({}),
  });
  const off = res();
  await routes.get("POST /api/admin/orders/:id/notify")({ params: { id: "3" }, body: {} }, off);
  assert.equal(off.statusCode, 503);

  let sent;
  const { routes: r2 } = harness(async () => ({ rows: [{ id: 3, name: "Ali", email: "a@b.nl", service_name: "iPhone", status: "Voltooid" }] }), {
    getEnv: () => ({ RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "f@x.nl" }),
    fetchImpl: async (_u, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200 }; },
  });
  const on = res();
  await r2.get("POST /api/admin/orders/:id/notify")({ params: { id: "3" }, body: {} }, on);
  assert.equal(on.statusCode, 200);
  assert.deepEqual(sent.to, ["a@b.nl"]);
  assert.match(sent.subject, /Voltooid/);
});

test("schema creation survives a trigger failure", async () => {
  const seen = [];
  const pool = {
    query: async (sql) => {
      seen.push(sql);
      if (sql.includes("CREATE OR REPLACE FUNCTION")) throw new Error("no plpgsql");
      return { rows: [] };
    },
  };
  const origError = console.error;
  console.error = () => {};
  try {
    await ensureRepairTrackingSchema(pool);
  } finally {
    console.error = origError;
  }
  assert.ok(seen.some((s) => s.includes("CREATE TABLE IF NOT EXISTS repair_order_events")));
});
