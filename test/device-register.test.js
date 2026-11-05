"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { deviceText, deviceMoney } = require("../utils/device-register");

test("deviceText trims text and applies the default and custom limits", () => {
  assert.equal(deviceText("  iPhone  "), "iPhone");
  assert.equal(deviceText("123456", 4), "1234");
  assert.equal(deviceText(null), "");
});

test("deviceText preserves the existing string conversion behavior", () => {
  assert.equal(deviceText(123), "123");
  assert.equal(deviceText(false), "false");
});

test("deviceMoney accepts non-negative finite amounts within the limit", () => {
  assert.equal(deviceMoney("125.50"), 125.5);
  assert.equal(deviceMoney(0), 0);
  assert.equal(deviceMoney(null), 0);
  assert.equal(deviceMoney(100000000), 100000000);
});

test("deviceMoney rejects negative, non-finite and excessive amounts", () => {
  assert.equal(Number.isNaN(deviceMoney(-1)), true);
  assert.equal(Number.isNaN(deviceMoney("not-a-number")), true);
  assert.equal(Number.isNaN(deviceMoney(Infinity)), true);
  assert.equal(Number.isNaN(deviceMoney(100000001)), true);
});
