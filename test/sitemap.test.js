"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSitemapUrls, buildSitemapXml } = require("../utils/sitemap");

test("sitemap lists static pages, active phones and active shop products", () => {
  const urls = buildSitemapUrls({
    phones: [{ name: "iPhone 13" }, { name: "Hidden", active: false }, { name: "iPhone 12" }, null],
    shopProducts: [{ id: "a b", active: true }, { id: "off", active: false }, { id: "" }],
    shopEnabled: true,
    hasServices: true,
  });
  assert.ok(urls.includes("https://homs-tech.nl/"));
  assert.ok(urls.includes("https://homs-tech.nl/services.html"));
  assert.ok(urls.includes("https://homs-tech.nl/reviews.html"));
  assert.ok(urls.includes("https://homs-tech.nl/product.html?type=phone&id=0"));
  assert.ok(urls.includes("https://homs-tech.nl/product.html?type=phone&id=2"));
  assert.ok(!urls.includes("https://homs-tech.nl/product.html?type=phone&id=1"));
  assert.ok(urls.includes("https://homs-tech.nl/shop.html?product=a%20b"));
  assert.ok(!urls.some((u) => u.includes("product=off")));
});

test("sitemap hides shop and services when they are switched off", () => {
  const urls = buildSitemapUrls({
    shopProducts: [{ id: "x" }],
    shopEnabled: false,
    hasServices: false,
  });
  assert.ok(!urls.some((u) => u.includes("shop.html")));
  assert.ok(!urls.includes("https://homs-tech.nl/services.html"));
});

test("sitemap XML escapes ampersands", () => {
  const xml = buildSitemapXml({ phones: [{ name: "x" }] });
  assert.match(xml, /type=phone&amp;id=0/);
  assert.match(xml, /^<\?xml/);
});
