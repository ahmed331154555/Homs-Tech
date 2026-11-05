"use strict";

function createPaymentGatewayClients({
  getMollieApiKey,
  getPayPalSettings,
  getPayPalBaseUrl,
  fetchImpl = global.fetch
}) {
  if (
    typeof getMollieApiKey !== "function" ||
    typeof getPayPalSettings !== "function" ||
    typeof getPayPalBaseUrl !== "function" ||
    typeof fetchImpl !== "function"
  ) {
    throw new TypeError("Payment gateway dependencies are required.");
  }

  async function mollieRequest(endpoint, options = {}) {
    const apiKey = await getMollieApiKey();
    if (!apiKey) throw new Error("Mollie is nog niet geconfigureerd. Voeg MOLLIE_API_KEY toe aan de serveromgeving.");
    const response = await fetchImpl("https://api.mollie.com/v2" + endpoint, {
      ...options,
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error("Mollie kon de betaling niet verwerken.");
      error.statusCode = response.status;
      throw error;
    }
    return data;
  }

  async function getPayPalAccessToken(settings = null) {
    const config = settings || await getPayPalSettings();
    const clientId = String(config.clientId || "").trim();
    const clientSecret = String(config.clientSecret || "").trim();

    if (!clientId || !clientSecret) {
      throw new Error("Vul de PayPal Client ID en Client Secret in via Admin > Orderinstellingen.");
    }

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetchImpl(`${getPayPalBaseUrl(config.mode)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(`PayPal authenticatie mislukt (${response.status}). Controleer de Client ID, Client Secret en gekozen modus.`);
    }
    return data.access_token;
  }

  return { mollieRequest, getPayPalAccessToken };
}

module.exports = { createPaymentGatewayClients };
