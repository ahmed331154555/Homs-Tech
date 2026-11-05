"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRepairRequestCustomerId } = require("../utils/repair-request-customer");

test("links a repair request only to the verified account in its valid customer session", async () => {
  let lookup;
  const id = await resolveRepairRequestCustomerId({
    token: "valid-session",
    jwtSecret: "configured-secret",
    verifyToken: (token, secret) => {
      assert.equal(token, "valid-session");
      assert.equal(secret, "configured-secret");
      return { customerId: 42 };
    },
    findVerifiedCustomer: async (customerId, email) => {
      lookup = { customerId, email };
      return { id: 42 };
    },
    email: " CUSTOMER@example.com "
  });

  assert.equal(id, 42);
  assert.deepEqual(lookup, { customerId: 42, email: "customer@example.com" });
});

test("does not link a public request by email when no customer session exists", async () => {
  let lookedUp = false;
  const id = await resolveRepairRequestCustomerId({
    token: "",
    jwtSecret: "configured-secret",
    verifyToken: () => ({ customerId: 42 }),
    findVerifiedCustomer: async () => {
      lookedUp = true;
      return { id: 42 };
    },
    email: "customer@example.com"
  });

  assert.equal(id, null);
  assert.equal(lookedUp, false);
});

test("does not accept a customer token when JWT_SECRET is missing", async () => {
  let verified = false;
  const id = await resolveRepairRequestCustomerId({
    token: "valid-session",
    jwtSecret: "",
    verifyToken: () => {
      verified = true;
      return { customerId: 42 };
    },
    findVerifiedCustomer: async () => ({ id: 42 }),
    email: "customer@example.com"
  });

  assert.equal(id, null);
  assert.equal(verified, false);
});

test("does not link an invalid or expired customer session", async () => {
  const id = await resolveRepairRequestCustomerId({
    token: "expired-session",
    jwtSecret: "configured-secret",
    verifyToken: () => {
      throw new Error("jwt expired");
    },
    findVerifiedCustomer: async () => {
      assert.fail("Customer lookup must not run for an invalid session");
    },
    email: "customer@example.com"
  });

  assert.equal(id, null);
});

test("does not link a session whose account email does not match the submitted email", async () => {
  const id = await resolveRepairRequestCustomerId({
    token: "valid-session",
    jwtSecret: "configured-secret",
    verifyToken: () => ({ customerId: 42 }),
    findVerifiedCustomer: async (customerId, email) => {
      assert.equal(customerId, 42);
      assert.equal(email, "someone-else@example.com");
      return null;
    },
    email: "someone-else@example.com"
  });

  assert.equal(id, null);
});
