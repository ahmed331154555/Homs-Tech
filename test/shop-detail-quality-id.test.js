"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("shop page uses unique IDs for the catalog filter and product-detail quality selector", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "shop.html"), "utf8");
  const ids = [...html.matchAll(/\\bid=["']([^"']+)["']/g)].map(([, id]) => id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

  assert.deepEqual(duplicates, [], "Shop page must not contain duplicate static IDs");
  assert.match(html, /<select id="shopQuality"/, "Catalog quality filter must keep its own ID");
  assert.match(
    html,
    /<label for="shopDetailQuality"[^>]*>Kies kwaliteit<\\/label><select id="shopDetailQuality"/,
    "Product detail quality selector must use a separate, correctly linked ID",
  );
});
