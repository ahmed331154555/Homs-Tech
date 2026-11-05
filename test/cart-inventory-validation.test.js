"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCartInventoryQuantities } = require("../utils/cart-inventory-validation");

test("aggregate validation rejects duplicate cart lines exceeding standard product stock", () => {
  const catalog = { phones: [{ name: "Phone", stock: 2 }] };
  const items = [{ type: "phone", id: 0, qty: 1 }, { type: "phone", id: 0, qty: 2 }];
  assert.match(validateCartInventoryQuantities(catalog, items), /totale hoeveelheid/i);
});

test("aggregate validation allows duplicate cart lines within standard product stock", () => {
  const catalog = { phones: [{ name: "Phone", stock: 3 }] };
  const items = [{ type: "phone", id: 0, qty: 1 }, { type: "phone", id: 0, qty: 2 }];
  assert.equal(validateCartInventoryQuantities(catalog, items), null);
});

test("aggregate validation totals demand for the same selected variant", () => {
  const catalog = { phones: [{ pricingMode: "variant", variantPrices: [
    { condition: "New", color: "Black", storage: "128 GB", stock: 2 }
  ] }] };
  const items = [
    { type: "phone", id: 0, qty: 1, options: { condition: "New", color: "Black", storage: "128 GB" } },
    { type: "phone", id: 0, qty: 2, options: { condition: "New", color: "Black", storage: "128 GB" } }
  ];
  assert.match(validateCartInventoryQuantities(catalog, items), /totale hoeveelheid/i);
});

test("aggregate validation totals demand for the same Shop variant", () => {
  const catalog = { shopProducts: [{ id: "screen-1", variants: [
    { id: "oled", sku: "OLED-1", quality: "OLED", stock: "2", active: true }
  ] }] };
  const items = [
    { type: "shop", id: "screen-1", variantId: "oled", qty: 1 },
    { type: "shop", id: "screen-1", variantId: "oled", qty: 2 }
  ];
  assert.match(validateCartInventoryQuantities(catalog, items), /totale hoeveelheid/i);
});

test("aggregate validation totals demand for a repeated custom option", () => {
  const catalog = { phones: [{ name: "Phone", stock: 10, optionGroups: [
    { options: [{ label: "Case", stock: 2 }] }
  ] }] };
  const items = [
    { type: "phone", id: 0, qty: 1, options: { custom: { "optionGroups:0": "Case" } } },
    { type: "phone", id: 0, qty: 2, options: { custom: { "optionGroups:0": "Case" } } }
  ];
  assert.match(validateCartInventoryQuantities(catalog, items), /onvoldoende|totale hoeveelheid/i);
});

test("aggregate validation does not confuse separate Shop variants", () => {
  const catalog = { shopProducts: [{ id: "screen-1", variants: [
    { id: "lcd", sku: "LCD-1", quality: "LCD", stock: "1", active: true },
    { id: "oled", sku: "OLED-1", quality: "OLED", stock: "1", active: true }
  ] }] };
  const items = [
    { type: "shop", id: "screen-1", variantId: "lcd", qty: 1 },
    { type: "shop", id: "screen-1", variantId: "oled", qty: 1 }
  ];
  assert.equal(validateCartInventoryQuantities(catalog, items), null);
});

test("aggregate validation treats phone and device aliases as the same stock item", () => {
  const catalog = { phones: [{ name: "Phone", stock: 2 }] };
  const items = [
    { type: "phone", id: 0, qty: 1 },
    { type: "device", id: 0, qty: 2 }
  ];
  assert.match(validateCartInventoryQuantities(catalog, items), /totale hoeveelheid/i);
});

test("aggregate validation rejects legacy second-hand cart lines", () => {
  const catalog = { usedPhones: [{ name: "Legacy phone", stock: 5 }] };
  const items = [{ type: "used", id: 0, qty: 1 }];
  assert.equal(
    validateCartInventoryQuantities(catalog, items),
    "Tweedehands telefoons zijn niet meer beschikbaar."
  );
});
