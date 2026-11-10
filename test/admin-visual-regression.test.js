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
  assert.match(html, /homs-admin\.css\?v=20261110-admin-polish3/);
});


test("orders and inkoop workspace keeps mobile actions accessible", () => {
  const css = read("assets/homs-admin.css");
  assert.match(css, /#page-buyback-orders \.ht-inkoop-detail-foot\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /#page-buyback-orders \.ht-inkoop-toolbar/);
  assert.match(css, /#page-phone-orders \.ht-phone-status-chip\.is-shipped/);
  assert.match(css, /@media\s*\(max-width:\s*560px\)[\s\S]*?#page-phone-orders \.ht-phone-sale-head\{display:none\}/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("admin HTML uses matching versioned CSS and JavaScript assets", () => {
  const html = read("admin/index.html");
  assert.match(html, /homs-admin\.css\?v=20261110-admin-polish3/);
  assert.match(html, /homs-admin\.js\?v=20261110-admin-polish3/);
});


test("admin login and dashboard expose keyboard and assistive-technology labels", () => {
  const html = read("admin/index.html");
  const css = read("assets/homs-admin.css");
  assert.match(html, /class="ht-admin-skip-link" href="#dashboard"/);
  assert.match(html, /id="dashboard"[^>]*role="main"[^>]*tabindex="-1"/);
  assert.match(html, /<label for="username">/);
  assert.match(html, /<label for="password">/);
  assert.match(html, /id="loginStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /\.ht-admin-skip-link:focus/);
});

test("admin JavaScript has no duplicate top-level function declarations", () => {
  const js = read("assets/homs-admin.js");
  const names = [...js.matchAll(/^\\s*(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*\\(/gm)].map(match => match[1]);
  assert.equal(new Set(names).size, names.length, "duplicate top-level function declaration detected");
});

test("admin stylesheet has balanced rule braces", () => {
  const css = read("assets/homs-admin.css");
  let depth = 0;
  for (const char of css) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    assert.ok(depth >= 0, "unexpected closing brace in stylesheet");
  }
  assert.equal(depth, 0, "unclosed CSS rule");
});


test("admin navigation announces the currently selected page", () => {
  const js = read("assets/homs-admin.js");
  assert.match(js, /b\.setAttribute\("aria-current","page"\)/);
  assert.match(js, /b\.removeAttribute\("aria-current"\)/);
});
