"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminOrderRoutes } = require("../routes/admin-orders");

function createRouteHarness(pool) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) {
      routes.set(`GET ${path}`, handlers.at(-1));
    },
    post(path, ...handlers) {
      routes.set(`POST ${path}`, handlers.at(-1));
    },
    put(path, ...handlers) {
      routes.set(`PUT ${path}`, handlers.at(-1));
    },
    delete(path, ...handlers) {
      routes.set(`DELETE ${path}`, handlers.at(-1));
    },
  };
  const requirePermission = (permission) => {
    assert.ok(permission.startsWith("orders."));
    return (_req, _res, next) => next();
  };

  registerAdminOrderRoutes(app, { pool, requirePermission });
  return routes;
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

test("admin order list strips stored photo payloads in SQL and returns on-demand URLs", async () => {
  let querySql = "";
  const pool = {
    async query(sql) {
      querySql = sql;
      return {
        rows: [
          {
            id: 42,
            service_category: "reparatie",
            extra_fields: JSON.stringify({
              repairQuote: true,
              photos: [
                {
                  name: "front.jpg",
                  type: "image/jpeg",
                  dataUrl: "data:image/jpeg;base64,SECRET",
                },
                { dataUrl: "data:image/png;base64,SECRET2" },
              ],
              note: "not needed in the repair queue",
              offer: {
                price: "85,00",
                rawPrice: "85.00",
                message: "We can repair this.",
                validity: "14 dagen",
                duration: "1 uur",
                updatedAt: "2026-11-15T10:00:00.000Z",
                emailSent: false,
                sentAt: null,
                responseTokenHash: "must-not-be-returned",
              },
            }),
          },
        ],
      };
    },
  };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("GET /api/admin/orders")({}, response);

  assert.equal(response.statusCode, 200);
  assert.match(querySql, /regexp_replace\(/);
  assert.match(querySql, /"dataUrl"/);
  assert.match(querySql, /chr\(92\)/);
  assert.match(querySql, /CASE[\s\S]*END AS extra_fields/);
  assert.match(
    querySql,
    /SELECT id, service_category, service_name, service_group, price/,
  );
  for (const unusedColumn of [
    "customer_id",
    "source_price",
    "service_instructions",
    "required_fields",
    "provider_reference",
    "execution_note",
    "result_data",
    "execution_updated_at",
  ]) {
    assert.equal(
      new RegExp("\\b" + unusedColumn + "\\b").test(querySql),
      false,
      unusedColumn + " should not be loaded by the repair-order list",
    );
  }
  const metadata = JSON.parse(response.body.orders[0].extra_fields);
  assert.deepEqual(metadata.photos, [
    {
      name: "front.jpg",
      type: "image/jpeg",
      url: "/api/admin/repair-requests/42/photos/0",
    },
    {
      name: "foto-2",
      type: "image/jpeg",
      url: "/api/admin/repair-requests/42/photos/1",
    },
  ]);
  assert.equal(metadata.note, undefined);
  assert.deepEqual(metadata.offer, {
    price: "85,00",
    rawPrice: "85.00",
    message: "We can repair this.",
    validity: "14 dagen",
    duration: "1 uur",
    updatedAt: "2026-11-15T10:00:00.000Z",
    emailSent: false,
    sentAt: null,
  });
  assert.equal(JSON.stringify(response.body).includes("SECRET"), false);
  assert.equal(
    JSON.stringify(response.body).includes("must-not-be-returned"),
    false,
  );
});

test("admin order status rejects unsupported values without querying the database", async () => {
  let queryCalled = false;
  const pool = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("PUT /api/admin/orders/:id/status")(
    { body: { status: "paid" }, params: { id: "5" } },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Ongeldige status." });
  assert.equal(queryCalled, false);
});

test("admin order deletion validates the ID before issuing a query", async () => {
  let queryCalled = false;
  const pool = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("DELETE /api/admin/orders/:id")(
    { params: { id: "0" } },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "Ongeldig order-ID." });
  assert.equal(queryCalled, false);
});

test("repair photo endpoint caps stored record transfer before parsing", async () => {
  let querySql = "";
  let queryParams = [];
  const pool = {
    async query(sql, params) {
      querySql = sql;
      queryParams = params;
      return {
        rows: [{ extra_fields: null, extra_fields_bytes: 10 * 1024 * 1024 }],
      };
    },
  };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("GET /api/admin/repair-requests/:id/photos/:index")(
    { params: { id: "42", index: "0" } },
    response,
  );

  assert.equal(response.statusCode, 413);
  assert.match(
    querySql,
    /CASE WHEN octet_length\(extra_fields\) <= \$2 THEN extra_fields ELSE NULL END/,
  );
  assert.match(querySql, /octet_length\(extra_fields\) AS extra_fields_bytes/);
  assert.deepEqual(queryParams, [42, 9 * 1024 * 1024]);
});

test("repair photo endpoint serves only bounded supported image data", async () => {
  const payload = Buffer.from("small-image-payload");
  let querySql = "";
  const pool = {
    async query(sql, params) {
      querySql = sql;
      assert.deepEqual(params, [42, 9 * 1024 * 1024]);
      return {
        rows: [
          {
            extra_fields: JSON.stringify({
              photos: [
                {
                  type: "image/png",
                  dataUrl:
                    "data:image/png;base64," + payload.toString("base64"),
                },
              ],
            }),
            extra_fields_bytes: 180,
          },
        ],
      };
    },
  };
  const routes = createRouteHarness(pool);
  const response = createResponse();

  await routes.get("GET /api/admin/repair-requests/:id/photos/:index")(
    { params: { id: "42", index: "0" } },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "image/png");
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.deepEqual(response.body, payload);
  assert.match(querySql, /octet_length\(extra_fields\)/);
});

test("repair photo endpoint rejects unsupported MIME types and oversized payloads", async () => {
  const makePool = (dataUrl) => ({
    async query() {
      return {
        rows: [
          {
            extra_fields: JSON.stringify({ photos: [{ dataUrl }] }),
            extra_fields_bytes: 100,
          },
        ],
      };
    },
  });
  const routes = createRouteHarness(makePool("data:text/html;base64,SGVsbG8="));
  const invalidType = createResponse();
  await routes.get("GET /api/admin/repair-requests/:id/photos/:index")(
    { params: { id: "42", index: "0" } },
    invalidType,
  );
  assert.equal(invalidType.statusCode, 400);

  const hugeBase64 = "A".repeat(Math.ceil((2 * 1024 * 1024) / 3) * 4 + 4);
  const hugeRoutes = createRouteHarness(
    makePool("data:image/jpeg;base64," + hugeBase64),
  );
  const oversized = createResponse();
  await hugeRoutes.get("GET /api/admin/repair-requests/:id/photos/:index")(
    { params: { id: "42", index: "0" } },
    oversized,
  );
  assert.equal(oversized.statusCode, 413);
});
