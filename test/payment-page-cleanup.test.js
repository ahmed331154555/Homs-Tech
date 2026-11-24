"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(
  path.join(__dirname, "..", "payment.html"),
  "utf8",
);

test("payment page inline scripts have valid JavaScript syntax", () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, "Payment page must contain its payment script");

  for (const [, source] of scripts) {
    if (source.trim()) new vm.Script(source);
  }
});

test(
  "successful PayPal payment clears cart, trade-in and checkout session data",
  () => {
    const requiredCleanup = [
      "homsTechCart",
      "homsTechPendingWebshopOrderId",
      "homsTechTradeInToken",
      "homsTechTradeInCredit",
      "homsTechTradeInDevice",
      "homsTechTradeInEmail",
      "homsTechTradeInDetails",
      "homsTechMollieOrderId",
      "homsTechMollieCheckoutToken",
      "homsTechPaymentMethod",
    ];

    for (const key of requiredCleanup) {
      assert.ok(
        html.includes('"' + key + '"'),
        "Payment success cleanup must include " + key,
      );
    }

    assert.match(
      html,
      /Bestelling #"\+orderId/,
      "The customer should see the confirmed order number",
    );
  },
);
