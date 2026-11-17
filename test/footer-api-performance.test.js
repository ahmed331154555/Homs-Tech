"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const footer = fs.readFileSync(path.join(root, "assets", "homs-site-footer.js"), "utf8");

test("shared footer requests its compact settings view instead of the full site document", () => {
  assert.match(footer, /fetch\(["']\/api\/site\?view=footer["']/);
  assert.doesNotMatch(footer, /fetch\(["']\/api\/site["']/);
});

test("footer API selects only footer and contact fields", () => {
  const start = server.indexOf('if(view==="footer"){');
  const end = server.indexOf('if(view==="repair"){', start);
  assert.notEqual(start, -1, "compact footer view must exist");
  assert.ok(end > start, "footer view must be placed before other site views");
  const route = server.slice(start, end);
  for (const field of ["data->'homepage'->'footer'", "data->>'areas'", "data->>'phone'", "data->>'whatsapp'"]) {
    assert.ok(route.includes(field), "footer view should select " + field);
  }
  assert.doesNotMatch(route, /SELECT\s+data\s+FROM\s+site_settings/i);
});
