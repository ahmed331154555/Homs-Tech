"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { registerAdminBuybackOrderRoutes } = require("../routes/admin-buyback-orders");

function createHarness({ pool, env = {}, fetchImpl = async () => ({ ok: true, status: 200, async json() { return { id: "mail_1" }; } }), ensureBuybackOrdersTable = async () => {} }) {
  const routes = new Map();
  const permissions = [];
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    put(path, ...handlers) { routes.set("PUT " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers.at(-1)); }
  };
  const requirePermission = permission => {
    permissions.push(permission);
    return (_req, _res, next) => next();
  };
  registerAdminBuybackOrderRoutes(app, {
    pool,
    requirePermission,
    ensureBuybackOrdersTable,
    crypto,
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
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    send(value) { this.sent = value; return this; }
  };
}

test("admin buyback routes register the standalone-sale workflow with permissions", () => {
  const { routes, permissions } = createHarness({ pool: { async query() { return { rows: [] }; }, async connect() { throw new Error("unused"); } } });
  assert.deepEqual([...routes.keys()], [
    "GET /api/admin/buyback-orders",
    "PUT /api/admin/buyback-orders/:id/inspection",
    "PUT /api/admin/buyback-orders/:id/offer",
    "POST /api/buyback/decision",
    "PUT /api/admin/buyback-orders/:id/settlement",
    "POST /api/admin/buyback-orders/:id/settlement-email",
    "PUT /api/admin/buyback-orders/:id/shipping-label",
    "GET /api/admin/buyback-orders/:id/shipping-label",
    "POST /api/admin/buyback-orders/:id/shipping-label-email",
    "PUT /api/admin/buyback-orders/:id/status",
    "DELETE /api/admin/buyback-orders/:id"
  ]);
  assert.deepEqual(permissions, [
    "buyback_orders.view",
    "buyback_orders.update",
    "buyback_orders.update",
    "buyback_orders.update",
    "buyback_orders.update",
    "buyback_orders.update",
    "buyback_orders.view",
    "buyback_orders.update",
    "buyback_orders.update",
    "buyback_orders.delete"
  ]);
});

test("admin buyback list returns standalone sales and linked trade-ins", async () => {
  let ensured = false;
  const pool = { async query(sql) {
    assert.match(sql, /LEFT JOIN webshop_orders/);
    assert.match(sql, /trade_in=TRUE AND w\.id IS NOT NULL/);
    return { rows: [{ id: 7, status: "Nieuw", trade_in: false }] };
  } };
  const { routes } = createHarness({ pool, ensureBuybackOrdersTable: async () => { ensured = true; } });
  const response = createResponse();
  await routes.get("GET /api/admin/buyback-orders")({}, response);
  assert.equal(ensured, true);
  assert.deepEqual(response.body.orders, [{ id: 7, status: "Nieuw", trade_in: false }]);
  assert.equal(response.statusCode, 200);
});

test("final buyback offer sends a secure approval link and updates status", async () => {
  const queries = [];
  let sentMail;
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT")) return { rows: [{ id: 9, order_no: "BT-9", name: "<Sam>", email: "sam@example.com", device: "iPhone <16>", sale_inspected_value: "250.00", status: "Aanbod klaar" }] };
      return { rows: [{ id: 9, status: "Aanbod verzonden" }] };
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
  await routes.get("PUT /api/admin/buyback-orders/:id/offer")({ params: { id: "9" }, body: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.customerOffer.sent, true);
  assert.equal(response.body.customerOffer.email, "sam@example.com");
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /sale_approval_token_hash/);
  assert.equal(sentMail.to[0], "sam@example.com");
  assert.match(sentMail.html, /&lt;Sam&gt;/);
  assert.match(sentMail.html, /iPhone &lt;16&gt;/);
  assert.match(sentMail.html, /buyback-response\.html\?token=[a-f0-9]{64}/);
  assert.match(sentMail.html, /€ 250,00/);
});

test("buyback offer is not marked as sent when email provider fails", async () => {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith("SELECT")) return { rows: [{ id: 2, order_no: "BT-2", name: "Sam", email: "sam@example.com", device: "iPhone", sale_inspected_value: 100, status: "Aanbod klaar" }] };
      return { rows: [{ id: 2, status: "Aanbod verzonden" }] };
    }
  };
  const { routes } = createHarness({
    pool,
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "shop@example.com" },
    fetchImpl: async () => ({ ok: false, status: 503, async json() { return { message: "unavailable" }; } })
  });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/offer")({ params: { id: "2" }, body: {} }, response);
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /E-mail kon niet worden verzonden/i);
  assert.equal(queries.length, 3);
  assert.match(queries[2].sql, /status='Aanbod klaar'/);
});

