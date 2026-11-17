"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hashToken, parseStock } = require("../routes/partner-api");

test("partner API keys are stored as deterministic SHA-256 hashes, not plaintext", () => {
  const token = "htp_" + "a".repeat(64);
  const hash = hashToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hashToken(token), hash);
});

test("partner stock parser handles numeric and Dutch stock labels safely", () => {
  assert.equal(parseStock(4), 4);
  assert.equal(parseStock("3 stuks"), 3);
  assert.equal(parseStock("0 op voorraad"), 0);
  assert.equal(parseStock("onbekend"), null);
  assert.equal(parseStock(null), null);
});

