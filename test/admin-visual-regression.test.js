"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("admin visual system keeps its brand tokens and consistent focus treatment", () => {
  const css = read("assets/homs-admin.css");
  assert.match(css, /--ht-navy:\s*#071d2d/i);
  assert.match(css, /--ht-blue:\s*#2563eb/i);
  assert.match(css, /--ht-shadow-card:/);
  assert.match(css, /--ht-focus:/);
  assert.match(css, /#dashboard input:focus[\s\S]*?box-shadow:var\(--ht-focus\)/);
});

test("admin layout has desktop and small-screen responsive safeguards", () => {
  const css = read("assets/homs-admin.css");
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*420px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /#dashboard \.orders-toolbar/);
  assert.match(css, /#dashboard \.order-card/);
});

test("admin page references the current stylesheet version", () => {
  const html = read("admin/index.html");
  assert.match(html, /homs-admin\.css\?v=20261109-cleanup3/);
});
