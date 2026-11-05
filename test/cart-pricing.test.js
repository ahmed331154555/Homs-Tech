"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { priceProductFromCatalog } = require("../utils/cart-pricing");

test("cart pricing rejects stale or invalid catalog indexes", () => {
  const result = priceProductFromCatalog({ phones: [{ name: "iPhone", price: 100 }] }, { type: "phone", id: "4" });
  assert.match(result.error, /verouderd/);
});

test("cart pricing rejects unavailable products", () => {
  const result = priceProductFromCatalog({ phones: [{ name: "iPhone", price: 100, active: false }] }, { type: "phone", id: 0 });
  assert.match(result.error, /niet meer beschikbaar/);
});

test("cart pricing calculates trusted base and selected option prices", () => {
  const data = {
    phones: [{
      name: "iPhone 13",
      brand: "Apple",
      price: 200,
      storageOptions: [{ label: "256 GB", priceDelta: 25 }],
      colorOptions: [{ label: "Black", priceDelta: 0 }],
      batteryOptions: [{ label: "Nieuw (100%)" }],
      vatOptions: [{ label: "Met BTW" }],
      tradeInOptions: [{ label: "Extra", priceDelta: 5 }]
    }]
  };
  const result = priceProductFromCatalog(data, {
    type: "phone",
    id: 0,
    qty: 2,
    options: {
      storage: "256 GB",
      color: "Black",
      battery: "Nieuw (100%)",
      vat: "Met BTW",
      tradeIn: "Extra"
    }
  });
  assert.equal(result.item.unitPrice, 270);
  assert.equal(result.item.qty, 2);
  assert.equal(result.item.name, "iPhone 13");
  assert.equal(result.item.brand, "Apple");
});

test("cart pricing uses the selected condition base price", () => {
  const result = priceProductFromCatalog({
    phones: [{
      name: "Phone",
      price: 999,
      conditionOptions: [{ label: "Licht gebruikt", basePrice: 150 }]
    }]
  }, {
    type: "phone",
    id: 0,
    options: { condition: "Licht gebruikt" }
  });
  assert.equal(result.item.unitPrice, 150);
});

test("variant pricing requires an exact active combination and respects stock", () => {
  const product = {
    name: "iPhone 15",
    pricingMode: "variant",
    conditionOptions: [{ label: "Nieuw" }],
    colorOptions: [{ label: "Black" }],
    storageOptions: [{ label: "128 GB" }],
    variantPrices: [
      { condition: "Nieuw", color: "Black", storage: "128 GB", price: 700, stock: 2, active: true },
      { condition: "Nieuw", color: "Blue", storage: "128 GB", price: 710, stock: 5, active: false }
    ]
  };
  const ok = priceProductFromCatalog({ phones: [product] }, {
    type: "phone", id: 0, qty: 2,
    options: { condition: "Nieuw", color: "Black", storage: "128 GB" }
  });
  assert.equal(ok.item.unitPrice, 700);
  const tooMany = priceProductFromCatalog({ phones: [product] }, {
    type: "phone", id: 0, qty: 3,
    options: { condition: "Nieuw", color: "Black", storage: "128 GB" }
  });
  assert.match(tooMany.error, /onvoldoende voorraad/);
});

test("cart pricing rejects options not present in the trusted catalog", () => {
  const result = priceProductFromCatalog({
    phones: [{ name: "Phone", price: 100, colorOptions: [{ label: "Black" }] }]
  }, { type: "phone", id: 0, options: { color: "Gold" } });
  assert.match(result.error, /niet geldig of niet beschikbaar/);
});

test("cart pricing validates custom option availability and stock", () => {
  const product = {
    name: "Phone",
    price: 100,
    optionGroups: [{ options: [{ label: "Case", priceDelta: 10, stock: 1 }] }]
  };
  const ok = priceProductFromCatalog({ phones: [product] }, {
    type: "phone", id: 0, options: { custom: { "optionGroups:0": "Case" } }
  });
  assert.equal(ok.item.unitPrice, 110);
  const unavailable = priceProductFromCatalog({ phones: [product] }, {
    type: "phone", id: 0, options: { custom: { "optionGroups:0": "Other" } }
  });
  assert.match(unavailable.error, /niet meer beschikbaar/);
  const noStock = priceProductFromCatalog({
    phones: [{ ...product, optionGroups: [{ options: [{ label: "Case", stock: 0 }] }] }]
  }, { type: "phone", id: 0, options: { custom: { "optionGroups:0": "Case" } } });
  assert.match(noStock.error, /niet op voorraad/);
});

test("cart pricing rejects quantities above standard product stock", () => {
  const result = priceProductFromCatalog({ phones: [{ name: "Phone", price: 100, stock: 2 }] }, {
    type: "phone", id: 0, qty: 3
  });
  assert.match(result.error, /onvoldoende voorraad/);
});

test("cart pricing checks custom option stock against requested quantity", () => {
  const result = priceProductFromCatalog({
    phones: [{ name: "Phone", price: 100, optionGroups: [{ options: [{ label: "Case", stock: 2 }] }] }]
  }, { type: "phone", id: 0, qty: 3, options: { custom: { "optionGroups:0": "Case" } } });
  assert.match(result.error, /momenteel niet op voorraad/);
});

test("cart pricing rejects invalid quantities and non-positive prices", () => {
  const invalidQty = priceProductFromCatalog({ phones: [{ name: "Phone", price: 100 }] }, {
    type: "phone", id: 0, qty: 0
  });
  assert.match(invalidQty.error, /geldige hoeveelheid/);
  const invalidPrice = priceProductFromCatalog({ phones: [{ name: "Phone", price: 0 }] }, {
    type: "phone", id: 0
  });
  assert.match(invalidPrice.error, /geen geldige verkoopprijs/);
});

test("cart pricing rejects legacy second-hand cart items", () => {
  const result = priceProductFromCatalog({ phones: [], shopProducts: [] }, { type: "used", id: 0 });
  assert.equal(result.error, "Tweedehands telefoons zijn niet meer beschikbaar.");
});
