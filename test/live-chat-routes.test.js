"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerLiveChatRoutes } = require("../routes/live-chat");

function createApp() {
  const routes = new Map();
  return {
    routes,
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); }
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("public chat rejects malformed tokens without querying the database", async () => {
  const app = createApp();
  let queries = 0;
  registerLiveChatRoutes(app, {
    pool: { query: async () => { queries += 1; throw new Error("unexpected query"); } },
    crypto: require("node:crypto"),
    requirePermission: () => (_req, _res, next) => next(),
    allowLiveChat: () => true,
    liveChatFirstReply: () => "Hoi"
  });
  const res = response();
  await app.routes.get("GET /api/chat/conversations/:token/messages")({
    params: { token: "invalid" }
  }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(queries, 0);
});

test("public chat rate-limits conversation creation", async () => {
  const app = createApp();
  registerLiveChatRoutes(app, {
    pool: { query: async () => { throw new Error("unexpected query"); } },
    crypto: require("node:crypto"),
    requirePermission: () => (_req, _res, next) => next(),
    allowLiveChat: () => false,
    liveChatFirstReply: () => "Hoi"
  });
  const res = response();
  await app.routes.get("POST /api/chat/conversations")({
    ip: "127.0.0.1",
    body: { message: "Hoi" }
  }, res);
  assert.equal(res.statusCode, 429);
});
