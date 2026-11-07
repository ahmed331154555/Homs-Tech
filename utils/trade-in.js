"use strict";

const MAX_EURO_CENTS = 10000000;

function toCents(value, label = "Bedrag") {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_EURO_CENTS / 100) {
    throw new RangeError(label + " is ongeldig.");
  }
  return Math.round((number + Number.EPSILON) * 100);
}

function fromCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_EURO_CENTS) {
    throw new RangeError("Bedrag in centen is ongeldig.");
  }
  return Number((cents / 100).toFixed(2));
}

function calculateTradeInCheckout(productTotal, estimatedTradeInValue) {
  const productTotalCents = toCents(productTotal, "Producttotaal");
  const estimatedValueCents = toCents(estimatedTradeInValue, "Inruilwaarde");
  if (productTotalCents <= 0) throw new RangeError("Het producttotaal moet hoger zijn dan nul.");

  // Trade-in value is a discount only. HOMS TECH never pays out a surplus
  // during checkout; any excess value must be handled as a separately approved credit.
  const appliedCreditCents = Math.min(productTotalCents, estimatedValueCents);
  return Object.freeze({
    productTotal: fromCents(productTotalCents),
    estimatedTradeInValue: fromCents(estimatedValueCents),
    appliedCredit: fromCents(appliedCreditCents),
    payableTotal: fromCents(productTotalCents - appliedCreditCents),
    unappliedCredit: fromCents(estimatedValueCents - appliedCreditCents),
    zeroPayable: productTotalCents === appliedCreditCents
  });
}

function calculateTradeInAdjustment(estimatedTradeInValue, inspectedTradeInValue) {
  const estimatedCents = toCents(estimatedTradeInValue, "Geschatte inruilwaarde");
  const inspectedCents = toCents(inspectedTradeInValue, "Definitieve inruilwaarde");
  const differenceCents = inspectedCents - estimatedCents;
  return Object.freeze({
    estimatedValue: fromCents(estimatedCents),
    inspectedValue: fromCents(inspectedCents),
    difference: fromCents(Math.abs(differenceCents)),
    // positive means HOMS TECH owes the customer; negative means the customer
    // must pay the shortfall before the order can be shipped.
    direction: differenceCents > 0 ? "customer_credit" : differenceCents < 0 ? "customer_due" : "no_change",
    customerDue: fromCents(Math.max(0, -differenceCents)),
    customerCredit: fromCents(Math.max(0, differenceCents))
  });
}

function validateTradeInInspectionStatus(status) {
  const allowed = new Set(["AwaitingDevice", "Received", "Inspecting", "Approved", "AdjustmentRequired", "Settled", "Rejected", "Returned"]);
  const value = String(status || "").trim();
  if (!allowed.has(value)) throw new Error("Ongeldige inruilstatus.");
  return value;
}

module.exports = {
  toCents,
  fromCents,
  calculateTradeInCheckout,
  calculateTradeInAdjustment,
  validateTradeInInspectionStatus
};
