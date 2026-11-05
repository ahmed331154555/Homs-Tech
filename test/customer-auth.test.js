"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCustomerAuth } = require("../utils/customer-auth");

function setup() {
  const jwt = {
    verify(token, secret) {
      assert.equal(secret, "customer-test-secret");
      if (token !== "valid") throw new Error("invalid token");
      return { customerId: 42 };
    }
  };
  return createCustomerAuth({ jwt, getJwtSecret: () => "customer-test-secret" });
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("customer authentication attaches the verified customer ID", () => {
  const auth = setup();
  const req = { cookies: { customerToken: "valid" } };
  const res = response();
  let nextCalled = false;
  auth.requireCustomerAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.customerId, 42);
  assert.equal(res.statusCode, 200);
});

test("customer authentication rejects missing cookies and invalid tokens", () => {
  const auth = setup();
  const missing = response();
  auth.requireCustomerAuth({ cookies: {} }, missing, () => assert.fail("next must not run"));
  assert.equal(missing.statusCode, 401);
  assert.deepEqual(missing.body, { error: "Niet ingelogd" });

  const invalid = response();
  auth.requireCustomerAuth({ cookies: { customerToken: "invalid" } }, invalid, () => assert.fail("next must not run"));
  assert.equal(invalid.statusCode, 401);
  assert.deepEqual(invalid.body, { error: "Niet ingelogd" });
});

test("customer authentication safely rejects requests without a cookie parser result", () => {
  const auth = setup();
  const res = response();
  auth.requireCustomerAuth({}, res, () => assert.fail("next must not run"));
  assert.equal(res.statusCode, 401);
});
