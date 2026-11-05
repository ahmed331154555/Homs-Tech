"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { checkAuthLoginRateLimit } = require("../utils/auth-login-rate-limit");

test("limits repeated login attempts from the same IP and scope", () => {
  const now = 1_000_000;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(checkAuthLoginRateLimit("admin-test", "192.0.2.10", now + attempt), true);
  }
  assert.equal(checkAuthLoginRateLimit("admin-test", "192.0.2.10", now + 11), false);
});

test("keeps admin and customer login limits separate", () => {
  const now = 2_000_000;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(checkAuthLoginRateLimit("admin-separate-test", "192.0.2.11", now + attempt), true);
  }
  assert.equal(checkAuthLoginRateLimit("customer-separate-test", "192.0.2.11", now + 11), true);
});

test("allows attempts again after the rolling window expires", () => {
  const now = 3_000_000;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    assert.equal(checkAuthLoginRateLimit("expiry-test", "192.0.2.12", now + attempt), true);
  }
  assert.equal(checkAuthLoginRateLimit("expiry-test", "192.0.2.12", now + 15 * 60 * 1000 + 1), true);
});

test("rejects missing scope or IP instead of sharing a global bucket", () => {
  assert.equal(checkAuthLoginRateLimit("", "192.0.2.13"), false);
  assert.equal(checkAuthLoginRateLimit("admin", ""), false);
});
