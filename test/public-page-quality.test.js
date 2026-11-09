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
    const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
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

test("account and payment pages are excluded from search indexing", () => {
  for (const page of ["account.html", "payment.html"]) {
    assert.match(readPage(page), /<meta\b[^>]*name=["']robots["'][^>]*content=["']noindex,nofollow["']/i, page + " should not be indexed");
  }
});

test("contact page has a canonical URL", () => {
  assert.match(readPage("contact.html"), /<link\b[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/homs-tech\.nl\/contact\.html["']/i);
});


test("global navigation is grouped into clear customer journeys", () => {
  const nav = fs.readFileSync(path.join(root, "assets/homs-global-nav.js"), "utf8");
  for (const label of ["Start", "Winkel", "Service", "Account"]) assert.ok(nav.includes("label:'" + label + "'"), "missing navigation group " + label);
  for (const page of ["contact.html", "devices.html", "shop.html", "repair.html", "prices.html", "uw-toestel-verkopen.html", "cart.html", "account.html"]) {
    assert.ok(nav.includes("'" + page + "'"), "missing navigation destination " + page);
  }
});

test("sitemap contains only existing, public canonical pages", () => {
  const xml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const urls = [...xml.matchAll(/<loc>https:\/\/homs-tech\.nl\/([^<]*)<\/loc>/g)].map(match => match[1]);
  assert.ok(urls.includes("shop.html"));
  assert.ok(urls.includes("contact.html"));
  assert.ok(!urls.includes("used.html"), "removed page must not stay in sitemap");
  assert.ok(!urls.includes("product.html"), "dynamic product template is not a standalone canonical page");
  for (const url of urls) {
    const page = url || "index.html";
    assert.ok(fs.existsSync(path.join(root, page)), "sitemap points to missing page " + page);
  }
});

test("robots.txt excludes admin, API and transactional response pages", () => {
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  for (const route of ["/admin/", "/api/", "/checkout.html", "/cart.html", "/payment.html", "/buyback-response.html", "/trade-in-response.html"]) {
    assert.ok(robots.includes("Disallow: " + route), "robots.txt should exclude " + route);
  }
  assert.match(robots, /Sitemap:\s+https:\/\/homs-tech\.nl\/sitemap\.xml/);
});

test("product metadata updates dynamically for the selected product", () => {
  const html = readPage("product.html");
  assert.match(html, /function updateProductMetadata\(product\)/);
  assert.match(html, /productCanonical/);
  assert.match(html, /canonical\.searchParams\.set\("id",String\(currentProductId\)\)/);
  assert.match(html, /updateProductMetadata\(product\)/);
});

test("shop and product SEO head markup contains no escaped newline text", () => {
  for (const page of ["shop.html", "product.html"]) {
    const head = readPage(page).split("</head>")[0];
    assert.ok(!head.includes("\\n<meta"), page + " contains a literal escaped newline in its head");
  }
});
