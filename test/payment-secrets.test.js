"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  paypalEncryptionKey,
  encryptPayPalSecret,
  decryptPayPalSecret,
  getPayPalBaseUrl
} = require("../utils/payment-secrets");

test("PayPal encryption key is a stable 32-byte digest of JWT_SECRET", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret";
  try {
    const first = paypalEncryptionKey();
    const second = paypalEncryptionKey();
    assert.equal(first.length, 32);
    assert.deepEqual(first, second);
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});

test("payment provider secrets can be encrypted and decrypted", () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret-roundtrip";
  try {
    const encrypted = encryptPayPalSecret("provider-private-secret");
    assert.deepEqual(Object.keys(encrypted).sort(), ["data", "iv", "tag"]);
    assert.notEqual(encrypted.data, "provider-private-secret");
    assert.equal(decryptPayPalSecret(encrypted), "provider-private-secret");
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});

test("decryptPayPalSecret returns an empty string for missing encrypted data", () => {
  assert.equal(decryptPayPalSecret(null), "");
  assert.equal(decryptPayPalSecret({}), "");
});

test("payment secret encryption requires JWT_SECRET and rejects the wrong key", () => {
  const original = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    assert.throws(() => encryptPayPalSecret("secret"), /JWT_SECRET ontbreekt/);
    process.env.JWT_SECRET = "right-secret";
    const encrypted = encryptPayPalSecret("secret");
    process.env.JWT_SECRET = "wrong-secret";
    assert.throws(() => decryptPayPalSecret(encrypted));
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});

test("getPayPalBaseUrl selects sandbox by default and live when requested", () => {
  assert.equal(getPayPalBaseUrl(), "https://api-m.sandbox.paypal.com");
  assert.equal(getPayPalBaseUrl("sandbox"), "https://api-m.sandbox.paypal.com");
  assert.equal(getPayPalBaseUrl("LIVE"), "https://api-m.paypal.com");
});
