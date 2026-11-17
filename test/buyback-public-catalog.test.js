"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBuybackModelName,
  matchesBuybackModel,
  buildPublicBuybackCatalogPayload
} = require("../utils/buyback-public-catalog");

test("buyback model matching normalizes Apple and storage naming differences", () => {
  assert.equal(normalizeBuybackModelName("Apple iPhone 16 Pro Max 256GB"), "pro max");
  assert.equal(matchesBuybackModel(
    { name: "16 Pro Max" },
    { name: "Apple iPhone 16 Pro Max 256GB" }
  ), true);
});

test("public buyback payload includes only active buyback phones and matching sales phone specs", () => {
  const payload = buildPublicBuybackCatalogPayload({
    buybackCatalog: [{ name: "Apple", types: [] }],
    buybackPhones: [
      { id: 1, name: "iPhone 16 Pro", active: true, image: "buyback.webp", supplierCost: 100 },
      { id: 2, name: "iPhone 15 Pro", active: false }
    ],
    salesPhones: [
      { name: "iPhone 16 Pro 128GB", image: "sales.webp", images: ["front.webp", "back.webp"], processor: "A18", supplierCost: 900 },
      { name: "iPhone 14", image: "unrelated.webp" }
    ]
  });

  assert.deepEqual(payload.buybackPhones.map(phone => phone.id), [1]);
  assert.equal(payload.salesPhones.length, 1);
  assert.equal(payload.salesPhones[0].name, "iPhone 16 Pro 128GB");
  assert.equal(payload.salesPhones[0].image, "sales.webp");
  assert.deepEqual(payload.salesPhones[0].images, ["front.webp"]);
  assert.equal(payload.salesPhones[0].processor, "A18");
  assert.equal(payload.salesPhones[0].supplierCost, undefined);
  assert.equal(payload.buybackPhones[0].supplierCost, undefined);
});

test("public buyback payload safely handles missing catalogs", () => {
  assert.deepEqual(buildPublicBuybackCatalogPayload({}), {
    buybackCatalog: [],
    buybackPhones: [],
    salesPhones: []
  });
});
