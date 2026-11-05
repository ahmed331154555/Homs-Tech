"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerContactRoutes } = require("../routes/contact");

function harness({ pool, env = {}, fetchImpl = async () => ({ ok: true }), now = 1000000 } = {}) {
  const routes = new Map();
  const app = { post(path, handler) { routes.set("POST " + path, handler); } };
  registerContactRoutes(app, {
    pool: pool || { async query() { return { rows: [] }; } },
    escapeHtml: value => String(value).replace(/[&<>"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
    })[char]),
    cryptoImpl: { randomUUID: () => "test-uuid" },
    getEnv: () => env,
    fetchImpl,
    getNow: () => now
  });
  return routes.get("POST /api/contact");
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

const validBody = {
  name: "Sam Customer",
  email: "SAM@EXAMPLE.COM",
  phone: "0612345678",
  topic: "Scherm reparatie",
  message: "Mijn iPhone scherm is kapot."
};

test("contact form stores a normalized inbound message and sends owner notification", async () => {
  const queries = [];
  let mailRequest;
  const handler = harness({
    pool: { async query(sql, params) { queries.push({ sql, params }); return { rows: [] }; } },
    env: {
      REPAIR_REQUEST_EMAIL: "owner@example.com",
      ORDER_NOTIFICATION_EMAIL: "fallback@example.com",
      RESEND_API_KEY: "test-key",
      RESEND_FROM_EMAIL: "site@example.com"
    },
    fetchImpl: async (url, options) => { mailRequest = { url, options }; return { ok: true }; }
  });
  const res = response();
  await handler({ ip: "192.0.2.1", headers: {}, body: validBody }, res);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].params[0], "contact-test-uuid");
  assert.equal(queries[0].params[1], "sam@example.com");
  assert.deepEqual(JSON.parse(queries[0].params[2]), ["owner@example.com"]);
  assert.match(queries[0].params[4], /Website contact: Scherm reparatie/);
  assert.match(queries[0].params[5], /Mijn iPhone scherm is kapot/);
  assert.equal(mailRequest.url, "https://api.resend.com/emails");
  assert.equal(JSON.parse(mailRequest.options.body).reply_to, "sam@example.com");
});

test("contact form honeypot silently accepts and does not store", async () => {
  let calls = 0;
  const handler = harness({ pool: { async query() { calls++; } } });
  const res = response();
  await handler({ ip: "192.0.2.2", headers: {}, body: { website: "bot" } }, res);
  assert.deepEqual(res.body, { success: true });
  assert.equal(calls, 0);
});

test("contact form rejects invalid fields without storing", async () => {
  let calls = 0;
  const handler = harness({ pool: { async query() { calls++; } } });
  const res = response();
  await handler({ ip: "192.0.2.3", headers: {}, body: { ...validBody, email: "bad" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls, 0);
});

test("contact form rate limit blocks the sixth message from one IP", async () => {
  let calls = 0;
  const handler = harness({ pool: { async query() { calls++; } } });
  for (let i = 0; i < 6; i++) {
    const res = response();
    await handler({ ip: "192.0.2.4", headers: {}, body: validBody }, res);
    if (i === 5) {
      assert.equal(res.statusCode, 429);
      assert.match(res.body.error, /te veel berichten/);
    }
  }
  assert.equal(calls, 5);
});

test("contact form returns a safe error when inbox storage fails", async () => {
  const handler = harness({ pool: { async query() { throw new Error("database unavailable"); } } });
  const res = response();
  await handler({ ip: "192.0.2.5", headers: {}, body: validBody }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "Uw bericht kon niet worden verstuurd. Probeer het later opnieuw.");
});
