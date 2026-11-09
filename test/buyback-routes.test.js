"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerBuybackRoutes } = require("../routes/buyback");

function createApp() {
  const routes = new Map();
  return {
    routes,
    post(path, ...handlers) { routes.set(path, handlers.at(-1)); }
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("buyback calculator applies protocol 2 function and battery discounts", async () => {
  const app = createApp();
  registerBuybackRoutes(app, {});
  const res = response();
  await app.routes.get("/api/buyback/calculate")({
    body: {
      conditionBasePrice: 300,
      storageDelta: 20,
      condition: "Goed",
      functions: "Nee",
      functionsNoLabel: "Nee",
      battery: "Nee",
      batteryNoLabel: "Nee"
    }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.price, 192);
  assert.equal(res.body.adjustments.length, 2);
});

test("buyback calculator treats broken devices as direct-price offers", async () => {
  const app = createApp();
  registerBuybackRoutes(app, {});
  const res = response();
  await app.routes.get("/api/buyback/calculate")({
    body: { conditionBasePrice: 125, storageDelta: -10, condition: "Kapot" }
  }, res);
  assert.equal(res.body.price, 115);
  assert.equal(res.body.broken, true);
  assert.deepEqual(res.body.adjustments, []);
});

test("buyback calculator rejects invalid base prices before calculating", async () => {
  const app = createApp();
  registerBuybackRoutes(app, {});
  const res = response();
  await app.routes.get("/api/buyback/calculate")({
    body: { conditionBasePrice: -1 }
  }, res);
  assert.equal(res.statusCode, 400);
});

function registerOrderRoute(pool) {
  const app = createApp();
  const { validateBuybackOfferedPrice } = require("../utils/buyback-order");
  registerBuybackRoutes(app, {
    pool,
    crypto: require("node:crypto"),
    ensureBuybackOrdersTable: async () => {},
    validateBuybackOfferedPrice,
    escapeHtml: value => String(value ?? "")
  });
  return app.routes.get("/api/buyback/orders");
}

function validBuybackPayload(overrides = {}) {
  return {
    name: "Test Klant",
    email: "test@example.com",
    device: "iPhone 13",
    offeredPrice: 125,
    paymentMethod: "Bankoverschrijving",
    accountHolderName: "Test Klant",
    iban: "NL91ABNA0417164300",
    ...overrides
  };
}

test("standalone phone sale is stored as a normal buyback, without trade-in token", async () => {
  let insertParams;
  const handler = registerOrderRoute({
    async query(_sql, params) {
      insertParams = params;
      return { rows: [{ id: 41, order_no: "BT-41", status: "Nieuw" }] };
    }
  });
  const res = response();

  await handler({ body: validBuybackPayload({ tradeIn: false }) }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(insertParams[18], false);
  assert.equal(insertParams[19], "");
  assert.equal(res.body.success, true);
  assert.equal(Object.hasOwn(res.body, "tradeInToken"), false);
  assert.equal(Object.hasOwn(res.body, "tradeInCredit"), false);
});

test("trade-in quote is stored separately and returns a one-time linking token", async () => {
  let insertParams;
  const handler = registerOrderRoute({
    async query(_sql, params) {
      insertParams = params;
      return { rows: [{ id: 42, order_no: "BT-42", status: "Wacht op aankoop" }] };
    }
  });
  const res = response();

  await handler({ body: validBuybackPayload({ tradeIn: true }) }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(insertParams[18], true);
  assert.match(insertParams[19], /^[a-f0-9]{64}$/);
  assert.equal(res.body.success, true);
  assert.match(res.body.tradeInToken, /^[a-f0-9]{64}$/);
  assert.equal(res.body.tradeInCredit, 125);
  assert.notEqual(insertParams[19], res.body.tradeInToken);
});

test("standalone sale still requires valid payout details", async () => {
  let queryCalled = false;
  const handler = registerOrderRoute({
    async query() { queryCalled = true; return { rows: [] }; }
  });
  const res = response();

  await handler({
    body: validBuybackPayload({ tradeIn: false, iban: "invalid" })
  }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(queryCalled, false);
});

