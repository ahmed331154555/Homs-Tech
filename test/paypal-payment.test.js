"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { cancelPaypalOrder } = require("../utils/paypal-payment");

test("PayPal cancellation only updates a linked PayPal order", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 7, payment_status: "Cancelled" }] };
    }
  };
  const result = await cancelPaypalOrder({ pool, orderId: 7, checkoutTokenHash: "hash" });
  assert.deepEqual(result, { statusCode: 200, body: { success: true, paid: false } });
  assert.match(calls[0].sql, /payment_method = 'PayPal'/);
  assert.match(calls[0].sql, /COALESCE\(paypal_order_id, ''\) <> ''/);
  assert.deepEqual(calls[0].params, [7, "hash"]);
  assert.equal(calls.length, 1);
});

test("PayPal cancellation cannot downgrade a paid order", async () => {
  const pool = {
    async query(sql) {
      if (sql.startsWith("UPDATE")) return { rows: [{ id: 8, payment_status: "Paid" }] };
      throw new Error("A linked paid PayPal order should be returned by UPDATE.");
    }
  };
  const result = await cancelPaypalOrder({ pool, orderId: 8, checkoutTokenHash: "hash" });
  assert.deepEqual(result, { statusCode: 200, body: { success: true, paid: true } });
});

test("PayPal cancellation rejects a non-PayPal order", async () => {
  let calls = 0;
  const pool = {
    async query(sql) {
      calls += 1;
      if (sql.startsWith("UPDATE")) return { rows: [] };
      return { rows: [{ id: 9, payment_method: "Mollie", payment_status: "Pending", paypal_order_id: null }] };
    }
  };
  const result = await cancelPaypalOrder({ pool, orderId: 9, checkoutTokenHash: "hash" });
  assert.equal(result.statusCode, 409);
  assert.match(result.body.error, /geen actieve PayPal-betaling/i);
  assert.equal(calls, 2);
});

test("PayPal cancellation returns not found for an invalid checkout token", async () => {
  const pool = { async query() { return { rows: [] }; } };
  const result = await cancelPaypalOrder({ pool, orderId: 10, checkoutTokenHash: "wrong-hash" });
  assert.deepEqual(result, { statusCode: 404, body: { error: "Webshop bestelling niet gevonden." } });
});
