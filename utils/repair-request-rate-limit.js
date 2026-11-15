"use strict";

const { createBoundedRateLimiter } = require("./bounded-rate-limit");

// Public repair quote requests: preserve the five-per-fifteen-minute policy.
const checkRepairRequestRateLimit = createBoundedRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  maxEntries: 5000
});

module.exports = { checkRepairRequestRateLimit };
