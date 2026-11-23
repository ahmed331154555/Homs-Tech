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
  assert.match(
    css,
    /\.primary,\s*\.btn\.primary,\s*\.toolbar button\.active\s*\{/,
  );
  assert.doesNotMatch(css, /\.btn:not\(\.secondary\)/);
});

test("standalone admin keeps secondary controls visually distinct", () => {
  assert.match(css, /\.secondary,\s*\.toolbar button,\s*\.action\s*\{/);
  assert.match(
    css,
    /\.secondary:hover,\s*\.toolbar button:hover,\s*\.action:hover\s*\{/,
  );
});


test("compact icon and switch controls are exempt from the standard action height", () => {
  assert.match(
    fs.readFileSync(path.resolve(__dirname, "../assets/tactile-ui.css"), "utf8"),
    /\.gallery-arrow[\s\S]*?\.admin-menu-toggle[\s\S]*?\[role="switch"\][\s\S]*?min-height:\s*0/,
  );
});
