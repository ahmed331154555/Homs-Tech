"use strict";

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeSupplierProduct(raw, supplier) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const id = firstValue(raw.id, raw.sku, raw.productId, raw.articleNumber, raw.code);
  const name = firstValue(raw.name, raw.title, raw.productName, raw.description);
  if (id === undefined || name === undefined) return null;

  const rawPrice = firstValue(raw.price, raw.sellPrice, raw.retailPrice, raw.amount);
  const price = rawPrice === undefined ? null : Number(rawPrice);
  const rawStock = firstValue(raw.stock, raw.quantity, raw.availableStock, raw.inventory);
  const stock = rawStock === undefined ? null : Number(rawStock);
  const image = firstValue(raw.image, raw.imageUrl, raw.photo, raw.picture);

  return {
    id: String(id),
    supplier,
    name: String(name).trim(),
    brand: firstValue(raw.brand, raw.manufacturer, null),
    model: firstValue(raw.model, raw.modelName, null),
    sku: firstValue(raw.sku, raw.articleNumber, null),
    price: Number.isFinite(price) && price >= 0 ? price : null,
    currency: String(firstValue(raw.currency, "EUR")).toUpperCase(),
    stock: Number.isFinite(stock) && stock >= 0 ? stock : null,
    inStock: typeof raw.inStock === "boolean"
      ? raw.inStock
      : Number.isFinite(stock) ? stock > 0 : null,
    image: typeof image === "string" && /^https?:\/\//i.test(image) ? image : null,
    sourceUpdatedAt: firstValue(raw.updatedAt, raw.updated_at, null),
  };
}

function extractProductArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["products", "items", "data", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      for (const nested of ["products", "items", "results"]) {
        if (Array.isArray(value[nested])) return value[nested];
      }
    }
  }
  return [];
}

module.exports = { normalizeSupplierProduct, extractProductArray };
