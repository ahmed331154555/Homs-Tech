"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(
  path.join(__dirname, "..", "shop.html"),
  "utf8",
);

test("Shop inline scripts have valid JavaScript syntax", () => {
  const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)];
  assert.ok(scripts.length > 0, "Shop page must contain its catalog script");

  for (const [, source] of scripts) {
    if (source.trim()) new vm.Script(source);
  }
});

test("Shop does not offer variant purchase when stock is missing or malformed", () => {
  assert.ok(
    html.includes("match=raw.match(/^(\\\\d+)$/)"),
    "Variant stock must be a whole-number value, matching server validation",
  );
  assert.ok(
    html.includes("if(stock===null){alert("),
    "Add-to-cart must reject unconfirmed variant stock",
  );
  assert.ok(
    html.includes("button.disabled=stock===0||stock===null;"),
    "The detail purchase button must be disabled for unconfirmed stock",
  );
});
