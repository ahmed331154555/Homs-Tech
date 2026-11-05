"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdminAuth } = require("../utils/admin-auth");

function makeAuth(users = {}, pool = null) {
  const jwt = {
    verify(token, secret) {
      assert.equal(secret, "test-jwt-secret");
      if (token === "invalid") throw new Error("invalid token");
      if (!users[token]) throw new Error("unknown token");
      return users[token];
    }
  };
  const database = pool || {
    async query(_sql, params) {
      const user = Object.values(users).find(candidate =>
        (candidate.id || 0) === params[0] ||
        String(candidate.username || "").toLowerCase() === String(params[1] || "").toLowerCase()
      );
      return { rows: user ? [{ ...user, active: true }] : [] };
    }
  };
  return createAdminAuth({
    jwt,
    getAdminUsername: () => "root-admin",
    getJwtSecret: () => "test-jwt-secret",
    pool: database,
    logError: () => {}
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

test("requirePermission allows exact permissions and wildcard permissions", async () => {
  const auth = makeAuth({
    exact: { id: 1, username: "staff", permissions: ["orders.view"] },
    wildcard: { id: 2, username: "manager", permissions: ["*"] },
    root: { id: 3, username: "root-admin", permissions: [] }
  });
  for (const token of ["exact", "wildcard", "root"]) {
    const req = { cookies: { token } };
    const response = makeResponse();
    let nextCalled = false;
    await auth.requirePermission("orders.view")(req, response, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.ok(req.admin);
    assert.equal(response.statusCode, 200);
  }
});

test("requirePermission rejects users without permission and unauthenticated users", async () => {
  const auth = makeAuth({ limited: { id: 4, username: "staff", permissions: ["orders.view"] } });
  const denied = makeResponse();
  await auth.requirePermission("orders.delete")({ cookies: { token: "limited" } }, denied, () => assert.fail("next must not run"));
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body.error, /Geen toestemming/);

  const unauthenticated = makeResponse();
  await auth.requirePermission("orders.view")({ cookies: {} }, unauthenticated, () => assert.fail("next must not run"));
  assert.equal(unauthenticated.statusCode, 401);
});


test("admin permission refresh uses current database permissions and rejects inactive accounts", async () => {
  const pool = {
    async query(_sql, params) {
      if (params[0] === 10) return { rows: [{ id: 10, username: "staff", role: "admin", permissions: ["site.save"], active: true }] };
      if (params[0] === 11) return { rows: [{ id: 11, username: "disabled", role: "admin", permissions: ["*"], active: false }] };
      return { rows: [] };
    }
  };
  const auth = makeAuth({
    active: { id: 10, username: "staff", permissions: ["orders.delete"] },
    inactive: { id: 11, username: "disabled", permissions: ["site.save"] }
  }, pool);
  const refreshed = await auth.refreshAdminUserFromDb(auth.getAdminFromRequest({ cookies: { token: "active" } }));
  assert.deepEqual(refreshed, { id: 10, username: "staff", role: "admin", permissions: ["site.save"] });
  const inactive = await auth.refreshAdminUserFromDb(auth.getAdminFromRequest({ cookies: { token: "inactive" } }));
  assert.equal(inactive, null);
});

test("admin permission refresh fails closed when the database is unavailable", async () => {
  const auth = makeAuth(
    { stale: { id: 15, username: "staff", permissions: ["site.save"] } },
    { query: async () => { throw new Error("database unavailable"); } }
  );
  const user = auth.getAdminFromRequest({ cookies: { token: "stale" } });
  assert.equal(await auth.refreshAdminUserFromDb(user), null);
});

test("site update middleware uses refreshed permissions and fails closed", async () => {
  const activePool = {
    async query(_sql, params) {
      if (params[0] === 20) return { rows: [{ id: 20, username: "editor", role: "admin", permissions: ["phones.update"], active: true }] };
      if (params[0] === 21) return { rows: [{ id: 21, username: "disabled", role: "admin", permissions: ["site.save"], active: false }] };
      return { rows: [] };
    }
  };
  const auth = makeAuth({
    editor: { id: 20, username: "editor", permissions: ["orders.delete"] },
    disabled: { id: 21, username: "disabled", permissions: ["site.save"] }
  }, activePool);

  const allowedRequest = { cookies: { token: "editor" }, headers: { "x-homs-admin-section": "phones" } };
  const allowedResponse = makeResponse();
  let nextCalled = false;
  await auth.requireSiteOrPhoneUpdate(allowedRequest, allowedResponse, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(allowedRequest.admin.permissions, ["phones.update"]);

  const deniedRequest = { cookies: { token: "editor" }, headers: { "x-homs-admin-section": "general" } };
  const deniedResponse = makeResponse();
  await auth.requireSiteOrPhoneUpdate(deniedRequest, deniedResponse, () => assert.fail("next must not run"));
  assert.equal(deniedResponse.statusCode, 403);

  const inactiveRequest = { cookies: { token: "disabled" }, headers: { "x-homs-admin-section": "general" } };
  const inactiveResponse = makeResponse();
  await auth.requireSiteOrPhoneUpdate(inactiveRequest, inactiveResponse, () => assert.fail("next must not run"));
  assert.equal(inactiveResponse.statusCode, 401);
});

test("site update middleware denies access when permission refresh query fails", async () => {
  const auth = makeAuth(
    { stale: { id: 22, username: "staff", permissions: ["site.save"] } },
    { query: async () => { throw new Error("database unavailable"); } }
  );
  const response = makeResponse();
  await auth.requireSiteOrPhoneUpdate(
    { cookies: { token: "stale" }, headers: {} },
    response,
    () => assert.fail("next must not run")
  );
  assert.equal(response.statusCode, 401);
});


test("requirePermission refreshes current database permissions and rejects disabled wildcard admins", async () => {
  const pool = {
    async query(_sql, params) {
      if (params[0] === 30) return { rows: [{ id: 30, username: "staff", role: "admin", permissions: ["orders.view"], active: true }] };
      if (params[0] === 31) return { rows: [{ id: 31, username: "disabled", role: "admin", permissions: ["*"], active: false }] };
      return { rows: [] };
    }
  };
  const auth = makeAuth({
    staff: { id: 30, username: "staff", permissions: ["orders.delete"] },
    disabled: { id: 31, username: "disabled", permissions: ["*"] }
  }, pool);

  const allowedRequest = { cookies: { token: "staff" } };
  let allowedNext = false;
  await auth.requirePermission("orders.view")(allowedRequest, makeResponse(), () => { allowedNext = true; });
  assert.equal(allowedNext, true);
  assert.deepEqual(allowedRequest.admin.permissions, ["orders.view"]);

  const stalePermissionResponse = makeResponse();
  await auth.requirePermission("orders.delete")(
    { cookies: { token: "staff" } },
    stalePermissionResponse,
    () => assert.fail("stale token permission must not be trusted")
  );
  assert.equal(stalePermissionResponse.statusCode, 403);

  const disabledResponse = makeResponse();
  await auth.requirePermission("orders.view")(
    { cookies: { token: "disabled" } },
    disabledResponse,
    () => assert.fail("disabled admin must not be allowed")
  );
  assert.equal(disabledResponse.statusCode, 401);
});

test("requirePermission denies access when the database cannot refresh permissions", async () => {
  const auth = makeAuth(
    { stale: { id: 32, username: "staff", permissions: ["orders.delete"] } },
    { query: async () => { throw new Error("database unavailable"); } }
  );
  const response = makeResponse();
  await auth.requirePermission("orders.delete")(
    { cookies: { token: "stale" } },
    response,
    () => assert.fail("database failure must not allow access")
  );
  assert.equal(response.statusCode, 401);
});
