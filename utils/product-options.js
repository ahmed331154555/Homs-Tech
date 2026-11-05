"use strict";

const { moneyNumber } = require("./money");

function serverOptionDelta(option, key) {
  if (!option) return 0;
  const label = String(option.label || "").toLowerCase();
  if (key === "battery") return label.includes("nieuw") ? 30 : 0;
  if (key === "vat") return label.includes("met btw") ? 10 : 0;
  const raw = option.priceDelta ?? option.delta ?? option.priceAdjustment ?? option.extra ?? option.amount ?? option.value;
  if (raw !== undefined && raw !== null && raw !== "") {
    const n = moneyNumber(raw);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  const match = String(option.label || "").match(/([+-])\s*€?\s*(\d+(?:[.,]\d+)?)\s*$/);
  if (match) {
    const amount = Number(match[2].replace(",", "."));
    return match[1] === "-" ? -amount : amount;
  }
  if (option.price !== undefined && option.price !== null && option.price !== "") {
    const n = moneyNumber(option.price);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function serverOptionDefaults(key) {
  const defaults = {
    condition: ["Zichtbaar gebruikt", "Licht gebruikt", "Zo goed als nieuw"],
    storage: ["64 GB", "128 GB", "256 GB", "512 GB", "1 TB"],
    color: ["Zwart", "Wit", "Blauw", "Rood"],
    battery: ["Standaard", "Nieuw (100%)"],
    vat: ["Zonder BTW", "Met BTW"],
    tradeIn: ["Nee", "Ja"]
  };
  return (defaults[key] || []).map(label => ({ label, active: true, enabled: true, available: true, priceDelta: 0 }));
}

module.exports = { serverOptionDelta, serverOptionDefaults };
