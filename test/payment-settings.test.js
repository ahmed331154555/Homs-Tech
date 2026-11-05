"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentSettings } = require("../utils/payment-settings");

function makeSettings(savedData, env = {}) {
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(sql);
      return { rows: savedData === null ? [] : [{ data: savedData }] };
    }
  };
  const decrypted = [];
  const settings = createPaymentSettings({
    pool,
    getEnv: () => env,
    decryptSecret(value) {
      decrypted.push(value);
      return "decrypted:" + value.id;
    }
  });
  return { ...settings, queries, decrypted };
}

test("Mollie API key uses the server environment when no encrypted key is saved", async () => {
  const settings = makeSettings({}, { MOLLIE_API_KEY: " env-mollie-key " });
  assert.equal(await settings.getMollieApiKey(), "env-mollie-key");
  assert.equal(settings.decrypted.length, 0);
});

test("Mollie API key prefers the encrypted admin setting", async () => {
  const encrypted = { id: "mollie" };
  const settings = makeSettings({ mollie: { apiKeyEncrypted: encrypted } }, { MOLLIE_API_KEY: "fallback-key" });
  assert.equal(await settings.getMollieApiKey(), "decrypted:mollie");
  assert.deepEqual(settings.decrypted, [encrypted]);
});

test("PayPal settings use environment credentials and sandbox defaults", async () => {
  const settings = makeSettings({}, {
    PAYPAL_CLIENT_ID: " client-id ",
    PAYPAL_CLIENT_SECRET: " client-secret "
  });
  assert.deepEqual(await settings.getPayPalSettings(), {
    enabled: true,
    clientId: "client-id",
    clientSecret: "client-secret",
    mode: "sandbox",
    merchantId: ""
  });
});

test("PayPal saved settings override environment credentials and decrypt the secret", async () => {
  const encrypted = { id: "paypal" };
  const settings = makeSettings({
    paypal: {
      enabled: true,
      clientId: "saved-client",
      clientSecretEncrypted: encrypted,
      mode: "live",
      merchantId: "merchant-123"
    }
  }, {
    PAYPAL_CLIENT_ID: "env-client",
    PAYPAL_CLIENT_SECRET: "env-secret",
    PAYPAL_MODE: "sandbox"
  });
  assert.deepEqual(await settings.getPayPalSettings(), {
    enabled: true,
    clientId: "saved-client",
    clientSecret: "decrypted:paypal",
    mode: "live",
    merchantId: "merchant-123"
  });
  assert.deepEqual(settings.decrypted, [encrypted]);
});

test("an explicit disabled PayPal setting overrides available environment credentials", async () => {
  const settings = makeSettings({
    paypal: { enabled: false }
  }, {
    PAYPAL_CLIENT_ID: "env-client",
    PAYPAL_CLIENT_SECRET: "env-secret",
    PAYPAL_MODE: "LIVE"
  });
  const result = await settings.getPayPalSettings();
  assert.equal(result.enabled, false);
  assert.equal(result.mode, "live");
});

test("unknown PayPal modes safely fall back to sandbox", async () => {
  const settings = makeSettings({ paypal: { mode: "unexpected" } });
  assert.equal((await settings.getPayPalSettings()).mode, "sandbox");
});
