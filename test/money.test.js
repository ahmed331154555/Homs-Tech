"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { moneyNumber } = require("../utils/money");

test("moneyNumber parses Dutch and international decimal formats", () => {
  assert.equal(moneyNumber("€ 1.234,56"), 1234.56);
  assert.equal(moneyNumber("1,234.56"), 1234.56);
  assert.equal(moneyNumber("12,50"), 12.5);
  assert.equal(moneyNumber("12.50"), 12.5);
});

test("moneyNumber recognizes thousands separators", () => {
  assert.equal(moneyNumber("1.234"), 1234);
  assert.equal(moneyNumber("1,234"), 1234);
  assert.equal(moneyNumber("1.234.567"), 1234567);
});

test("moneyNumber accepts plain, zero and negative amounts", () => {
  assert.equal(moneyNumber("99"), 99);
  assert.equal(moneyNumber(0), 0);
  assert.equal(moneyNumber("-12,75"), -12.75);
});

test("moneyNumber returns NaN for empty or invalid values", () => {
  assert.equal(Number.isNaN(moneyNumber("")), true);
  assert.equal(Number.isNaN(moneyNumber(null)), true);
  assert.equal(Number.isNaN(moneyNumber("not a price")), true);
});
