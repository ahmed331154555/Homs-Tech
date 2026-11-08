"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sendPaidWebshopOrderNotifications } = require("../utils/webshop-paid-notifications");

function createPool(order) {
  const sent = new Set();
  const claimed = new Set();
  const updates = [];
  return {
    sent,
    updates,
    async query(sql, params = []) {
      if (/^\s*SELECT/i.test(sql)) return { rows: [order] };
      if (/UPDATE buyback_orders/i.test(sql) || /SET trade_in_status/i.test(sql)) {
        updates.push(sql);
        return { rows: [] };
      }
      const claim = sql.match(/SET (\w+_claimed_at) = NOW\(\)/);
      if (claim) {
        const sentColumn = claim[1].replace("_claimed_at", "_sent_at");
        if (sent.has(sentColumn) || claimed.has(sentColumn)) return { rows: [] };
        claimed.add(sentColumn);
        return { rows: [{ id: order.id }] };
      }
      const markSent = sql.match(/SET (\w+_sent_at) = NOW\(\)/);
      if (markSent) {
        sent.add(markSent[1]);
        claimed.delete(markSent[1]);
        return { rows: [{ id: order.id }] };
      }
      const releaseClaim = sql.match(/SET (\w+_claimed_at) = NULL/);
      if (releaseClaim) {
        claimed.delete(releaseClaim[1].replace("_claimed_at", "_sent_at"));
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

const paidOrder = {
  id: 42,
  name: "Test Customer",
  email: "customer@example.test",
  phone: "0612345678",
  street: "Teststraat",
  house_number: "1",
  postcode: "1234 AB",
  city: "Rotterdam",
  items: [{ name: "iPhone 15", qty: 1, unitPrice: 369 }],
  total: "369.00",
  payment_method: "Mollie",
  payment_status: "Paid",
  trade_in_order_id: 7,
  trade_in_estimated_value: "56.00",
  trade_in_device: "iPhone 12 Pro",
  trade_in_order_no: "BT-123",
  trade_in_storage: "128GB",
  trade_in_condition: "Licht gebruikt",
  trade_in_battery: "Ja",
  trade_in_screen: "Goed",
  trade_in_answers: {}
};

test("trade-in confirmation emails are not sent before the new phone is paid", async () => {
  const pool = createPool({ ...paidOrder, payment_status: "Unpaid" });
  let emailCalls = 0;
  const result = await sendPaidWebshopOrderNotifications({
    pool,
    orderId: 42,
    fetchImpl: async () => { emailCalls++; return { ok: true, json: async () => ({ id: "mail" }) }; },
    getEnv: () => ({ RESEND_API_KEY: "test", RESEND_FROM_EMAIL: "shop@example.test", ORDER_NOTIFICATION_EMAIL: "owner@example.test" }),
    escapeHtml: value => String(value)
  });
  assert.equal(result.reason, "not-a-paid-trade-in-order");
  assert.equal(emailCalls, 0);
});

test("cash-on-delivery trade-in order sends unpaid purchase, trade-in and owner notifications", async () => {
  const pool = createPool({ ...paidOrder, payment_method: "CashOnDelivery", payment_status: "Unpaid" });
  const messages = [];
  const result = await sendPaidWebshopOrderNotifications({
    pool,
    orderId: 42,
    allowCashOnDelivery: true,
    fetchImpl: async (_url, request) => {
      messages.push(JSON.parse(request.body));
      return { ok: true, json: async () => ({ id: "mail-" + messages.length }) };
    },
    getEnv: () => ({ RESEND_API_KEY: "test", RESEND_FROM_EMAIL: "shop@example.test", ORDER_NOTIFICATION_EMAIL: "owner@example.test" }),
    escapeHtml: value => String(value)
  });
  assert.equal(result.sent, true);
  assert.equal(result.cashOnDelivery, true);
  assert.equal(result.paymentStatus, "Unpaid");
  assert.equal(messages.length, 3);
  assert.match(messages[0].html, /betaalt het volledige bedrag bij ontvangst/);
  assert.match(messages[0].html, /Te betalen bij ontvangst/);
  assert.match(messages[1].html, /blijft in afwachting/);
  assert.match(messages[2].subject, /betaling bij ontvangst/);
  assert.match(messages[2].html, /Betaalstatus:<\/strong> Unpaid/);
  assert.equal(pool.sent.size, 3);
  assert.equal(pool.updates.length, 0);
});

test("paid trade-in order sends purchase, trade-in and owner notifications once", async () => {
  const pool = createPool(paidOrder);
  const messages = [];
  const options = {
    pool,
    orderId: 42,
    fetchImpl: async (_url, request) => {
      messages.push(JSON.parse(request.body));
      return { ok: true, json: async () => ({ id: "mail-" + messages.length }) };
    },
    getEnv: () => ({ RESEND_API_KEY: "test", RESEND_FROM_EMAIL: "shop@example.test", ORDER_NOTIFICATION_EMAIL: "owner@example.test" }),
    escapeHtml: value => String(value)
  };
  const first = await sendPaidWebshopOrderNotifications(options);
  const second = await sendPaidWebshopOrderNotifications(options);
  assert.equal(first.sent, true);
  assert.equal(second.sent, true);
  assert.equal(messages.length, 3);
  assert.match(messages[0].subject, /aankoop is bevestigd/);
  assert.match(messages[1].subject, /inruilaanvraag is gekoppeld/);
  assert.match(messages[2].subject, /betaalde aankoop met inruil/);
  assert.equal(pool.sent.size, 3);
});
