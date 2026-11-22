"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.resolve(__dirname, "../assets/homs-admin-standalone-premium.css"),
  "utf8",
);

test("standalone admin primary styling targets primary controls only", () => {
  assert.match(css, /\.primary,\.btn\.primary,\.toolbar button\.active\{/);
  assert.doesNotMatch(css, /\.btn:not\(\.secondary\)/);
});

test("standalone admin keeps secondary controls visually distinct", () => {
  assert.match(css, /\.secondary,\.toolbar button,\.action\{/);
  assert.match(css, /\.secondary:hover,\.toolbar button:hover,\.action:hover\{/);
});
