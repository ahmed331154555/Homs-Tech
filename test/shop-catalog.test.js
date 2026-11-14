"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { saveShopCatalog, validateShopCatalogIdentifiers, validateShopCatalogImages } = require("../utils/shop-catalog");

test("saveShopCatalog updates only the Shop JSON key without returning the image-heavy catalog", async () => {
  const products = [
    { id: "HT-001", name: "iPhone case", price: 12.5, images: ["case.webp"] },
    { id: "HT-002", name: "USB-C cable", price: 8 }
  ];
  let captured;
  const queryWithConnectionRetry = async (...args) => {
    captured = args;
    return { rows: [{ id: 1 }] };
  };

  const expected = [{ id: "HT-001", name: "iPhone case", price: 10 }];
  const saved = await saveShopCatalog(queryWithConnectionRetry, products, expected);

  assert.equal(saved, true);
  assert.match(captured[0], /jsonb_set\(data, '\{shopProducts\}'/);
  assert.match(captured[0], /COALESCE\(data->'shopProducts', '\[\]'::jsonb\) = \$2::jsonb/);
  assert.match(captured[0], /WHERE id = 1 AND/);
  assert.match(captured[0], /RETURNING id/);
  assert.doesNotMatch(captured[0], /RETURNING data->'shopProducts'/);
  assert.deepEqual(captured[1], [JSON.stringify(products), JSON.stringify(expected)]);
  assert.equal(captured[2], 4);
});

test("saveShopCatalog returns null when another admin changed the catalog first", async () => {
  const saved = await saveShopCatalog(async () => ({ rows: [] }), [], []);
  assert.equal(saved, null);
});


test("validateShopCatalogImages accepts supported images and up to four photos", () => {
  const validPng = "data:image/png;base64," + "a".repeat(100);
  assert.equal(validateShopCatalogImages([{ images: [validPng, "https://cdn.example.test/photo.webp", "", null] }]), null);
});

test("validateShopCatalogImages rejects more than four photos and unsupported formats", () => {
  assert.match(validateShopCatalogImages([{ images: ["", "", "", "", ""] }]), /at most four/i);
  assert.match(validateShopCatalogImages([{ images: ["data:image/svg+xml;base64,PHN2Zz4="] }]), /Unsupported Shop photo format/i);
});

test("validateShopCatalogImages rejects oversized and aggregate image payloads", () => {
  assert.match(validateShopCatalogImages([{ images: ["data:image/png;base64," + "a".repeat(1_800_001)] }]), /too large/i);
  const tooManyBytes = "data:image/png;base64," + "a".repeat(1_700_000);
  assert.match(validateShopCatalogImages(Array.from({ length: 6 }, () => ({ images: Array(4).fill(tooManyBytes) }))), /total Shop photo data/i);
});

const { findShopProductIndex, resolveShopVariant, priceShopVariant, deductShopVariantInventory } = require("../utils/shop-catalog");

test("validateShopCatalogIdentifiers accepts unique product, option, SKU and quality identifiers", () => {
  assert.equal(validateShopCatalogIdentifiers([
    { id: "p1", name: "Screen", variants: [
      { id: "v1", sku: "HT-SCH-100001", quality: "LCD" },
      { id: "v2", sku: "HT-SCH-100002", quality: "OLED" }
    ] }
  ]), null);
});

test("validateShopCatalogIdentifiers rejects duplicate SKUs case-insensitively", () => {
  const error = validateShopCatalogIdentifiers([
    { id: "p1", name: "Screen A", variants: [{ id: "v1", sku: "HT-SCH-1", quality: "LCD" }] },
    { id: "p2", name: "Screen B", variants: [{ id: "v2", sku: "ht-sch-1", quality: "OLED" }] }
  ]);
  assert.match(error, /Duplicate Shop SKU/i);
});

test("validateShopCatalogIdentifiers rejects duplicate product and option IDs", () => {
  assert.match(validateShopCatalogIdentifiers([
    { id: "same", variants: [{ id: "v1", sku: "SKU-1", quality: "LCD" }] },
    { id: "same", variants: [{ id: "v2", sku: "SKU-2", quality: "OLED" }] }
  ]), /Duplicate Shop product ID/i);
  assert.match(validateShopCatalogIdentifiers([
    { id: "p1", variants: [{ id: "same", sku: "SKU-1", quality: "LCD" }] },
    { id: "p2", variants: [{ id: "same", sku: "SKU-2", quality: "OLED" }] }
  ]), /Duplicate Shop option ID/i);
});

test("validateShopCatalogIdentifiers rejects duplicate quality names and missing SKUs", () => {
  assert.match(validateShopCatalogIdentifiers([
    { id: "p1", name: "Screen", variants: [
      { id: "v1", sku: "SKU-1", quality: "LCD" },
      { id: "v2", sku: "SKU-2", quality: "lcd" }
    ] }
  ]), /Duplicate quality name/i);
  assert.match(validateShopCatalogIdentifiers([
    { id: "p1", variants: [{ id: "v1", sku: "", quality: "LCD" }] }
  ]), /Missing SKU/i);
});


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

test("priceShopVariant rejects a selected quality with missing or malformed stock", () => {
  for (const stock of ["", "Op voorraad", "3 stuks", undefined]) {
    const product = { variants: [{ id: "lcd", quality: "LCD", price: "45", stock, active: true }] };
    const result = priceShopVariant(product, { variantId: "lcd", qty: 1 }, 0, Number);
    assert.match(result.error, /voorraad.*niet correct ingesteld/i);
  }
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
