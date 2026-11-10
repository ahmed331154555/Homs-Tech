"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminInvoiceRoutes } = require("../routes/admin-invoices");

function harness({ pool, env = {}, buildInvoicePdf = () => Buffer.from("PDF"), fetchImpl = async () => ({ ok: true, status: 200, async json() { return { id: "mail_1" }; } }) }) {
  const routes = new Map();
  const permissions = [];
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); }
  };
  const requirePermission = permission => {
    permissions.push(permission);
    return (_req, _res, next) => next();
  };
  registerAdminInvoiceRoutes(app, { pool, requirePermission, buildInvoicePdf, getEnv: () => env, fetchImpl });
  return { routes, permissions };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    send(value) { this.body = value; return this; }
  };
}

test("admin invoice routes register with site.save permission", () => {
  const { routes, permissions } = harness({ pool: { async query() { return { rows: [] }; } } });
  assert.deepEqual([...routes.keys()], [
    "GET /api/admin/invoices",
    "POST /api/admin/invoices",
    "GET /api/admin/invoices/:id/pdf",
    "POST /api/admin/invoices/:id/test-send"
  ]);
  assert.deepEqual(permissions, ["site.save", "site.save", "site.save", "site.save"]);
});

test("invoice list returns latest invoices", async () => {
  const rows = [{ id: 3, invoice_number: "HT-2026-000003" }];
  const { routes } = harness({ pool: { async query(sql) {
    assert.match(sql, /ORDER BY id DESC LIMIT 200/);
    return { rows };
  } } });
  const res = response();
  await routes.get("GET /api/admin/invoices")({}, res);
  assert.deepEqual(res.body, { invoices: rows });
});

test("invoice creation validates input and calculates totals", async () => {
  const calls = [];
  const createdAt = new Date("2026-03-04T10:00:00Z");
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("INSERT INTO manual_invoices")) return { rows: [{ id: 12, invoice_number: "HT-2026-000012", created_at: createdAt, status: "open", total: "130.68" }] };
    throw new Error("Unexpected invoice query: " + sql);
  } };
  const { routes } = harness({ pool });
  const invalid = response();
  await routes.get("POST /api/admin/invoices")({ body: { customerName: "Sam", customerEmail: "bad", lines: [] } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 0);

  const res = response();
  await routes.get("POST /api/admin/invoices")({
    body: {
      customerName: "Sam",
      customerEmail: "sam@example.com",
      customerAddress: "Street 1",
      kvkNumber: "123",
      vatId: "NL123",
      lines: [
        { description: "Screen", quantity: 1, unitPrice: 100, vatRate: 21 },
        { description: "Case", quantity: 1, unitPrice: 8, vatRate: 21 }
      ]
    }
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.invoice.invoice_number, "HT-2026-000012");
  assert.equal(res.body.invoice.total, "130.68");
  assert.equal(calls.length, 1, "invoice insert and final number assignment must be atomic");
  assert.match(calls[0].sql, /WITH inserted AS[\\s\\S]*UPDATE manual_invoices/);
  assert.match(calls[0].sql, /LPAD\\(inserted\\.id::text,6,'0'\\)/);
  const lines = JSON.parse(calls[0].params[6]);
  assert.equal(lines.length, 2);
  assert.equal(calls[0].params[7], "108.00");
  assert.equal(calls[0].params[8], "22.68");
  assert.equal(calls[0].params[9], "130.68");
});

