"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdminAuth } = require("../utils/admin-auth");

function makeAuth(users = {}) {
  const jwt = {
    verify(token, secret) {
      assert.equal(secret, "test-jwt-secret");
      if (token === "invalid") throw new Error("invalid token");
      if (!users[token]) throw new Error("unknown token");
      return users[token];
    }
  };
  return createAdminAuth({
    jwt,
    getAdminUsername: () => "root-admin",
    getJwtSecret: () => "test-jwt-secret"
  });
}

function makeResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("super admin receives wildcard permissions", () => {
  const auth = makeAuth();
  assert.deepEqual(auth.getSuperAdminUser("root-admin"), {
    id: null, username: "root-admin", role: "superadmin", permissions: ["*"]
  });
});

test("admin request parsing handles missing, normal and super-admin tokens", () => {
  const auth = makeAuth({
    normal: { id: 12, username: "staff", permissions: ["orders.view"] },
    root: { id: 99, username: "root-admin", role: "admin", permissions: [] }
  });
  assert.equal(auth.getAdminFromRequest({ cookies: {} }), null);
  assert.deepEqual(auth.getAdminFromRequest({ cookies: { token: "normal" } }), {
    id: 12, username: "staff", role: "admin", permissions: ["orders.view"]
  });
  assert.deepEqual(auth.getAdminFromRequest({ cookies: { token: "root" } }), {
    id: null, username: "root-admin", role: "superadmin", permissions: ["*"]
  });
});

test("requireAuth allows valid users and rejects missing or invalid tokens", () => {
  const auth = makeAuth({ valid: { id: 3, username: "staff", permissions: [] } });
  const next = { called: false };
  const req = { cookies: { token: "valid" } };
  auth.requireAuth(req, makeResponse(), () => { next.called = true; });
  assert.equal(next.called, true);
  assert.equal(req.admin.username, "staff");

  const missing = makeResponse();
  auth.requireAuth({ cookies: {} }, missing, () => assert.fail("next must not run"));
  assert.equal(missing.statusCode, 401);

  const invalid = makeResponse();
  auth.requireAuth({ cookies: { token: "invalid" } }, invalid, () => assert.fail("next must not run"));
  assert.equal(invalid.statusCode, 401);
});

test("requirePermission allows exact permissions and wildcard permissions", () => {
  const auth = makeAuth({
    exact: { id: 1, username: "staff", permissions: ["orders.view"] },
    wildcard: { id: 2, username: "manager", permissions: ["*"] },
    root: { id: 3, username: "root-admin", permissions: [] }
  });
  for (const token of ["exact", "wildcard", "root"]) {
    const req = { cookies: { token } };
    const response = makeResponse();
    let nextCalled = false;
    auth.requirePermission("orders.view")(req, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.ok(req.admin);
    assert.equal(response.statusCode, 200);
  }
});

test("requirePermission rejects users without permission and unauthenticated users", () => {
  const auth = makeAuth({ limited: { id: 4, username: "staff", permissions: ["orders.view"] } });
  const denied = makeResponse();
  auth.requirePermission("orders.delete")({ cookies: { token: "limited" } }, denied, () => assert.fail("next must not run"));
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body.error, /Geen toestemming/);

  const unauthenticated = makeResponse();
  auth.requirePermission("orders.view")({ cookies: {} }, unauthenticated, () => assert.fail("next must not run"));
  assert.equal(unauthenticated.statusCode, 401);
});
