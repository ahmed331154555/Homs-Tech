"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, verifyPassword } = require("../utils/password");

test("hashPassword creates a salted scrypt hash", async () => {
  const first = await hashPassword("HomsTech-test-password");
  const second = await hashPassword("HomsTech-test-password");

  assert.match(first, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.match(second, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.notEqual(first, second);
});

test("verifyPassword accepts the matching password", async () => {
  const storedHash = await hashPassword("correct-password");

  assert.equal(await verifyPassword("correct-password", storedHash), true);
});

test("verifyPassword rejects a wrong password and malformed hashes", async () => {
  const storedHash = await hashPassword("correct-password");

  assert.equal(await verifyPassword("wrong-password", storedHash), false);
  assert.equal(await verifyPassword("correct-password", ""), false);
  assert.equal(await verifyPassword("correct-password", "invalid"), false);
  assert.equal(await verifyPassword("correct-password", "salt:abcd"), false);
});
