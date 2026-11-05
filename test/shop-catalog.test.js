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

const { findShopProductIndex, resolveShopVariant, priceShopVariant, deductShopVariantInventory } = require("../utils/shop-catalog");

test("resolveShopVariant selects the requested quality instead of the first quality", () => {
  const product = { variants: [
    { id: "v-a", sku: "HT-SCH-100001", quality: "LCD", price: "45", stock: "8", active: true },
    { id: "v-b", sku: "HT-SCH-100002", quality: "OLED", price: "75", stock: "3", active: true }
  ] };
  const result = resolveShopVariant(product, { variantId: "v-b", qty: 2 });
  assert.equal(result.variant.quality, "OLED");
  assert.equal(result.variant.price, "75");
  assert.equal(result.variantIndex, 1);
});

test("resolveShopVariant rejects a stale or inactive selected quality", () => {
  const product = { variants: [
    { id: "v-a", quality: "LCD", active: true },
    { id: "v-b", quality: "OLED", active: false }
  ] };
  assert.match(resolveShopVariant(product, { variantId: "missing" }).error, /niet meer beschikbaar/i);
  assert.match(resolveShopVariant(product, { variantId: "v-b" }).error, /niet meer beschikbaar/i);
});

test("deductShopVariantInventory deducts only the selected variant stock", () => {
  const product = { stock: "8 stuks", variants: [
    { id: "v-a", quality: "LCD", stock: "8", active: true },
    { id: "v-b", quality: "OLED", stock: "3", active: true }
  ] };
  const result = deductShopVariantInventory(product, { variantId: "v-b", qty: 2 });
  assert.equal(result.remaining, 1);
  assert.equal(product.variants[0].stock, "8");
  assert.equal(product.variants[1].stock, "1");
  assert.equal(product.stock, "8 stuks");
});

test("deductShopVariantInventory keeps the legacy product stock synchronized for first variant", () => {
  const product = { stock: "5 stuks", variants: [
    { id: "v-a", quality: "LCD", stock: "5", active: true }
  ] };
  deductShopVariantInventory(product, { variantId: "v-a", qty: 2 });
  assert.equal(product.variants[0].stock, "3");
  assert.equal(product.stock, "3 stuks");
});

test("deductShopVariantInventory rejects insufficient selected variant stock", () => {
  const product = { variants: [{ id: "v-a", quality: "LCD", stock: "1", active: true }] };
  assert.throws(() => deductShopVariantInventory(product, { variantId: "v-a", qty: 2 }), /Insufficient stock/);
  assert.equal(product.variants[0].stock, "1");
});


test("priceShopVariant uses the selected quality price, not the first quality price", () => {
  const product = {
    id: "shop-1",
    name: "iPhone display",
    category: "Schermen",
    price: "45",
    variants: [
      { id: "lcd", quality: "LCD", sku: "HT-SCH-100001", price: "45", stock: "8", active: true },
      { id: "oled", quality: "OLED", sku: "HT-SCH-100002", price: "79,95", stock: "3", active: true }
    ]
  };
  const result = priceShopVariant(product, {
    variantId: "oled",
    qty: 2,
    unitPrice: 0.01,
    options: { quality: "OLED" }
  }, 0, value => Number(String(value).replace(",", ".")));

  assert.equal(result.item.unitPrice, 79.95);
  assert.equal(result.item.variantId, "oled");
  assert.equal(result.item.sku, "HT-SCH-100002");
  assert.equal(result.item.qty, 2);
});

test("priceShopVariant rejects quantity above selected quality stock", () => {
  const product = { price: "45", variants: [
    { id: "lcd", quality: "LCD", price: "45", stock: "1", active: true }
  ] };
  const result = priceShopVariant(product, { variantId: "lcd", qty: 2 }, 0, Number);
  assert.match(result.error, /onvoldoende voorraad/i);
});


test("findShopProductIndex resolves stable ids after catalog reordering", () => {
  const products = [
    { id: "shop-new", name: "New product" },
    { id: "shop-original", name: "Original product" }
  ];
  assert.equal(findShopProductIndex(products, "shop-original"), 1);
});

test("findShopProductIndex keeps legacy numeric cart indexes working", () => {
  const products = [
    { id: "shop-a", name: "First product" },
    { id: "shop-b", name: "Second product" }
  ];
  assert.equal(findShopProductIndex(products, "1"), 1);
  assert.equal(findShopProductIndex(products, "9"), -1);
  assert.equal(findShopProductIndex(products, "missing"), -1);
});


test("stable Shop cart identity still prices and deducts the same product after reordering", () => {
  const products = [
    { id: "shop-added-later", name: "New product", variants: [
      { id: "new-quality", quality: "LCD", price: "9", stock: "10", active: true }
    ] },
    { id: "shop-original", name: "Original product", variants: [
      { id: "original-quality", quality: "OLED", price: "35", stock: "4", active: true }
    ] }
  ];
  const cartItem = { id: "shop-original", variantId: "original-quality", qty: 2, unitPrice: 0.01 };
  const index = findShopProductIndex(products, cartItem.id);
  const product = products[index];
  const priced = priceShopVariant(product, cartItem, product.id, Number);
  assert.equal(priced.item.id, "shop-original");
  assert.equal(priced.item.unitPrice, 35);

  const deduction = deductShopVariantInventory(product, priced.item);
  assert.equal(deduction.remaining, 2);
  assert.equal(products[0].variants[0].stock, "10");
});
