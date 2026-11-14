"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createBoundedRateLimiter } = require("../utils/bounded-rate-limit");

test("preserves the rolling-window request limit per key", () => {
  const check = createBoundedRateLimiter({ windowMs: 1000, maxRequests: 2, maxEntries: 10 });

  assert.equal(check("ip-a", 100), true);
  assert.equal(check("ip-a", 200), true);
  assert.equal(check("ip-a", 300), false);
  assert.equal(check("ip-b", 300), true);
  assert.equal(check("ip-a", 1100), true);
});

test("does not evict active keys when the key capacity is reached", () => {
  const check = createBoundedRateLimiter({ windowMs: 1000, maxRequests: 2, maxEntries: 2 });

  assert.equal(check("ip-a", 100), true);
  assert.equal(check("ip-b", 100), true);
  assert.equal(check("ip-c", 100), false);

  assert.equal(check("ip-a", 200), true);
  assert.equal(check("ip-a", 300), false);
  assert.equal(check("ip-c", 300), false);
});

test("reclaims expired keys and admits a new key after capacity is available", () => {
  const check = createBoundedRateLimiter({ windowMs: 1000, maxRequests: 2, maxEntries: 2 });

  assert.equal(check("ip-a", 100), true);
  assert.equal(check("ip-b", 200), true);
  assert.equal(check("ip-c", 500), false);

  // The earliest retained entry expires at 1100; pruning then removes both.
  assert.equal(check("ip-c", 1100), true);
  assert.equal(check("ip-d", 1100), true);
  assert.equal(check("ip-e", 1100), false);
});

test("rechecks capacity only when the earliest active window can have expired", () => {
  const check = createBoundedRateLimiter({ windowMs: 1000, maxRequests: 1, maxEntries: 1 });

  assert.equal(check("ip-a", 100), true);
  assert.equal(check("ip-b", 200), false);
  assert.equal(check("ip-b", 1099), false);
  assert.equal(check("ip-b", 1100), true);
});
