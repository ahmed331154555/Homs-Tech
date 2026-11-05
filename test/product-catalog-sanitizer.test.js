"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeProductCatalogData } = require("../utils/product-catalog-sanitizer");

test("public product catalog keeps storefront fields and strips internal costs recursively", () => {
  const input = {
    phone: "0101234567",
    phones: [{
      id: 3, name: "iPhone 15", price: 499, image: "front.webp",
      supplierCost: 250, purchasePrice: 200, internalNote: "private",
      variantPrices: [{ condition: "New", color: "Black", storage: "128GB", price: 499, stock: 2, supplierCost: 200 }],
      conditionOptions: [{ label: "Nieuw", basePrice: 499, priceDelta: 0, internalCost: 100 }],
      optionGroups: [{ title: "Extra", options: [{ label: "Case", priceDelta: 10, supplierId: "private", cost: 2 }] }],
      specifications: [{ label: "Scherm", value: "6.1 inch", purchasePrice: 50 }]
    }],
    usedPhones: [{ name: "iPhone 12", price: 199, costPrice: 70, images: ["a.webp", "b.webp"] }],
    adminSettings: { secret: "must not be returned" }
  };
  const result = sanitizeProductCatalogData(input);
  assert.equal(result.phones[0].price, 499);
  assert.equal(result.phones[0].variantPrices[0].stock, 2);
  assert.equal(result.phones[0].variantPrices[0].supplierCost, undefined);
  assert.equal(result.phones[0].supplierCost, undefined);
  assert.equal(result.phones[0].conditionOptions[0].basePrice, 499);
  assert.equal(result.phones[0].conditionOptions[0].internalCost, undefined);
  assert.deepEqual(result.phones[0].optionGroups[0].options, [{ label: "Case", priceDelta: 10 }]);
  assert.deepEqual(result.phones[0].specifications, [{ label: "Scherm", value: "6.1 inch" }]);
  assert.equal(result.usedPhones[0].costPrice, undefined);
  assert.equal(result.adminSettings, undefined);
  assert.equal(input.phones[0].supplierCost, 250);
});

test("public product sanitizer safely handles invalid catalog shapes", () => {
  assert.deepEqual(sanitizeProductCatalogData(null), {
    phones: [], usedPhones: [], phone: "", whatsapp: "",
    businessName: "HOMS TECH", siteName: "HOMS TECH",
    tagline: "Telefoonreparatie aan huis"
  });
});
