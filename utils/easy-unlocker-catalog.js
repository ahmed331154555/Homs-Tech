"use strict";

// Parses the Dhru Fusion Pro reseller catalogue (GET /products) into a flat,
// sanitised list of services. Nothing here talks to the network.

const MAX_SERVICES = 20000;

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanPrice(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) return 0;
  return Math.round(number * 10000) / 10000;
}

function cleanImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString().slice(0, 500) : "";
  } catch {
    return "";
  }
}

function cleanFields(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((field) => ({
    type: cleanText(field && field.type, 30),
    name: cleanText(field && field.name, 80),
    required: Boolean(field && field.required),
    min: cleanText(field && field.min, 12),
    max: cleanText(field && field.max, 12),
  }));
}

function parseEasyUnlockerCatalog(payload) {
  const root =
    payload && typeof payload === "object" && payload.data
      ? payload.data
      : payload;
  if (
    !root ||
    typeof root !== "object" ||
    !root.products ||
    typeof root.products !== "object" ||
    Array.isArray(root.products)
  ) {
    throw new Error("Ongeldig bestand: 'products' ontbreekt.");
  }

  const currency = cleanText(root.currency || "USD", 8).toUpperCase() || "USD";
  const categories = new Map();
  if (root.categories && typeof root.categories === "object") {
    for (const [id, value] of Object.entries(root.categories)) {
      const name = cleanText(value && value.name, 120);
      if (name) categories.set(cleanText(id, 40), name);
    }
  }

  const services = [];
  for (const [rawId, product] of Object.entries(root.products)) {
    if (!product || typeof product !== "object") continue;
    const productId = cleanText(rawId, 40);
    const name = cleanText(product.name, 200);
    if (!productId || !name) continue;
    const categoryId = cleanText(
      product.cid || (Array.isArray(product.cids) ? product.cids[0] : ""),
      40,
    );
    services.push({
      productId,
      uuid: cleanText(product.product_uuid, 64),
      name,
      type: cleanText(product.type, 30),
      categoryId,
      categoryName: categories.get(categoryId) || "",
      price: cleanPrice(product.price),
      currency,
      imageUrl: cleanImageUrl(product.image_url),
      fields: cleanFields(product.fields),
    });
    if (services.length >= MAX_SERVICES) break;
  }
  if (!services.length) throw new Error("Geen diensten gevonden in de catalogus.");
  return { currency, services };
}

module.exports = { parseEasyUnlockerCatalog, MAX_SERVICES };
