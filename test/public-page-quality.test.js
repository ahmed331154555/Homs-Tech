"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const readPage = name => fs.readFileSync(path.join(root, name), "utf8");

function cssBraceBalance(css) {
  // Remove comments and quoted strings so braces in text values do not count.
  const source = css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  let depth = 0;
  for (const char of source) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return depth;
  }
  return depth;
}

test("shop inline stylesheets have balanced CSS blocks", () => {
  const html = readPage("shop.html");
  const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  assert.ok(blocks.length > 0, "shop should contain its page styles");
  for (let index = 0; index < blocks.length; index += 1) {
    assert.equal(cssBraceBalance(blocks[index][1]), 0, "shop style block " + (index + 1) + " has unbalanced braces");
  }
});

test("shop uses the shared HOMS TECH theme and a canonical URL", () => {
  const html = readPage("shop.html");
  assert.match(html, /assets\/homs-tech-modern-true-theme\.css/);
  assert.match(html, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/homs-tech\.nl\/shop\.html["']/i);
});

test("cart and checkout are excluded from search indexing", () => {
  for (const page of ["cart.html", "checkout.html"]) {
    assert.match(readPage(page), /<meta\b[^>]*name=["']robots["'][^>]*content=["']noindex,nofollow["']/i, page + " should not be indexed");
  }
});

test("product page has a useful search description", () => {
  assert.match(readPage("product.html"), /<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']{40,}["']/i);
});
