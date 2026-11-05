"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaymentGatewayClients } = require("../utils/payment-gateways");

function makeResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

function makeClients({ apiKey = "mollie-test-key", paypalSettings = null, response = makeResponse(200, {}), fetchImpl } = {}) {
  const calls = [];
  const clients = createPaymentGatewayClients({
    getMollieApiKey: async () => apiKey,
    getPayPalSettings: async () => paypalSettings || { clientId: "paypal-id", clientSecret: "paypal-secret", mode: "sandbox" },
    getPayPalBaseUrl: mode => mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    fetchImpl: fetchImpl || (async (url, options) => {
      calls.push({ url, options });
      return response;
    })
  });
  return { ...clients, calls };
}

test("Mollie request rejects missing API keys without making a network request", async () => {
  const clients = makeClients({ apiKey: "" });
  await assert.rejects(clients.mollieRequest("/payments"), /MOLLIE_API_KEY/);
  assert.equal(clients.calls.length, 0);
});

test("Mollie request sends authenticated JSON requests and returns the response body", async () => {
  const clients = makeClients({ response: makeResponse(200, { id: "tr_123", status: "open" }) });
  const result = await clients.mollieRequest("/payments", {
    method: "POST",
    body: JSON.stringify({ amount: { currency: "EUR", value: "10.00" } }),
    headers: { "X-Request-ID": "test-request" }
  });
  assert.deepEqual(result, { id: "tr_123", status: "open" });
  assert.equal(clients.calls[0].url, "https://api.mollie.com/v2/payments");
  assert.equal(clients.calls[0].options.headers.Authorization, "Bearer mollie-test-key");
  assert.equal(clients.calls[0].options.headers.Accept, "application/json");
  assert.equal(clients.calls[0].options.headers["X-Request-ID"], "test-request");
  assert.equal(clients.calls[0].options.method, "POST");
});

test("Mollie request preserves provider HTTP status in errors", async () => {
  const clients = makeClients({ response: makeResponse(401, { message: "unauthorized" }) });
  await assert.rejects(
    clients.mollieRequest("/payments"),
    error => error.statusCode === 401 && /Mollie kon de betaling/.test(error.message)
  );
});

test("PayPal access token requires both credentials", async () => {
  const clients = makeClients({ paypalSettings: { clientId: "id", clientSecret: "", mode: "sandbox" } });
  await assert.rejects(clients.getPayPalAccessToken(), /Client ID en Client Secret/);
  assert.equal(clients.calls.length, 0);
});

test("PayPal access token uses Basic authentication and the selected mode", async () => {
  const clients = makeClients({
    paypalSettings: { clientId: " client ", clientSecret: " secret ", mode: "live" },
    response: makeResponse(200, { access_token: "access-token" })
  });
  assert.equal(await clients.getPayPalAccessToken(), "access-token");
  assert.equal(clients.calls[0].url, "https://api-m.paypal.com/v1/oauth2/token");
  assert.equal(clients.calls[0].options.headers.Authorization, "Basic " + Buffer.from("client:secret").toString("base64"));
  assert.equal(clients.calls[0].options.body, "grant_type=client_credentials");
});

test("PayPal access token rejects unsuccessful or malformed provider responses", async () => {
  const denied = makeClients({ response: makeResponse(401, { error: "invalid_client" }) });
  await assert.rejects(denied.getPayPalAccessToken(), /PayPal authenticatie mislukt \(401\)/);
  const malformed = makeClients({ response: makeResponse(200, {}) });
  await assert.rejects(malformed.getPayPalAccessToken(), /PayPal authenticatie mislukt \(200\)/);
});
