"use strict";

// In-memory rate limiting for public repair quote requests.
// Keep the existing per-IP limit and cleanup behavior unchanged.
const repairRequestRateLimits = new Map();

function checkRepairRequestRateLimit(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes window
  const maxRequests = 5;
  const timestamps = (repairRequestRateLimits.get(ip) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  repairRequestRateLimits.set(ip, timestamps);
  // Periodic cleanup if map grows too large
  if (repairRequestRateLimits.size > 5000) {
    for (const [k, v] of repairRequestRateLimits.entries()) {
      if (v.every(t => now - t >= windowMs)) repairRequestRateLimits.delete(k);
    }
  }
  return true;
}

module.exports = { checkRepairRequestRateLimit };
