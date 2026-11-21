"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSupplierProduct,
  extractProductArray,
} = require("../services/suppliers/normalize");
const {
  getSupplierConfig,
  getSupplierProducts,
  clearSupplierCache,
} = require("../services/suppliers");

test("normalizes a supplier phone without inventing missing price or stock", () => {
  const product = normalizeSupplierProduct({ id: 12, title: "iPhone 13", imageUrl: "https://example.com/a.jpg" }, "forza");
  assert.equal(product.id, "12");
  assert.equal(product.name, "iPhone 13");
  assert.equal(product.price, null);
  assert.equal(product.stock, null);
  assert.equal(product.inStock, null);
});

test("rejects invalid products and non-http image URLs", () => {
  assert.equal(normalizeSupplierProduct({ title: "No ID" }, "mobico"), null);
  const product = normalizeSupplierProduct({ sku: "A1", name: "Phone", image: "javascript:alert(1)" }, "mobico");
  assert.equal(product.image, null);
});

test("extracts common supplier response formats", () => {
  assert.deepEqual(extractProductArray({ data: { items: [{ id: 1 }] } }), [{ id: 1 }]);
  assert.deepEqual(extractProductArray({ unexpected: [] }), []);
});

test("requires both a valid endpoint and API key", () => {
  assert.equal(getSupplierConfig("forza", { FORZA_API_URL: "https://api.example.com" }), null);
  assert.equal(getSupplierConfig("forza", {
    FORZA_API_URL: "https://api.example.com/products",
    FORZA_API_KEY: "test-key",
  }).url, "https://api.example.com/products");
  assert.equal(getSupplierConfig("forza", {
    FORZA_API_URL: "file:///etc/passwd",
    FORZA_API_KEY: "test-key",
  }), null);
});

test("one unavailable supplier does not prevent the other supplier feed", async () => {
  clearSupplierCache();
  const env = {
    FORZA_API_URL: "https://forza.example/api/products",
    FORZA_API_KEY: "forza-key",
    MOBICO_API_URL: "https://mobico.example/api/products",
    MOBICO_API_KEY: "mobico-key",
  };
  const fetchImpl = async (url) => {
    if (url.includes("forza")) throw new Error("offline");
    return { ok: true, json: async () => ({ products: [{ id: "m1", name: "iPhone 14", price: 399, stock: 2 }] }) };
  };
  const result = await getSupplierProducts({ env, fetchImpl, force: true });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].supplier, "mobico");
  assert.equal(result.suppliers.find((x) => x.supplier === "forza").error, "supplier_unavailable");
  clearSupplierCache();
});
