"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");

test("static hosting hides server folders and developer notes", () => {
  for (const dir of ["routes", "services", "utils", "scripts", "test", "docs"]) {
    assert.match(server, new RegExp(`"${dir}"`));
  }
  assert.match(server, /privateTopLevel\.has\(segments\[0\]/);
  assert.match(server, /readme-\.\*/);
});

test("static assets get real cache headers", () => {
  assert.match(server, /png\|jpe\?g\|webp\|svg\|gif\|ico\|woff2\?\)\$\/i/);
  assert.doesNotMatch(server, /\/\\\\\.\(\?:css\|js\|png/);
  assert.match(server, /max-age=604800/);
});
