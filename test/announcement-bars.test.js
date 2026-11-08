"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAnnouncementBarSettings,
  registerAnnouncementBarRoutes
} = require("../routes/announcement-bars");

function createHarness(queryWithConnectionRetry = async () => ({ rows: [] })) {
  const routes = new Map();
  const permissions = [];
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers.at(-1));
    },
    put(path, ...handlers) {
      routes.set("PUT " + path, handlers.at(-1));
    }
  };
  const requirePermission = permission => {
    permissions.push(permission);
    return (_req, _res, next) => next();
  };

  registerAnnouncementBarRoutes(app, {
    requirePermission,
    queryWithConnectionRetry
  });
  return { routes, permissions };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test("announcement settings apply safe defaults and clamp display values", () => {
  const settings = normalizeAnnouncementBarSettings({
    messages: ["  Welcome  ", "", "A".repeat(140)],
    background: "red",
    textColor: "#abcdef",
    speed: 900,
    height: 2,
    fontSize: 40,
    direction: "unexpected",
    mode: "unexpected"
  });

  assert.deepEqual(settings, {
    enabled: true,
    messages: ["Welcome", "A".repeat(120)],
    background: "#071d2d",
    textColor: "#abcdef",
    accentColor: "#60a5fa",
    speed: 600,
    direction: "rtl",
    mode: "scroll",
    height: 30,
    fontSize: 22
  });
});

test("announcement settings use defaults for empty or invalid input", () => {
  const settings = normalizeAnnouncementBarSettings(null);
  assert.deepEqual(settings.messages, [
    "1 jaar garantie",
    "Snel geleverd",
    "Betrouwbare service",
    "Betaalbare prijzen"
  ]);
  assert.equal(settings.enabled, true);
  assert.equal(settings.speed, 140);
});

test("public announcement endpoint validates page and returns no-store settings", async () => {
  const calls = [];
  const { routes } = createHarness(async (...args) => {
    calls.push(args);
    return { rows: [{ settings: { enabled: false, messages: ["Test"] } }] };
  });
  const handler = routes.get("GET /api/announcement-bars");
  const invalid = createResponse();

  await handler({ query: { page: "unknown" } }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 0);

  const response = createResponse();
  await handler({ query: { page: "HOME" } }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ["home"]);
  assert.equal(response.body.settings.enabled, false);
  assert.deepEqual(response.body.settings.messages, ["Test"]);
});

test("admin announcement routes require site.save permission", () => {
  const { permissions } = createHarness();
  assert.deepEqual(permissions, ["site.save", "site.save"]);
});

test("admin announcement save validates page before database access", async () => {
  let queryCount = 0;
  const { routes } = createHarness(async () => {
    queryCount += 1;
    return { rows: [] };
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/announcement-bars/:page")({
    params: { page: "invalid" },
    body: {}
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(queryCount, 0);
});

test("admin announcement save stores normalized settings", async () => {
  let queryArgs;
  const { routes } = createHarness(async (...args) => {
    queryArgs = args;
    return { rows: [{ settings: { enabled: false, messages: ["Saved"] } }] };
  });
  const response = createResponse();

  await routes.get("PUT /api/admin/announcement-bars/:page")({
    params: { page: "shop" },
    body: { enabled: false, messages: ["Saved"] }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(queryArgs[1], [
    "shop",
    JSON.stringify(normalizeAnnouncementBarSettings({
      enabled: false,
      messages: ["Saved"]
    }))
  ]);
  assert.equal(queryArgs[2], 4);
});

test("admin announcement save returns 404 when site settings do not exist", async () => {
  const { routes } = createHarness(async () => ({ rows: [] }));
  const response = createResponse();

  await routes.get("PUT /api/admin/announcement-bars/:page")({
    params: { page: "home" },
    body: {}
  }, response);

  assert.equal(response.statusCode, 404);
});
