"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
const shopVisibilitySql =
  "SELECT COALESCE((data->>'shopPageEnabled')::boolean, TRUE) AS enabled FROM site_settings WHERE id = 1";

test("shop visibility routes share one valid SQL definition", () => {
  assert.equal((server.match(/const SHOP_ENABLED_SQL =/g) || []).length, 1);
  const definition = server.match(
    /const SHOP_ENABLED_SQL\s*=\s*(["'])(.*?)\1\s*;/,
  );
  assert.ok(definition, "shared Shop visibility SQL should be defined");
  assert.equal(definition[2], shopVisibilitySql);
  assert.equal((server.match(/\bSHOP_ENABLED_SQL\b/g) || []).length - 1, 3);
  assert.equal(server.split(shopVisibilitySql).length - 1, 1);
  assert.doesNotMatch(server, /const SHOP_ENABLED_SQL\s*=\s*SHOP_ENABLED_SQL\s*;/);
});
