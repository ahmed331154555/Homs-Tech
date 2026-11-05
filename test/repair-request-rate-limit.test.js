"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkRepairRequestRateLimit } = require("../utils/repair-request-rate-limit");

test("repair quote rate limit allows five requests per IP in the window", () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  const ip = "test-five-" + now;
  try {
    for (let request = 0; request < 5; request += 1) {
      assert.equal(checkRepairRequestRateLimit(ip), true);
    }
    assert.equal(checkRepairRequestRateLimit(ip), false);
  } finally {
    Date.now = originalNow;
  }
});

test("repair quote rate limit tracks IP addresses independently", () => {
  const originalNow = Date.now;
  let now = 1_800_000_100_000;
  Date.now = () => now;
  const firstIp = "test-first-" + now;
  const secondIp = "test-second-" + now;
  try {
    for (let request = 0; request < 5; request += 1) {
      assert.equal(checkRepairRequestRateLimit(firstIp), true);
    }
    assert.equal(checkRepairRequestRateLimit(firstIp), false);
    assert.equal(checkRepairRequestRateLimit(secondIp), true);
  } finally {
    Date.now = originalNow;
  }
});

test("repair quote rate limit resets after fifteen minutes", () => {
  const originalNow = Date.now;
  let now = 1_800_000_200_000;
  Date.now = () => now;
  const ip = "test-window-" + now;
  try {
    for (let request = 0; request < 5; request += 1) {
      assert.equal(checkRepairRequestRateLimit(ip), true);
    }
    assert.equal(checkRepairRequestRateLimit(ip), false);
    now += 15 * 60 * 1000;
    assert.equal(checkRepairRequestRateLimit(ip), true);
  } finally {
    Date.now = originalNow;
  }
});
