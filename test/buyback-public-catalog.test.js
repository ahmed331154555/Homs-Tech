"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBuybackModelName,
  matchesBuybackModel,
  replaceEmbeddedBuybackImages,
  buildPublicBuybackCatalogPayload
} = require("../utils/buyback-public-catalog");

test("buyback model matching normalizes Apple and storage naming differences", () => {
  assert.equal(normalizeBuybackModelName("Apple iPhone 16 Pro Max 256GB"), "16 pro max");
  assert.equal(matchesBuybackModel(
    { name: "16 Pro Max" },
    { name: "Apple iPhone 16 Pro Max 256GB" }
  ), true);
});

test("public buyback payload includes only active buyback phones and matching sales phone specs", () => {
  const payload = buildPublicBuybackCatalogPayload({
    buybackCatalog: [{ name: "Apple", types: [] }],
    buybackPhones: [
      { id: 1, name: "iPhone 16 Pro", brand: "Apple", deviceType: "Telefoon", active: true, image: "buyback.webp", supplierCost: 100, adminNotes: "not public", unusedGallery: ["huge-image-data"] },
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
  assert.equal(payload.buybackPhones[0].adminNotes, undefined);
  assert.equal(payload.buybackPhones[0].unusedGallery, undefined);
  assert.equal(payload.buybackPhones[0].deviceType, "Telefoon");
});

test("public buyback payload safely handles missing catalogs", () => {
  assert.deepEqual(buildPublicBuybackCatalogPayload({}), {
    buybackCatalog: [],
    buybackPhones: [],
    salesPhones: []
  });
});

test("embedded buyback images become lazy URLs while ordinary image URLs stay unchanged", () => {
  const image = "data:image/webp;base64,QUJD";
  const result = replaceEmbeddedBuybackImages({
    image,
    options: [{ image }],
    external: "https://cdn.example.com/phone.webp"
  }, "phone-1");

  assert.equal(result.image, "/api/buyback/image/phone-1?path=image");
  assert.equal(result.options[0].image, "/api/buyback/image/phone-1?path=options.0.image");
  assert.equal(result.external, "https://cdn.example.com/phone.webp");
});
