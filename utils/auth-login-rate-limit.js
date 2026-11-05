"use strict";

const attemptsByScopeAndIp = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function checkAuthLoginRateLimit(scope, ip, now = Date.now()) {
  const cleanScope = String(scope || "").trim();
  const cleanIp = String(ip || "").trim();
  if (!cleanScope || !cleanIp) return false;

  const key = cleanScope + ":" + cleanIp;
  const recentAttempts = (attemptsByScopeAndIp.get(key) || [])
    .filter(timestamp => now - timestamp < WINDOW_MS);

  if (recentAttempts.length >= MAX_ATTEMPTS) {
    attemptsByScopeAndIp.set(key, recentAttempts);
    return false;
  }

  recentAttempts.push(now);
  attemptsByScopeAndIp.set(key, recentAttempts);

  if (attemptsByScopeAndIp.size > 10000) {
    for (const [entryKey, timestamps] of attemptsByScopeAndIp.entries()) {
      if (timestamps.every(timestamp => now - timestamp >= WINDOW_MS)) {
        attemptsByScopeAndIp.delete(entryKey);
      }
    }
  }

  return true;
}

module.exports = { checkAuthLoginRateLimit };
