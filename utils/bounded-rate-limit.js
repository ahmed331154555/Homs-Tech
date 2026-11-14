"use strict";

/**
 * Creates a rolling-window rate limiter with a hard cap on stored keys.
 *
 * When the key store is full, expired entries are pruned once. If it remains
 * full, new keys are rejected until the earliest active window expires.
 * Existing keys keep their counters; active limits are never evicted to make
 * room for a new address.
 */
function createBoundedRateLimiter({ windowMs, maxRequests, maxEntries }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0 ||
      !Number.isInteger(maxRequests) || maxRequests <= 0 ||
      !Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new TypeError("Invalid bounded rate limiter configuration");
  }

  const entries = new Map();
  let nextCapacityCheckAt = 0;

  function pruneExpired(now) {
    let earliestExpiry = Infinity;

    for (const [key, timestamps] of entries) {
      const recent = timestamps.filter(timestamp => now - timestamp < windowMs);
      if (recent.length === 0) {
        entries.delete(key);
        continue;
      }

      if (recent.length !== timestamps.length) entries.set(key, recent);
      for (const timestamp of recent) {
        const expiresAt = timestamp + windowMs;
        if (expiresAt < earliestExpiry) earliestExpiry = expiresAt;
      }
    }

    nextCapacityCheckAt = Number.isFinite(earliestExpiry) ? earliestExpiry : now;
  }

  function check(key, now = Date.now()) {
    const hasKey = entries.has(key);
    const recent = hasKey
      ? entries.get(key).filter(timestamp => now - timestamp < windowMs)
      : [];

    if (recent.length >= maxRequests) {
      entries.set(key, recent);
      return false;
    }

    if (!hasKey && entries.size >= maxEntries) {
      // Avoid scanning the whole map on every rejected request during a burst.
      if (now < nextCapacityCheckAt) return false;
      pruneExpired(now);
      if (entries.size >= maxEntries) return false;
    }

    recent.push(now);
    entries.set(key, recent);
    return true;
  }

  return check;
}

module.exports = { createBoundedRateLimiter };
