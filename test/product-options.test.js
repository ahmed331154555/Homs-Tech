"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { serverOptionDelta, serverOptionDefaults } = require("../utils/product-options");

test("serverOptionDelta preserves fixed battery and VAT adjustments", () => {
  assert.equal(serverOptionDelta({ label: "Nieuw (100%)", priceDelta: 99 }, "battery"), 30);
  assert.equal(serverOptionDelta({ label: "Met BTW", priceDelta: 99 }, "vat"), 10);
  assert.equal(serverOptionDelta({ label: "Standaard" }, "battery"), 0);
});

test("serverOptionDelta reads explicit price adjustment fields", () => {
  assert.equal(serverOptionDelta({ priceDelta: "12,50" }), 12.5);
  assert.equal(serverOptionDelta({ delta: 7 }), 7);
  assert.equal(serverOptionDelta({ priceAdjustment: -3 }), -3);
});

test("serverOptionDelta falls back to a signed amount in the label or price", () => {
  assert.equal(serverOptionDelta({ label: "Extra opslag + € 25,50" }), 25.5);
  assert.equal(serverOptionDelta({ label: "Korting - 5" }), -5);
  assert.equal(serverOptionDelta({ price: "8,75" }), 8.75);
});

test("serverOptionDelta returns zero for missing or unusable values", () => {
  assert.equal(serverOptionDelta(null), 0);
  assert.equal(serverOptionDelta({ label: "Geen extra" }), 0);
  assert.equal(serverOptionDelta({ priceDelta: "ongeldig" }), 0);
});

test("serverOptionDefaults returns the existing active option shapes", () => {
  assert.deepEqual(serverOptionDefaults("battery"), [
    { label: "Standaard", active: true, enabled: true, available: true, priceDelta: 0 },
    { label: "Nieuw (100%)", active: true, enabled: true, available: true, priceDelta: 0 }
  ]);
  assert.deepEqual(serverOptionDefaults("unknown"), []);
});
