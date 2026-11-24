"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readPage(page) {
  return fs.readFileSync(path.join(root, page), "utf8");
}

function findDuplicateIds(html) {
  const ids = [...html.matchAll(/id=["']([^"']+)["']/g)].map(([, id]) => id);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

test("shop page keeps catalog and product-detail quality selectors separate", () => {
  const html = readPage("shop.html");

  assert.deepEqual(
    findDuplicateIds(html),
    [],
    "Shop page must not contain duplicate static IDs",
  );
  assert.ok(
    html.includes('<select id="shopQuality"'),
    "Catalog quality filter must keep its own ID",
  );
  assert.ok(
    html.includes('<label for="shopDetailQuality"'),
    "Product detail label must target its own selector",
  );
  assert.ok(
    html.includes('<select id="shopDetailQuality"'),
    "Product detail quality selector must use a separate ID",
  );
});

test("public pages have unique IDs and valid in-page anchor targets", () => {
  const pages = [
    "index.html",
    "devices.html",
    "prices.html",
    "repair.html",
    "uw-toestel-verkopen.html",
    "contact.html",
    "shop.html",
  ];

  for (const page of pages) {
    const html = readPage(page);
    assert.deepEqual(
      findDuplicateIds(html),
      [],
      page + " must not contain duplicate IDs",
    );

    const ids = new Set(
      [...html.matchAll(/id=["']([^"']+)["']/g)].map(([, id]) => id),
    );
    const anchors = [...html.matchAll(/<a\b[^>]*href=["']#([^"']+)["']/gi)].map(
      ([, id]) => id,
    );
    const missing = [...new Set(anchors.filter((id) => !ids.has(id)))];

    assert.deepEqual(
      missing,
      [],
      page + " contains links to missing in-page targets",
    );
  }
});
