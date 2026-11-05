"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mollieStatusToLocal,
  molliePaymentMatchesOrder
} = require("../utils/mollie-payment");

test("mollieStatusToLocal maps provider statuses to local statuses", () => {
  assert.equal(mollieStatusToLocal("paid"), "Paid");
  assert.equal(mollieStatusToLocal("CANCELED"), "Cancelled");
  assert.equal(mollieStatusToLocal("expired"), "Expired");
  assert.equal(mollieStatusToLocal("failed"), "Failed");
  assert.equal(mollieStatusToLocal("pending"), "Pending");
  assert.equal(mollieStatusToLocal("authorized"), "Pending");
  assert.equal(mollieStatusToLocal("unknown"), "Pending");
  assert.equal(mollieStatusToLocal(null), "Pending");
});

test("molliePaymentMatchesOrder accepts matching EUR payment and order", () => {
  const order = { id: 42, total: "1.234,56" };
  const payment = {
    id: "tr_123ABC",
    metadata: { orderId: "42" },
    amount: { currency: "eur", value: "1234.56" }
  };
  assert.equal(molliePaymentMatchesOrder(payment, order), true);
});

test("molliePaymentMatchesOrder rejects wrong order, currency, amount or missing ID", () => {
  const order = { id: 42, total: "25.00" };
  const base = {
    id: "tr_123ABC",
    metadata: { orderId: "42" },
    amount: { currency: "EUR", value: "25.00" }
  };
  assert.equal(molliePaymentMatchesOrder({ ...base, metadata: { orderId: "43" } }, order), false);
  assert.equal(molliePaymentMatchesOrder({ ...base, amount: { currency: "USD", value: "25.00" } }, order), false);
  assert.equal(molliePaymentMatchesOrder({ ...base, amount: { currency: "EUR", value: "24.99" } }, order), false);
  assert.equal(molliePaymentMatchesOrder({ ...base, id: "" }, order), false);
  assert.equal(molliePaymentMatchesOrder({ ...base, amount: { currency: "EUR", value: "invalid" } }, order), false);
  assert.equal(molliePaymentMatchesOrder(base, { id: 42, total: "invalid" }), false);
});
