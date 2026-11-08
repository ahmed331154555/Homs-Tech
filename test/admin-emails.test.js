"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminEmailRoutes } = require("../routes/admin-emails");

function harness({ pool, env = {}, fetchImpl = async () => ({ ok: true, status: 200, async json() { return { id: "resend_1" }; } }) }) {
  const routes = new Map();
  const permissions = [];
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); }
  };
  const requirePermission = permission => {
    permissions.push(permission);
    return (_req, _res, next) => next();
  };
  registerAdminEmailRoutes(app, {
    pool,
    requirePermission,
    escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]),
    crypto: require("node:crypto"),
    getEnv: () => env,
    fetchImpl
  });
  return { routes, permissions };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("admin email routes register with site.save permission", () => {
  const { routes, permissions } = harness({ pool: { async query() { return { rows: [], rowCount: 0 }; } } });
  assert.deepEqual([...routes.keys()], [
    "GET /api/admin/emails",
    "GET /api/admin/emails/:id",
    "DELETE /api/admin/emails/:id",
    "POST /api/admin/emails/send"
  ]);
  assert.deepEqual(permissions, ["site.save", "site.save", "site.save", "site.save"]);
});

test("email inbox list returns stored messages", async () => {
  const emails = [{ id: 1, subject: "Question" }];
  const { routes } = harness({ pool: { async query(sql) {
    assert.match(sql, /ORDER BY created_at DESC, id DESC/);
    return { rows: emails };
  } } });
  const res = response();
  await routes.get("GET /api/admin/emails")({}, res);
  assert.deepEqual(res.body, { emails });
});

test("email detail marks inbound message read and returns it", async () => {
  const calls = [];
  const email = { id: 2, direction: "inbound", is_read: true };
  const { routes } = harness({ pool: { async query(sql, params) {
    calls.push(sql);
    assert.deepEqual(params, [2]);
    return { rows: [email] };
  } } });
  const res = response();
  await routes.get("GET /api/admin/emails/:id")({ params: { id: "2" } }, res);
  assert.deepEqual(res.body, { email });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /UPDATE admin_emails SET is_read=TRUE/);
});

test("email detail validates IDs and returns 404 when missing", async () => {
  let calls = 0;
  const { routes } = harness({ pool: { async query() { calls++; return { rows: [] }; } } });
  const invalid = response();
  await routes.get("GET /api/admin/emails/:id")({ params: { id: "0" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls, 0);
  const missing = response();
  await routes.get("GET /api/admin/emails/:id")({ params: { id: "5" } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(calls, 2);
});

test("email delete validates and returns deleted message ID", async () => {
  const { routes } = harness({ pool: { async query(_sql, params) {
    assert.deepEqual(params, [6]);
    return { rows: [{ id: 6 }], rowCount: 1 };
  } } });
  const res = response();
  await routes.get("DELETE /api/admin/emails/:id")({ params: { id: "6" } }, res);
  assert.deepEqual(res.body, { success: true, id: 6 });
  const missingHarness = harness({ pool: { async query() { return { rows: [], rowCount: 0 }; } } });
  const missing = response();
  await missingHarness.routes.get("DELETE /api/admin/emails/:id")({ params: { id: "7" } }, missing);
  assert.equal(missing.statusCode, 404);
});

test("email send rejects missing configuration and invalid recipients", async () => {
  let fetchCount = 0;
  const { routes } = harness({
    pool: { async query() { return { rows: [] }; } },
    fetchImpl: async () => { fetchCount++; return { ok: true, async json() { return {}; } }; }
  });
  const noConfig = response();
  await routes.get("POST /api/admin/emails/send")({ body: {} }, noConfig);
  assert.equal(noConfig.statusCode, 503);
  const configured = harness({
    pool: { async query() { return { rows: [] }; } },
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "support@example.com" },
    fetchImpl: async () => { fetchCount++; return { ok: true, async json() { return {}; } }; }
  });
  const invalid = response();
  await configured.routes.get("POST /api/admin/emails/send")({
    body: { to: "bad", subject: "Hello", text: "Message" }
  }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(fetchCount, 0);
});

test("email send validates and sends attachments, stores outbound copy", async () => {
  const calls = [];
  let payload;
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  const { routes } = harness({
    pool,
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "support@example.com" },
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, status: 200, async json() { return { id: "mail_sent_1" }; } };
    }
  });
  const res = response();
  await routes.get("POST /api/admin/emails/send")({
    body: {
      to: "customer@example.com",
      cc: "copy@example.com",
      bcc: "hidden@example.com",
      subject: "Repair update",
      text: "Hello <customer>",
      attachments: [{ filename: "proof.pdf", content: Buffer.from("sample").toString("base64"), content_type: "application/pdf" }]
    }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, to: "customer@example.com", attachmentCount: 1 });
  assert.deepEqual(payload.to, ["customer@example.com"]);
  assert.deepEqual(payload.cc, ["copy@example.com"]);
  assert.deepEqual(payload.bcc, ["hidden@example.com"]);
  assert.match(payload.html, /Hello &lt;customer&gt;/);
  assert.equal(payload.attachments[0].filename, "proof.pdf");
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO admin_emails/);
  assert.deepEqual(JSON.parse(calls[0].params[2]), ["customer@example.com", "copy@example.com", "hidden@example.com"]);
});

