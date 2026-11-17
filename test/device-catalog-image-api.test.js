"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("device image endpoint uses a parameterized active-phone lookup", () => {
  const start = serverSource.indexOf('app.get("/api/devices/image/:id"');
  const end = serverSource.indexOf('app.get("/api/shop/image/:id"', start);
  assert.ok(start >= 0 && end > start, "device image route should be registered");
  const route = serverSource.slice(start, end);
  assert.match(route, /jsonb_array_elements/);
  assert.match(route, /item\.phone->>'id'\s*=\s*\$1/);
  assert.match(route, /colorGalleryImages/);
  assert.match(route, /colorImages/);
  assert.match(route, /colorOptions/);
  assert.match(route, /Buffer\.from\(match\[2\],\s*"base64"\)/);
  assert.match(route, /5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(route, /X-Content-Type-Options/);
  assert.match(route, /max-age=60/);
});
