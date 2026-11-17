"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_BENEFITS,
  DEFAULT_BENEFIT_ICONS,
  normalizeBenefitsStrip,
  registerBenefitsStripRoutes,
} = require("../routes/benefits-strip");

function harness(queryWithConnectionRetry = async () => ({ rows: [] })) {
  const routes = new Map();
  const permissions = [];
  const app = {
    get(path, ...handlers) {
      routes.set("GET " + path, handlers.at(-1));
    },
    put(path, ...handlers) {
      routes.set("PUT " + path, handlers.at(-1));
    },
  };
  const requirePermission = (permission) => {
    permissions.push(permission);
    return (_req, _res, next) => next();
  };
  registerBenefitsStripRoutes(app, {
    requirePermission,
    queryWithConnectionRetry,
  });
  return { routes, permissions };
}

function response() {
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
    },
  };
}

test("benefits strip normalizes text, colors, typography and movement safely", () => {
  const settings = normalizeBenefitsStrip({
    items: ["  Snelle service ", "", "B".repeat(120)],
    background: "red",
    textColor: "#123456",
    accentColor: "#abcdef",
    speed: 900,
    direction: "invalid",
    mode: "invalid",
    fontSize: 40,
    fontWeight: "999",
    fontStyle: "script",
    height: 2,
  });
  assert.deepEqual(settings, {
    enabled: true,
    items: ["Snelle service", "B".repeat(100)],
    icons: DEFAULT_BENEFIT_ICONS,
    background: "#ffffff",
    textColor: "#123456",
    accentColor: "#abcdef",
    speed: 500,
    direction: "rtl",
    mode: "scroll",
    fontSize: 24,
    fontWeight: "700",
    fontStyle: "normal",
    height: 48,
  });
});

test("benefits strip defaults match the requested homepage labels", () => {
  const settings = normalizeBenefitsStrip(null);
  assert.deepEqual(settings.items, DEFAULT_BENEFITS);
  assert.deepEqual(settings.icons, DEFAULT_BENEFIT_ICONS);
  assert.equal(settings.enabled, true);
  assert.equal(settings.mode, "scroll");
});

test("public benefits endpoint returns normalized no-store settings", async () => {
  const { routes } = harness(async () => ({
    rows: [{ settings: { enabled: false, items: ["Test"] } }],
  }));
  const res = response();
  await routes.get("GET /api/benefits-strip")({}, res);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.settings.enabled, false);
  assert.deepEqual(res.body.settings.items, ["Test"]);
});

test("admin benefits endpoints require site.save permission", () => {
  const { permissions } = harness();
  assert.deepEqual(permissions, ["site.save", "site.save"]);
});

test("admin benefits save stores normalized settings and handles missing site settings", async () => {
  let args;
  const { routes } = harness(async (...values) => {
    args = values;
    return { rows: [{ settings: { enabled: false, items: ["Saved"] } }] };
  });
  const res = response();
  await routes.get("PUT /api/admin/benefits-strip")(
    { body: { enabled: false, items: ["Saved"] } },
    res,
  );
  assert.equal(res.body.success, true);
  assert.deepEqual(
    JSON.parse(args[1]),
    normalizeBenefitsStrip({ enabled: false, items: ["Saved"] }),
  );
  assert.equal(args[2], 4);

  const missing = harness(async () => ({ rows: [] }));
  const missingRes = response();
  await missing.routes.get("PUT /api/admin/benefits-strip")(
    { body: {} },
    missingRes,
  );
  assert.equal(missingRes.statusCode, 404);
});

test("benefits strip preserves custom emoji and symbol choices", () => {
  const settings = normalizeBenefitsStrip({
    items: ["Reparatie", "Verkoop"],
    icons: ["🔧", "📱"],
  });
  assert.deepEqual(settings.icons, ["🔧", "📱"]);
});