test("email reply requires an inbound original and adds threading headers", async () => {
  let sentPayload;
  const pool = { async query(sql) {
    if (sql.startsWith("SELECT direction")) return { rows: [{ direction: "inbound", message_id: "<original@example.com>", references_header: "<root@example.com>" }] };
    return { rows: [] };
  } };
  const { routes } = harness({
    pool,
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "support@example.com" },
    fetchImpl: async (_url, options) => {
      sentPayload = JSON.parse(options.body);
      return { ok: true, async json() { return { id: "reply_1" }; } };
    }
  });
  const res = response();
  await routes.get("POST /api/admin/emails/send")({
    body: { to: "customer@example.com", subject: "Re: Question", text: "Reply", replyToId: 9 }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sentPayload.headers["In-Reply-To"], "<original@example.com>");
  assert.equal(sentPayload.headers.References, "<root@example.com> <original@example.com>");
});

test("email reply strips injected header lines from inbound message IDs", async () => {
  let sentPayload;
  const pool = { async query(sql) {
    if (sql.startsWith("SELECT direction")) {
      return { rows: [{
        direction: "inbound",
        message_id: "<original@example.com>\r\nBcc: attacker@example.com",
        references_header: "<root@example.com>\r\nCc: attacker@example.com"
      }] };
    }
    return { rows: [] };
  } };
  const { routes } = harness({
    pool,
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "support@example.com" },
    fetchImpl: async (_url, options) => {
      sentPayload = JSON.parse(options.body);
      return { ok: true, async json() { return { id: "reply_safe_1" }; } };
    }
  });
  const res = response();
  await routes.get("POST /api/admin/emails/send")({
    body: { to: "customer@example.com", subject: "Re: Question", text: "Reply", replyToId: 10 }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sentPayload.headers["In-Reply-To"], "<original@example.com>");
  assert.equal(sentPayload.headers.References, "<root@example.com> <original@example.com>");
  assert.equal(JSON.stringify(sentPayload.headers).includes("attacker@example.com"), false);
});

test("email send rejects unsafe attachments and provider failures", async () => {
  const base = { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "support@example.com" };
  const { routes } = harness({
    pool: { async query() { return { rows: [] }; } },
    env: base,
    fetchImpl: async () => ({ ok: false, status: 502, async json() { return { message: "down" }; } })
  });
  const invalidAttachment = response();
  await routes.get("POST /api/admin/emails/send")({
    body: { to: "customer@example.com", subject: "Hi", text: "Hello", attachments: [{ filename: "bad.exe", content: "YWJj" }] }
  }, invalidAttachment);
  assert.equal(invalidAttachment.statusCode, 500);
  const providerFail = response();
  await routes.get("POST /api/admin/emails/send")({
    body: { to: "customer@example.com", subject: "Hi", text: "Hello" }
  }, providerFail);
  assert.equal(providerFail.statusCode, 502);
});
