"use strict";

function deviceText(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function deviceMoney(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 && number <= 100000000
    ? number
    : NaN;
}

module.exports = { deviceText, deviceMoney };
