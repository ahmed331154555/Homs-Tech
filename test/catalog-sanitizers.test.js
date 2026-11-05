"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeDevicesCatalogData,
  sanitizeCartStockData
} = require("../utils/catalog-sanitizers");

test("sanitizeDevicesCatalogData keeps public fields and omits private catalog data", () => {
  const result = sanitizeDevicesCatalogData({
    phone: "0101234567",
    businessName: "HOMS TECH",
    supplierCost: 99,
    phones: [{
      id: 7,
      name: "iPhone 15",
      price: 499,
      supplierCost: 250,
      images: ["front.webp", "", "back.webp"],
      conditionOptions: [
        { active: true, available: true, basePrice: 300, privateNote: "internal" },
        { active: false, available: true, basePrice: 200 },
        { active: true, available: false, basePrice: 100 }
      ],
      variantPrices: [
        { storage: "128GB", color: "Black", price: 499, stock: 2, active: true, cost: 250 },
        { storage: "256GB", color: "Blue", price: 549, active: false }
      ],
      colorGalleryImages: { Black: ["black-1.webp", "black-2.webp"], Blue: [] },
      colorOptions: [{ label: "Black", image: "black.webp", supplierId: 123 }]
    }]
  });

  assert.equal(result.phone, "0101234567");
  assert.equal(result.phones[0].name, "iPhone 15");
  assert.equal("supplierCost" in result, false);
  assert.equal("supplierCost" in result.phones[0], false);
  assert.deepEqual(result.phones[0].images, ["front.webp"]);
  assert.deepEqual(result.phones[0].conditionOptions, [
    { active: true, available: true, basePrice: 300, conditionBasePrice: undefined }
  ]);
  assert.deepEqual(result.phones[0].variantPrices, [
    { storage: "128GB", color: "Black", price: 499, stock: 2, active: true }
  ]);
  assert.deepEqual(result.phones[0].colorGalleryImages, {
    Black: ["black-1.webp"]
  });
  assert.deepEqual(result.phones[0].colorOptions, [
    { label: "Black", image: "black.webp" }
  ]);
});

test("sanitizeDevicesCatalogData handles invalid input and compact device records", () => {
  assert.deepEqual(sanitizeDevicesCatalogData(null), {
    phone: "",
    whatsapp: "",
    businessName: "HOMS TECH",
    tagline: "Telefoonreparatie aan huis"
  });

  assert.deepEqual(sanitizeDevicesCatalogData({ devices: [{ name: "Tablet", brand: "Apple", price: 100, cost: 50 }] }).devices, [
    { name: "Tablet", brand: "Apple", price: 100 }
  ]);
});

test("sanitizeCartStockData exposes stock identifiers without internal product fields", () => {
  assert.deepEqual(sanitizeCartStockData([
    {
      name: "iPhone screen",
      price: 120,
      stock: 4,
      variants: [{ id: 1, sku: "HT-001", quality: "A+", stock: 2, cost: 70 }]
    },
    null
  ]), [
    { stock: 4, variants: [{ id: 1, sku: "HT-001", quality: "A+", stock: 2 }] },
    null
  ]);
  assert.deepEqual(sanitizeCartStockData("invalid"), []);
});

test("device sanitizer keeps only image strings in nested color image maps", () => {
  const output = sanitizeDevicesCatalogData({
    phones: [{
      name: "iPhone",
      images: ["front.webp", { url: "private", supplierCost: 2 }],
      colorImages: {
        Black: "black.webp",
        Blue: { url: "blue.webp", internalCost: 5 }
      },
      colorGalleryImages: {
        Black: ["black-front.webp", { url: "private.webp" }]
      }
    }]
  });
  assert.deepEqual(output.phones[0].images, ["front.webp"]);
  assert.deepEqual(output.phones[0].colorImages, { Black: "black.webp" });
  assert.deepEqual(output.phones[0].colorGalleryImages, { Black: ["black-front.webp"] });
});
