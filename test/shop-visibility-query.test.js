"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");

test("shop visibility routes share one SQL definition", () => {
  assert.equal((server.match(/const SHOP_ENABLED_SQL =/g) || []).length, 1);
  assert.equal((server.match(/SHOP_ENABLED_SQL,/g) || []).length, 3);
  assert.doesNotMatch(server, /SELECT COALESCE\(\(data->>'shopPageEnabled'\)::boolean, TRUE\) AS enabled FROM site_settings WHERE id = 1/);
});
