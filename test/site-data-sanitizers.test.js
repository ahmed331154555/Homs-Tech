"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizePublicSiteData,
  sanitizeHomepageSiteData
} = require("../utils/site-data-sanitizers");

test("sanitizePublicSiteData removes retired importer data without mutating input", () => {
  const input = {
    phone: "123",
    gsmImport: { secret: true },
    gsmServices: [{ name: "retired" }],
    homepage: { title: "Home", gsm: { private: true } }
  };
  const output = sanitizePublicSiteData(input);
  assert.deepEqual(output, {
    phone: "123",
    homepage: { title: "Home" }
  });
  assert.equal(input.gsmImport.secret, true);
  assert.equal(input.homepage.gsm.private, true);
  assert.notEqual(output.homepage, input.homepage);
});

test("sanitizeHomepageSiteData keeps only approved top-level fields", () => {
  const output = sanitizeHomepageSiteData({
    phone: "123",
    whatsapp: "456",
    homepage: { title: "Home" },
    deviceCategories: ["Phones"],
    phones: [],
    services: [],
    why: [],
    buybackCatalog: [{ private: true }],
    adminSettings: { private: true }
  });
  assert.deepEqual(Object.keys(output).sort(), [
    "deviceCategories", "homepage", "phone", "phones", "services", "whatsapp", "why"
  ]);
  assert.equal(output.buybackCatalog, undefined);
  assert.equal(output.adminSettings, undefined);
});

test("sanitizeHomepageSiteData keeps the final fifteen phones and original indices", () => {
  const phones = Array.from({ length: 16 }, (_, index) => ({
    name: "Phone " + index,
    brand: "Brand",
    internalCost: 99,
    images: ["first-" + index, "second-" + index]
  }));
  const output = sanitizeHomepageSiteData({ phones });
  assert.equal(output.phones.length, 15);
  assert.equal(output.phones[0]._index, 1);
  assert.equal(output.phones[14]._index, 15);
  assert.equal(output.phones[0].name, "Phone 1");
  assert.equal(output.phones[0].internalCost, undefined);
  assert.deepEqual(output.phones[0].images, ["first-1"]);
  assert.equal(phones[1].images.length, 2);
});

test("sanitizeHomepageSiteData compacts variants and drops inactive rows", () => {
  const output = sanitizeHomepageSiteData({
    phones: [{
      name: "iPhone",
      variantPrices: [
        { storage: "128GB", color: "Black", price: 100, active: true, internalCost: 50 },
        { storage: "256GB", color: "Blue", price: 120, active: false, internalCost: 60 }
      ],
      colorOptions: [{ label: "Black", image: "black.webp", cost: 10 }],
      colorGalleryImages: { Black: ["one.webp", "two.webp"], Blue: [] }
    }]
  });
  assert.deepEqual(output.phones[0].variantPrices, [
    { storage: "128GB", color: "Black", price: 100, active: true }
  ]);
  assert.deepEqual(output.phones[0].colorOptions, [{ label: "Black", image: "black.webp" }]);
  assert.deepEqual(output.phones[0].colorGalleryImages, { Black: ["one.webp"] });
});

test("sanitizePublicSiteData recursively removes private costs and credentials while keeping sale prices", () => {
  const input = {
    phones: [{
      name: "iPhone 15",
      price: 499,
      supplierCost: 250,
      purchasePrice: 220,
      internalCost: 200,
      margin: 279,
      profit: 99,
      variantPrices: [{ color: "Black", price: 499, supplierCost: 210 }]
    }],
    buybackCatalog: [{
      name: "iPhone 12",
      buyPrice: 100,
      inkoopprijs: 70,
      publicOffer: 120
    }],
    paymentSettings: {
      mollieApiKey: "private-key",
      paypalClientSecret: "private-secret",
      webhookSecret: "private-webhook"
    },
    homepage: { title: "Home", privateNote: "internal" }
  };
  const output = sanitizePublicSiteData(input);
  assert.equal(output.phones[0].price, 499);
  assert.equal(output.phones[0].supplierCost, undefined);
  assert.equal(output.phones[0].purchasePrice, undefined);
  assert.equal(output.phones[0].internalCost, undefined);
  assert.equal(output.phones[0].variantPrices[0].supplierCost, undefined);
  assert.equal(output.buybackCatalog[0].publicOffer, 120);
  assert.equal(output.buybackCatalog[0].buyPrice, undefined);
  assert.equal(output.buybackCatalog[0].inkoopprijs, undefined);
  assert.equal(output.paymentSettings.mollieApiKey, undefined);
  assert.equal(output.paymentSettings.paypalClientSecret, undefined);
  assert.equal(output.paymentSettings.webhookSecret, undefined);
  assert.equal(output.homepage.privateNote, undefined);
  assert.equal(input.phones[0].supplierCost, 250);
});
