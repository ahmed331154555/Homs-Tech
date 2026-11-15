"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminUserRoutes } = require("../routes/admin-users");

function createHarness(pool) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); },
    put(path, ...handlers) { routes.set("PUT " + path, handlers.at(-1)); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers.at(-1)); }
  };
  registerAdminUserRoutes(app, {
    pool,
    requirePermission: () => (_req, _res, next) => next(),
    normalizeAdminPermissions: value => ({ permissions: Array.isArray(value) ? value : [] }),
    hashPassword: async value => "hashed:" + value,
    getAdminUsername: () => "root-admin"
  });
  return routes;
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("admin cannot deactivate their own account", async () => {
  let queryCalled = false;
  const routes = createHarness({ async query() { queryCalled = true; return { rows: [] }; } });
  const response = createResponse();

  await routes.get("PUT /api/admin/users/:id")(
    { params: { id: "7" }, body: { username: "subadmin", active: false, permissions: [] }, admin: { id: 7, permissions: ["admins.manage"] } },
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "U kunt uw eigen admin-account niet uitschakelen." });
  assert.equal(queryCalled, false);
});

test("admin cannot delete their own account", async () => {
  let queryCalled = false;
  const routes = createHarness({ async query() { queryCalled = true; return { rows: [] }; } });
  const response = createResponse();

  await routes.get("DELETE /api/admin/users/:id")(
    { params: { id: "7" }, admin: { id: 7, permissions: ["admins.manage"] } },
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: "U kunt uw eigen admin-account niet verwijderen." });
  assert.equal(queryCalled, false);
});
