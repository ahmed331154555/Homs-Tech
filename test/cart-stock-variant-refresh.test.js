"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(
  path.join(__dirname, "..", "cart.html"),
  "utf8",
);

test("cart inline scripts have valid JavaScript syntax", () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, "Cart page must contain its cart script");

  for (const [, source] of scripts) {
    if (source.trim()) new vm.Script(source);
  }
});

test("cart stock refresh does not use product stock for a missing selected variant", () => {
  const start = html.indexOf("async function refreshShopStock");
  const end = html.indexOf("function start()", start);
  assert.notEqual(start, -1, "Shop stock refresh function must exist");
  assert.notEqual(end, -1, "Cart initialization must follow stock refresh");

  const source = html.slice(start, end);
  assert.match(
    source,
    /if\(hasVariantReference && !variant\)/,
    "An unresolved selected variant must be treated as unavailable",
  );
  assert.match(
    source,
    /return \{\.\.\.item,qty:0,unavailable:true\}/,
    "An unresolved selected variant must not remain purchasable",
  );
  assert.match(
    source,
    /variant\?variant\.stock:product\.stock/,
    "Product-level stock is only a fallback for cart lines without a variant",
  );
});
