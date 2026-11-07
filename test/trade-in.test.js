"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  toCents,
  fromCents,
  calculateTradeInCheckout,
  calculateTradeInAdjustment,
  validateTradeInInspectionStatus
} = require("../utils/trade-in");

test("trade-in checkout subtracts the estimate using integer cents", () => {
  assert.deepEqual(calculateTradeInCheckout(279, 90), {
    productTotal: 279,
    estimatedTradeInValue: 90,
    appliedCredit: 90,
    payableTotal: 189,
    unappliedCredit: 0,
    zeroPayable: false
  });
});

test("trade-in credit cannot create a cash payout at checkout", () => {
  assert.deepEqual(calculateTradeInCheckout(80, 100), {
    productTotal: 80,
    estimatedTradeInValue: 100,
    appliedCredit: 80,
    payableTotal: 0,
    unappliedCredit: 20,
    zeroPayable: true
  });
});

test("inspection shortfall is marked as customer due", () => {
  assert.deepEqual(calculateTradeInAdjustment(90, 55), {
    estimatedValue: 90,
    inspectedValue: 55,
    difference: 35,
    direction: "customer_due",
    customerDue: 35,
    customerCredit: 0
  });
});

test("higher inspected value is a customer credit, not a negative charge", () => {
  assert.deepEqual(calculateTradeInAdjustment(90, 110), {
    estimatedValue: 90,
    inspectedValue: 110,
    difference: 20,
    direction: "customer_credit",
    customerDue: 0,
    customerCredit: 20
  });
});

test("money conversion rejects invalid and negative amounts", () => {
  assert.equal(toCents("12.34"), 1234);
  assert.equal(fromCents(1234), 12.34);
  assert.throws(() => toCents(-1), /ongeldig/i);
  assert.throws(() => toCents("NaN"), /ongeldig/i);
});

test("trade-in inspection statuses are allow-listed", () => {
  assert.equal(validateTradeInInspectionStatus("Received"), "Received");
  assert.throws(() => validateTradeInInspectionStatus("Paid"), /status/i);
});
