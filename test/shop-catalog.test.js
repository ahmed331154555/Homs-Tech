"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { saveShopCatalog } = require("../utils/shop-catalog");

test("saveShopCatalog updates only the Shop JSON key and returns saved products", async () => {
  const products = [
    { id: "HT-001", name: "iPhone case", price: 12.5, images: ["case.webp"] },
    { id: "HT-002", name: "USB-C cable", price: 8 }
  ];
  let captured;
  const queryWithConnectionRetry = async (...args) => {
    captured = args;
    return { rows: [{ products }] };
  };

  const saved = await saveShopCatalog(queryWithConnectionRetry, products);

  assert.deepEqual(saved, products);
  assert.match(captured[0], /jsonb_set\(data, '\{shopProducts\}'/);
  assert.match(captured[0], /WHERE id = 1 RETURNING data->'shopProducts'/);
  assert.deepEqual(captured[1], [JSON.stringify(products)]);
  assert.equal(captured[2], 4);
});

test("saveShopCatalog returns an empty list when the database has no returned catalog", async () => {
  const saved = await saveShopCatalog(async () => ({ rows: [] }), []);
  assert.deepEqual(saved, []);
});