test("inspection validates the final value and requires an explanation", async () => {
  let queryCount = 0;
  const pool = { async query() { queryCount++; return { rows: [] }; } };
  const { routes } = createHarness({ pool });
  const invalidValue = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/inspection")(
    { params: { id: "4" }, body: { inspectedValue: -1, reason: "Test reden" } },
    invalidValue
  );
  assert.equal(invalidValue.statusCode, 400);
  const missingReason = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/inspection")(
    { params: { id: "4" }, body: { inspectedValue: 60, reason: "nee" } },
    missingReason
  );
  assert.equal(missingReason.statusCode, 400);
  assert.equal(queryCount, 0);
});

test("buyback status only allows non-terminal internal statuses", async () => {
  const queries = [];
  const pool = { async query(sql, params) { queries.push({ sql, params }); return { rows: [{ id: 3, status: params[0] }] }; } };
  const { routes } = createHarness({ pool });
  const invalid = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/status")({ params: { id: "3" }, body: { status: "Voltooid" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  const valid = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/status")({ params: { id: "3" }, body: { status: "In behandeling" } }, valid);
  assert.equal(valid.statusCode, 200);
  assert.deepEqual(queries[0].params, ["In behandeling", "3"]);
});

test("buyback delete returns success only when a standalone sale request was deleted", async () => {
  let sqlSeen = "";
  const pool = { async query(sql) { sqlSeen = sql; return { rows: [{ id: 4 }] }; } };
  const { routes } = createHarness({ pool });
  const response = createResponse();
  await routes.get("DELETE /api/admin/buyback-orders/:id")({ params: { id: "4" } }, response);
  assert.deepEqual(response.body, { success: true });
  assert.match(sqlSeen, /trade_in=FALSE/);
  assert.equal(response.statusCode, 200);
});

test("PostNL upload rejects non-PDF content before writing to the database", async () => {
  let queryCount = 0;
  const { routes } = createHarness({ pool: { async query() { queryCount++; return { rows: [] }; } } });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/shipping-label")(
    { params: { id: "12" }, body: { fileName: "label.pdf", fileData: Buffer.from("not a PDF").toString("base64") } },
    response
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /geen geldig PDF/i);
  assert.equal(queryCount, 0);
});

test("PostNL upload stores a validated PDF and tracking number", async () => {
  const pdf = Buffer.from("%PDF-1.4\\nlabel");
  let saved;
  const { routes } = createHarness({
    pool: { async query(sql, params) {
      saved = { sql, params };
      return { rows: [{ id: 12, shipping_label_filename: "postnl.pdf", postnl_tracking_number: "3S123" }] };
    } }
  });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/shipping-label")(
    { params: { id: "12" }, body: { fileName: "postnl.pdf", fileData: pdf.toString("base64"), trackingNumber: "3S123" } },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.match(saved.sql, /shipping_label_pdf=\$1/);
  assert.deepEqual(saved.params[0], pdf);
  assert.equal(saved.params[2], "3S123");
});

test("PostNL label download returns the stored PDF with a safe content type", async () => {
  const pdf = Buffer.from("%PDF-1.4\\nlabel");
  const { routes } = createHarness({
    pool: { async query() { return { rows: [{ shipping_label_pdf: pdf, shipping_label_filename: "postnl label.pdf" }] }; } }
  });
  const response = createResponse();
  await routes.get("GET /api/admin/buyback-orders/:id/shipping-label")({ params: { id: "12" } }, response);
  assert.equal(response.headers["Content-Type"], "application/pdf");
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(response.sent, pdf);
});

test("PostNL label email includes the PDF attachment and tracking details", async () => {
  const pdf = Buffer.from("%PDF-1.4\\nlabel");
  let email;
  const queries = [];
  const { routes } = createHarness({
    pool: { async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT")) return { rows: [{
        id: 12, order_no: "BT-12", name: "Sam", email: "sam@example.com", device: "iPhone 12",
        postnl_tracking_number: "3S123", shipping_label_pdf: pdf, shipping_label_filename: "postnl.pdf"
      }] };
      return { rows: [] };
    } },
    env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "shop@example.com" },
    fetchImpl: async (_url, options) => {
      email = JSON.parse(options.body);
      return { ok: true, status: 200, async json() { return { id: "mail_postnl" }; } };
    }
  });
  const response = createResponse();
  await routes.get("POST /api/admin/buyback-orders/:id/shipping-label-email")({ params: { id: "12" }, body: {} }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.sent, true);
  assert.equal(email.to[0], "sam@example.com");
  assert.equal(email.attachments[0].filename, "postnl.pdf");
  assert.equal(Buffer.from(email.attachments[0].content, "base64").toString(), pdf.toString());
  assert.match(email.html, /3S123/);
  assert.equal(queries.length, 2);
});


