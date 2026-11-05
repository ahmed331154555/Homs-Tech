"use strict";

function validateBuybackOfferedPrice(value) {
  const offeredPrice = Number(value || 0);
  if (!Number.isFinite(offeredPrice) || offeredPrice < 0) {
    throw new Error("Ongeldige prijs.");
  }
  return offeredPrice;
}

module.exports = { validateBuybackOfferedPrice };
