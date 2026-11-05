"use strict";

function createPaymentSettings({ pool, getEnv = () => process.env, decryptSecret }) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool is required.");
  }
  if (typeof getEnv !== "function" || typeof decryptSecret !== "function") {
    throw new TypeError("Environment and secret-decryption providers are required.");
  }

  async function getMollieApiKey() {
    const result = await pool.query("SELECT data FROM order_settings WHERE id=1");
    const saved = result.rows[0]?.data?.mollie || {};
    if (saved.apiKeyEncrypted) return decryptSecret(saved.apiKeyEncrypted);
    return String(getEnv().MOLLIE_API_KEY || "").trim();
  }

  async function getPayPalSettings() {
    const result = await pool.query("SELECT data FROM order_settings WHERE id=1");
    const saved = result.rows[0]?.data?.paypal || {};
    const env = getEnv();
    const envClientId = String(env.PAYPAL_CLIENT_ID || "").trim();
    const envClientSecret = String(env.PAYPAL_CLIENT_SECRET || "").trim();
    const savedSecret = saved.clientSecretEncrypted ? decryptSecret(saved.clientSecretEncrypted) : "";
    const clientId = String(saved.clientId || envClientId).trim();
    const clientSecret = savedSecret || envClientSecret;
    const mode = String(saved.mode || env.PAYPAL_MODE || "sandbox").toLowerCase() === "live" ? "live" : "sandbox";
    const enabled = typeof saved.enabled === "boolean" ? saved.enabled : Boolean(envClientId && envClientSecret);
    return { enabled, clientId, clientSecret, mode, merchantId: String(saved.merchantId || "").trim() };
  }

  return { getMollieApiKey, getPayPalSettings };
}

module.exports = { createPaymentSettings };