test("invoice creation rejects invalid quantities, prices and VAT rates", async () => {
  let queryCount = 0;
  const { routes } = harness({ pool: { async query() { queryCount++; return { rows: [] }; } } });
  for (const line of [
    { description: "X", quantity: 0, unitPrice: 1, vatRate: 21 },
    { description: "X", quantity: 1, unitPrice: -1, vatRate: 21 },
    { description: "X", quantity: 1, unitPrice: 1, vatRate: 6 }
  ]) {
    const res = response();
    await routes.get("POST /api/admin/invoices")({
      body: { customerName: "Sam", customerEmail: "sam@example.com", lines: [line] }
    }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(queryCount, 0);
});

test("invoice PDF validates ID, handles missing invoices and returns PDF", async () => {
  const invoice = { id: 4, invoice_number: "HT-2026-000004" };
  let pdfCalls = 0;
  const { routes } = harness({
    pool: { async query(_sql, params) { return { rows: params[0] === 4 ? [invoice] : [] }; } },
    buildInvoicePdf: value => { pdfCalls++; assert.equal(value, invoice); return Buffer.from("PDFDATA"); }
  });
  const invalid = response();
  await routes.get("GET /api/admin/invoices/:id/pdf")({ params: { id: "0" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const missing = response();
  await routes.get("GET /api/admin/invoices/:id/pdf")({ params: { id: "5" } }, missing);
  assert.equal(missing.statusCode, 404);
  const valid = response();
  await routes.get("GET /api/admin/invoices/:id/pdf")({ params: { id: "4" } }, valid);
  assert.equal(valid.body.toString(), "PDFDATA");
  assert.equal(valid.headers["Content-Type"], "application/pdf");
  assert.equal(valid.headers["Content-Disposition"], 'inline; filename="HT-2026-000004.pdf"');
  assert.equal(pdfCalls, 1);
});

test("invoice test-send validates configuration and sends the generated PDF", async () => {
  const invoice = { id: 8, invoice_number: "HT-2026-000008", customer_email: "customer@example.com" };
  let sentPayload;
  const { routes } = harness({
    pool: { async query() { return { rows: [invoice] }; } },
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "billing@example.com" },
    buildInvoicePdf: () => Buffer.from("PDFDATA"),
    fetchImpl: async (_url, options) => {
      sentPayload = JSON.parse(options.body);
      return { ok: true, status: 200, async json() { return { id: "sent_8" }; } };
    }
  });
  const res = response();
  await routes.get("POST /api/admin/invoices/:id/test-send")({ params: { id: "8" } }, res);
  assert.deepEqual(res.body, { success: true, to: "customer@example.com" });
  assert.equal(sentPayload.to[0], "customer@example.com");
  assert.equal(res.body.statusUpdated, true);
  assert.equal(sentPayload.attachments[0].filename, "HT-2026-000008.pdf");
  assert.equal(Buffer.from(sentPayload.attachments[0].content, "base64").toString(), "PDFDATA");
  assert.match(sentPayload.html, /NL96 REVO 0480 6699 45/);
});

test("invoice test-send does not call provider when configuration is missing", async () => {
  let fetchCount = 0;
  const { routes } = harness({
    pool: { async query() { return { rows: [] }; } },
    fetchImpl: async () => { fetchCount++; return { ok: true, async json() { return {}; } }; }
  });
  const res = response();
  await routes.get("POST /api/admin/invoices/:id/test-send")({ params: { id: "1" } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(fetchCount, 0);
});


test("invoice totals round each line to cents before summing", async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("INSERT INTO manual_invoices")) {
      return { rows: [{ id: 31, invoice_number: "HT-2026-000031", created_at: new Date("2026-11-10T10:00:00Z"), status: "open", total: "0.36" }] };
    }
    throw new Error("Unexpected invoice query: " + sql);
  } };
  const { routes } = harness({ pool });
  const res = response();
  await routes.get("POST /api/admin/invoices")({
    body: {
      customerName: "Rounding test",
      customerEmail: "rounding@example.com",
      lines: [{ description: "Test item", quantity: 3, unitPrice: 0.1, vatRate: 21 }]
    }
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(calls[0].params[7], "0.30");
  assert.equal(calls[0].params[8], "0.06");
  assert.equal(calls[0].params[9], "0.36");
});


test("invoice email marks the invoice as sent only after provider acceptance", async () => {
  const invoice = { id: 19, invoice_number: "HT-2026-000019", customer_email: "client@example.com" };
  const queries = [];
  const { routes } = harness({
    pool: { async query(sql) { queries.push(sql); return { rows: [invoice] }; } },
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "billing@example.com" },
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { id: "sent_19" }; } })
  });
  const res = response();
  await routes.get("POST /api/admin/invoices/:id/test-send")({ params: { id: "19" } }, res);
  assert.equal(res.body.success, true);
  assert.equal(res.body.statusUpdated, true);
  assert.match(queries[1], /UPDATE manual_invoices SET status='sent' WHERE id=\$1/);
});

test("invoice status remains unchanged when the email provider rejects delivery", async () => {
  let updateCalled = false;
  const { routes } = harness({
    pool: { async query() { return { rows: [{ id: 20, invoice_number: "HT-2026-000020", customer_email: "client@example.com" }] }; } },
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "billing@example.com" },
    fetchImpl: async () => ({ ok: false, status: 422, async json() { return { message: "rejected" }; } })
  });
  const res = response();
  await routes.get("POST /api/admin/invoices/:id/test-send")({ params: { id: "20" } }, res);
  assert.equal(res.statusCode, 502);
  assert.equal(updateCalled, false);
});
