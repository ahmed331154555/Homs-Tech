"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(
  path.join(__dirname, "..", "checkout.html"),
  "utf8",
);

test("checkout inline scripts have valid JavaScript syntax", () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, "Checkout page must contain its checkout script");

  for (const [, source] of scripts) {
    if (source.trim()) new vm.Script(source);
  }
});

test("confirmed checkout clears stale payment session data", () => {
  const codStart = html.indexOf('if(selectedMethod === "CashOnDelivery"){');
  const verifyStart = html.indexOf("async function verifyMollieReturn");
  const mollieStart = html.indexOf("if(result.paid){", verifyStart);

  assert.notEqual(codStart, -1, "Cash on delivery success branch must exist");
  assert.notEqual(verifyStart, -1, "Mollie return verification must exist");
  assert.notEqual(mollieStart, -1, "Mollie paid branch must exist");

  const codSuccess = html.slice(codStart, codStart + 1800);
  const mollieSuccess = html.slice(mollieStart, mollieStart + 1800);

  for (const key of [
    "homsTechMollieOrderId",
    "homsTechMollieCheckoutToken",
    "homsTechPaymentMethod",
  ]) {
    assert.ok(
      codSuccess.includes('sessionStorage.removeItem("' + key + '")'),
      "Cash on delivery must clear " + key,
    );
    assert.ok(
      mollieSuccess.includes('sessionStorage.removeItem("' + key + '")'),
      "Confirmed Mollie payment must clear " + key,
    );
  }
});
