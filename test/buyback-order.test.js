"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateBuybackOfferedPrice } = require("../utils/buyback-order");

test("buyback price validation accepts zero and valid numeric values", () => {
  assert.equal(validateBuybackOfferedPrice(0), 0);
  assert.equal(validateBuybackOfferedPrice("125.50"), 125.5);
});

test("buyback price validation rejects negative and non-finite values", () => {
  for (const value of [-1, "-0.01", "invalid", Infinity, -Infinity, NaN]) {
    assert.throws(() => validateBuybackOfferedPrice(value), /Ongeldige prijs/);
  }
});

test("buyback price validation applies an optional maximum", () => {
  assert.equal(validateBuybackOfferedPrice(1000000, { max: 1000000 }), 1000000);
  assert.throws(
    () => validateBuybackOfferedPrice(1000000.01, { max: 1000000 }),
    /Ongeldige prijs/
  );
});
