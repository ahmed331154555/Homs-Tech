"use strict";

function moneyNumber(value) {
  let cleaned = String(value ?? "").replace(/[€\s]/g, "").trim();
  if (!cleaned) return NaN;
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    cleaned = comma > dot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (comma >= 0) {
    cleaned = /,\d{3}$/.test(cleaned) ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  } else if (/\.\d{3}(?:\.\d{3})*$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, "");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = { moneyNumber };
