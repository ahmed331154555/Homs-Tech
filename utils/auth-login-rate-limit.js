"use strict";

const { createBoundedRateLimiter } = require("./bounded-rate-limit");

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// Keep admin/customer scopes separate and cap total retained keys.
const checkAttempt = createBoundedRateLimiter({
  windowMs: WINDOW_MS,
  maxRequests: MAX_ATTEMPTS,
  maxEntries: 10000
});

function checkAuthLoginRateLimit(scope, ip, now = Date.now()) {
  const cleanScope = String(scope || "").trim();
  const cleanIp = String(ip || "").trim();
  if (!cleanScope || !cleanIp) return false;

  return checkAttempt(cleanScope + ":" + cleanIp, now);
}

module.exports = { checkAuthLoginRateLimit };
