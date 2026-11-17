"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
const shopVisibilitySql = "SELECT COALESCE((data->>'shopPageEnabled')::boolean, TRUE) AS enabled FROM site_settings WHERE id = 1";

test("shop visibility routes share one valid SQL definition", () => {
  assert.equal((server.match(/const SHOP_ENABLED_SQL =/g) || []).length, 1);
  assert.match(server, new RegExp("const SHOP_ENABLED_SQL = \"" + shopVisibilitySql.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\";"));
  assert.equal((server.match(/SHOP_ENABLED_SQL,/g) || []).length, 3);
  assert.equal((server.match(/SELECT COALESCE\\(\\(data->>'shopPageEnabled'\\)::boolean, TRUE\\) AS enabled FROM site_settings WHERE id = 1/g) || []).length, 1);
  assert.doesNotMatch(server, /const SHOP_ENABLED_SQL = SHOP_ENABLED_SQL;/);
});
