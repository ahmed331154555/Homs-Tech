"use strict";

function validateBuybackOfferedPrice(value, options = {}) {
  const offeredPrice = Number(value ?? 0);
  const max = Number.isFinite(options.max) ? options.max : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(offeredPrice) || offeredPrice < 0 || offeredPrice > max) {
    throw new Error("Ongeldige prijs.");
  }
  return offeredPrice;
}

module.exports = { validateBuybackOfferedPrice };
