"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { registerResendInboundWebhook } = require("../routes/resend-inbound");

const NOW = 1_800_000_000;
const secretBytes = crypto.randomBytes(32);
const webhookSecret = "whsec_" + secretBytes.toString("base64");

function makeRequest(body, { valid = true, timestamp = String(NOW) } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const id = "msg_test_123";
  const digest = crypto.createHmac("sha256", secretBytes)
    .update(Buffer.concat([Buffer.from(id + "." + timestamp + "."), raw]))
    .digest("base64");
  return {
    body: raw,
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": "v1," + (valid ? digest : "invalid")
    }
  };
}

function makeHarness({ env = {}, rowCount = 1, apiResponse, now = NOW } = {}) {
  const routes = new Map();
  const queries = [];
  const fetchCalls = [];
  const app = {
    post(path, ...handlers) { routes.set(path, handlers); }
  };
  const express = { raw(options) { return { rawOptions: options }; } };
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount, rows: [] };
    }
  };
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url, options });
    if (url.includes("/emails/receiving/")) {
      return {
        ok: true,
        async json() {
          return apiResponse || {
            id: "email_received_1",
            from: "customer@example.com",
            to: ["support@homs-tech.nl"],
            subject: "Repair question",
            text: "Hello HOMS TECH",
            html: "<p>Hello HOMS TECH</p>",
            attachments: [],
            message_id: "<message@example.com>",
            references: "<previous@example.com>"
          };
        }
      };
    }
    return { ok: true, async text() { return ""; } };
  };
  registerResendInboundWebhook(app, {
    express,
    pool,
    cryptoImpl: crypto,
    getEnv: () => ({ RESEND_WEBHOOK_SECRET: webhookSecret, RESEND_API_KEY: "test-api-key", RESEND_FROM_EMAIL: "site@homs-tech.nl", RESEND_INBOUND_NOTIFY_EMAIL: "owner@homs-tech.nl", ...env }),
    fetchImpl,
    getNow: () => now * 1000
  });
  const handlers = routes.get("/api/webhooks/resend/inbound");
  return { handlers, queries, fetchCalls };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; }
  };
}

test("registers the inbound webhook with raw JSON body parsing", () => {
  const { handlers } = makeHarness();
  assert.equal(handlers.length, 2);
  assert.deepEqual(handlers[0].rawOptions, { type: "application/json", limit: "2mb" });
});

test("rejects invalid Svix signatures without calling Resend or the database", async () => {
  const { handlers, queries, fetchCalls } = makeHarness();
  const req = makeRequest({ type: "email.received", data: { email_id: "email_1" } }, { valid: false });
  const res = response();
  await handlers[1](req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body, "Invalid signature");
  assert.equal(queries.length, 0);
  assert.equal(fetchCalls.length, 0);
});

test("rejects stale webhook timestamps", async () => {
  const { handlers, queries } = makeHarness();
  const req = makeRequest({ type: "email.received", data: { email_id: "email_1" } }, { timestamp: String(NOW - 301) });
  const res = response();
  await handlers[1](req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body, "Invalid webhook headers");
  assert.equal(queries.length, 0);
});

test("stores a verified inbound email and sends a configurable owner notification", async () => {
  const { handlers, queries, fetchCalls } = makeHarness();
  const req = makeRequest({ type: "email.received", data: { email_id: "resend_event_email_1" } });
  const res = response();
  await handlers[1](req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "OK");
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /ON CONFLICT\(resend_email_id\) DO NOTHING/);
  assert.equal(queries[0].params[0], "email_received_1");
  assert.equal(queries[0].params[1], "<message@example.com>");
  assert.equal(fetchCalls.length, 2);
  const notification = JSON.parse(fetchCalls[1].options.body);
  assert.deepEqual(notification.to, ["owner@homs-tech.nl"]);
});

test("does not send duplicate notifications when the email already exists", async () => {
  const { handlers, fetchCalls } = makeHarness({ rowCount: 0 });
  const req = makeRequest({ type: "email.received", data: { email_id: "resend_event_email_1" } });
  const res = response();
  await handlers[1](req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(fetchCalls.length, 1);
});

test("ignores unrelated webhook event types", async () => {
  const { handlers, queries, fetchCalls } = makeHarness();
  const req = makeRequest({ type: "email.sent", data: { email_id: "email_1" } });
  const res = response();
  await handlers[1](req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, "Ignored");
  assert.equal(queries.length, 0);
  assert.equal(fetchCalls.length, 0);
});
