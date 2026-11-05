"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  preserveExistingProductPhotos,
  preserveExistingCatalogPhotos,
  preserveExistingBuybackPhotos
} = require("../utils/catalog-photo-preservation");

test("preserves existing product photo fields when an edit submits them empty", () => {
  const existing = {
    images: ["front.webp"],
    colorImages: { black: ["black-front.webp"] },
    description: "Old description"
  };
  const incoming = { images: [], colorImages: {}, description: "Updated description" };

  const result = preserveExistingProductPhotos(existing, incoming);

  assert.deepEqual(result.images, ["front.webp"]);
  assert.deepEqual(result.colorImages, { black: ["black-front.webp"] });
  assert.equal(result.description, "Updated description");
});

test("does not overwrite photos when incoming product already contains images", () => {
  const existing = { images: ["old.webp"] };
  const incoming = { images: ["new.webp"] };

  preserveExistingProductPhotos(existing, incoming);

  assert.deepEqual(incoming.images, ["new.webp"]);
});

test("matches catalog items by id and preserves photos for matching phones", () => {
  const existing = {
    phones: [{ id: "phone-1", images: ["phone.webp"] }],
    usedPhones: [{ name: "Used iPhone", images: ["used.webp"] }]
  };
  const incoming = {
    phones: [{ id: "phone-1", images: [] }],
    usedPhones: [{ name: "Used iPhone", images: [] }]
  };

  const result = preserveExistingCatalogPhotos(existing, incoming);

  assert.deepEqual(result.phones[0].images, ["phone.webp"]);
  assert.deepEqual(result.usedPhones[0].images, ["used.webp"]);
});

test("preserves buyback brand and phone images without replacing submitted images", () => {
  const existing = {
    buybackCatalog: [{ id: "brand-1", name: "Apple", image: "apple.webp" }],
    buybackPhones: [{ id: "phone-1", name: "iPhone 14", brand: "Apple", image: "iphone.webp" }]
  };
  const incoming = {
    buybackCatalog: [{ id: "brand-1", name: "Apple", image: "" }],
    buybackPhones: [{ id: "phone-1", name: "iPhone 14", brand: "Apple", image: "" }]
  };

  const result = preserveExistingBuybackPhotos(existing, incoming);

  assert.equal(result.buybackCatalog[0].image, "apple.webp");
  assert.equal(result.buybackPhones[0].image, "iphone.webp");
});

test("does not replace explicitly submitted buyback images", () => {
  const existing = {
    buybackCatalog: [{ name: "Apple", image: "old.webp" }],
    buybackPhones: [{ name: "iPhone 14", brand: "Apple", image: "old-phone.webp" }]
  };
  const incoming = {
    buybackCatalog: [{ name: "Apple", image: "new.webp" }],
    buybackPhones: [{ name: "iPhone 14", brand: "Apple", image: "new-phone.webp" }]
  };

  preserveExistingBuybackPhotos(existing, incoming);

  assert.equal(incoming.buybackCatalog[0].image, "new.webp");
  assert.equal(incoming.buybackPhones[0].image, "new-phone.webp");
});
