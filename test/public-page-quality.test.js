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

test("all public page inline stylesheets have balanced CSS blocks", () => {
  const pages = fs.readdirSync(root).filter(name => name.endsWith(".html"));
  assert.ok(pages.length >= 10, "expected the public HTML pages to be present");
  let checkedBlocks = 0;
  for (const page of pages) {
    const html = readPage(page);
    const blocks = [...html.matchAll(/<style\\b[^>]*>([\\s\\S]*?)<\\/style>/gi)];
    for (let index = 0; index < blocks.length; index += 1) {
      checkedBlocks += 1;
      assert.equal(cssBraceBalance(blocks[index][1]), 0, page + " style block " + (index + 1) + " has unbalanced braces");
    }
  }
  assert.ok(checkedBlocks > 0, "expected inline CSS blocks to be checked");
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
