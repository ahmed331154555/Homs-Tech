"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCustomerEmails } = require("../utils/customer-emails");

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function setup({ env = {}, responseValue = response(200, { id: "email_123" }) } = {}) {
  const calls = [];
  const logs = [];
  const emails = createCustomerEmails({
    getEnv: () => env,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responseValue; },
    escapeHtml: value => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"),
    logInfo: (...args) => logs.push(args)
  });
  return { ...emails, calls, logs };
}

test("verification email requires Resend API key", async () => {
  const emails = setup();
  await assert.rejects(emails.sendCustomerVerificationEmail({ email: "customer@example.test" }, "123456"), /RESEND_API_KEY/);
  assert.equal(emails.calls.length, 0);
});

test("verification email sends escaped customer details using configured sender", async () => {
  const emails = setup({ env: { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: "support@homs-tech.nl" } });
  await emails.sendCustomerVerificationEmail({ name: "<Customer>", email: "customer@example.test" }, "<123456>");
  const request = emails.calls[0];
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(body.from, "support@homs-tech.nl");
  assert.deepEqual(body.to, ["customer@example.test"]);
  assert.match(body.html, /&lt;Customer&gt;/);
  assert.match(body.html, /&lt;123456&gt;/);
  assert.equal(body.subject, "Bevestig je HOMS TECH-account");
});

test("verification email reports provider errors with status and response data", async () => {
  const emails = setup({ env: { RESEND_API_KEY: "test-key" }, responseValue: response(422, { message: "invalid recipient" }) });
  await assert.rejects(
    emails.sendCustomerVerificationEmail({ email: "bad@example.test" }, "123456"),
    error => /422/.test(error.message) && /invalid recipient/.test(error.message)
  );
});

test("welcome email skips safely when Resend is not configured", async () => {
  const emails = setup();
  await emails.sendWelcomeEmail({ name: "Customer", email: "customer@example.test" });
  assert.equal(emails.calls.length, 0);
  assert.match(emails.logs[0][0], /welcome email skipped/);
});

test("welcome email sends the account message and uses default sender when unset", async () => {
  const emails = setup({ env: { RESEND_API_KEY: "test-key" } });
  await emails.sendWelcomeEmail({ name: "Customer", email: "customer@example.test" });
  const body = JSON.parse(emails.calls[0].options.body);
  assert.equal(body.from, "onboarding@resend.dev");
  assert.equal(body.subject, "Welkom bij HOMS TECH");
  assert.deepEqual(body.to, ["customer@example.test"]);
  assert.match(body.html, /Customer/);
  assert.equal(emails.logs[0][0], "Welcome email sent:");
});
