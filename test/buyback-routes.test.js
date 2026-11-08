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