test("settlement atomically registers the accepted device once with an internal HT barcode", async () => {
  const transactionQueries = [];
  let registeredDevice;
  let released = false;
  const client = {
    async query(sql, params = []) {
      transactionQueries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.startsWith("SELECT id,order_no,device,brand,model,storage,condition")) {
        return { rows: [{
          id: 42, order_no: "BT-42", device: "iPhone 14 Pro", brand: "Apple",
          model: "iPhone 14 Pro", storage: "256GB", condition: "Goed",
          sale_inspected_value: "310.00", status: "Klant akkoord", trade_in: false
        }] };
      }
      if (sql.startsWith("INSERT INTO device_register (")) {
        registeredDevice = {
          id: 901, identifier_value: params[0], model: params[1], brand: params[2],
          status: "تم الشراء", purchase_cost: params[3]
        };
        return { rows: [registeredDevice] };
      }
      if (sql.startsWith("UPDATE buyback_orders SET status='Voltooid'")) return { rows: [{ id: 42 }] };
      return { rows: [] };
    },
    release() { released = true; }
  };
  const pool = {
    async connect() { return client; },
    async query(sql) {
      if (sql.startsWith("SELECT id,order_no,name,email,device,sale_inspected_value")) {
        return { rows: [{ id: 42, order_no: "BT-42", name: "Sam", email: "sam@example.com", device: "iPhone 14 Pro", sale_inspected_value: "310.00", status: "Voltooid" }] };
      }
      return { rows: [] };
    }
  };
  const { routes } = createHarness({ pool });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/settlement")(
    { params: { id: "42" }, body: { settlementNote: "Overgemaakt via bank op 10 november" } },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.inventoryDevice.identifier_value, "HT-BUYBACK-42");
  assert.equal(registeredDevice.purchase_cost, "310.00");
  assert.ok(transactionQueries.some(item => item.sql === "BEGIN"));
  assert.ok(transactionQueries.some(item => item.sql === "COMMIT"));
  assert.ok(transactionQueries.some(item => item.sql.includes("INSERT INTO device_register_operations")));
  assert.equal(released, true);
});

test("settlement refuses to register a device before customer approval", async () => {
  let insertAttempted = false;
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.startsWith("SELECT id,order_no,device,brand,model,storage,condition")) {
        return { rows: [{ id: 7, status: "Aanbod verzonden", trade_in: false }] };
      }
      if (sql.startsWith("INSERT INTO device_register")) insertAttempted = true;
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const { routes } = createHarness({ pool });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/settlement")(
    { params: { id: "7" }, body: { settlementNote: "Payment done manually" } },
    response
  );
  assert.equal(response.statusCode, 409);
  assert.equal(insertAttempted, false);
});

test("completed buyback settlement cannot register or pay for the same device twice", async () => {
  let registerInsertAttempted = false;
  let operationInsertAttempted = false;
  let committed = false;
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql === "COMMIT") { committed = true; return { rows: [] }; }
      if (sql.startsWith("SELECT id,order_no,device,brand,model,storage,condition")) {
        return { rows: [{
          id: 42, order_no: "BT-42", device: "iPhone 14 Pro", brand: "Apple",
          model: "iPhone 14 Pro", storage: "256GB", condition: "Goed",
          sale_inspected_value: "310.00", status: "Voltooid", trade_in: false
        }] };
      }
      if (sql.startsWith("INSERT INTO device_register")) registerInsertAttempted = true;
      if (sql.startsWith("INSERT INTO device_register_operations")) operationInsertAttempted = true;
      return { rows: [] };
    },
    release() {}
  };
  const { routes } = createHarness({ pool: { async connect() { return client; } } });
  const response = createResponse();
  await routes.get("PUT /api/admin/buyback-orders/:id/settlement")(
    { params: { id: "42" }, body: { settlementNote: "Overgemaakt via bank op 10 november" } },
    response
  );
  assert.equal(response.statusCode, 409);
  assert.equal(registerInsertAttempted, false);
  assert.equal(operationInsertAttempted, false);
  assert.equal(committed, false);
});
