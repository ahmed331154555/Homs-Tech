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

const { resolveShopVariant, deductShopVariantInventory } = require("../utils/shop-catalog");

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
