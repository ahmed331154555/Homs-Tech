"use strict";

const { moneyNumber } = require("./money");

const TERMINAL_PAYMENT_STATUSES = new Set(["Cancelled", "Expired", "Failed"]);

function mollieStatusToLocal(status) {
  const map = {
    paid: "Paid",
    canceled: "Cancelled",
    expired: "Expired",
    failed: "Failed",
    pending: "Pending",
    authorized: "Pending"
  };
  return map[String(status || "").toLowerCase()] || "Pending";
}

function resolveMolliePaymentStatus(currentStatus, providerStatus) {
  const current = String(currentStatus || "").trim();
  const next = mollieStatusToLocal(providerStatus);
  if (current === "Paid") return "Paid";
  if (TERMINAL_PAYMENT_STATUSES.has(current) && next !== "Paid") return current;
  return next;
}

function molliePaymentMatchesOrder(payment, order) {
  const expectedAmount = moneyNumber(order.total);
  const actualAmount = moneyNumber(payment && payment.amount && payment.amount.value);
  return String(payment && payment.id || "") !== "" &&
    String(payment && payment.metadata && payment.metadata.orderId || "") === String(order.id) &&
    String(payment && payment.amount && payment.amount.currency || "").toUpperCase() === "EUR" &&
    Number.isFinite(expectedAmount) && Number.isFinite(actualAmount) &&
    Math.abs(expectedAmount - actualAmount) < 0.005;
}

module.exports = {
  mollieStatusToLocal,
  resolveMolliePaymentStatus,
  molliePaymentMatchesOrder
};
