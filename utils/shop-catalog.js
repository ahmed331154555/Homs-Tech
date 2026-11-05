"use strict";

/**
 * Persist only the Shop catalog key so unrelated site settings are not overwritten.
 */
async function saveShopCatalog(queryWithConnectionRetry, shopProducts) {
  const result = await queryWithConnectionRetry(
    "UPDATE site_settings SET data = jsonb_set(data, '{shopProducts}', $1::jsonb, true) WHERE id = 1 RETURNING data->'shopProducts' AS products",
    [JSON.stringify(shopProducts)],
    4
  );

  return Array.isArray(result.rows[0]?.products)
    ? result.rows[0].products
    : [];
}

function findShopProductIndex(products, productId) {
  if (!Array.isArray(products)) return -1;
  const requested = String(productId ?? "").trim();
  if (!requested) return -1;

  const stableIndex = products.findIndex((product) =>
    product && product.id != null && String(product.id) === requested
  );
  if (stableIndex >= 0) return stableIndex;

  if (!/^\d+$/.test(requested)) return -1;
  const legacyIndex = Number(requested);
  return Number.isSafeInteger(legacyIndex) && legacyIndex >= 0 && legacyIndex < products.length
    ? legacyIndex
    : -1;
}

function resolveShopVariant(product, item) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!variants.length) return { variant: null, variantIndex: -1 };

  const options = item?.options && typeof item.options === "object" ? item.options : {};
  const requested = String(item?.variantId || item?.sku || options.sku || options.quality || "").trim();
  let variantIndex = requested
    ? variants.findIndex((variant) => variant && [variant.id, variant.sku, variant.quality]
        .some((value) => value != null && String(value) === requested))
    : variants.findIndex((variant) => variant && variant.active !== false);

  if (variantIndex < 0) return { error: "De gekozen productkwaliteit is niet meer beschikbaar. Kies de kwaliteit opnieuw." };
  const variant = variants[variantIndex];
  if (!variant || variant.active === false) return { error: "De gekozen productkwaliteit is niet meer beschikbaar." };
  return { variant, variantIndex };
}

function priceShopVariant(product, item, id, moneyNumber) {
  const resolved = resolveShopVariant(product, item);
  if (resolved.error) return { error: resolved.error };

  const variant = resolved.variant;
  const price = moneyNumber(variant?.price ?? product.price);
  const qty = Number(item?.qty ?? 1);
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Dit Shop-product heeft geen geldige prijs voor de gekozen kwaliteit." };
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    return { error: "Kies een geldige hoeveelheid (1–99)." };
  }

  const stockText = String(variant?.stock ?? product.stock ?? "").trim();
  const stockMatch = variant
    ? stockText.match(/^(\d+)$/)
    : stockText.match(/^(\d+)/);
  if (stockMatch && Number(stockMatch[1]) < qty) {
    return { error: variant
      ? "Er is onvoldoende voorraad voor deze productkwaliteit."
      : "Er is onvoldoende voorraad voor dit product." };
  }

  return {
    item: {
      name: String(product.name || "Shop-product"),
      brand: "HOMS TECH Shop",
      type: "shop",
      id,
      variantId: variant ? String(variant.id || variant.sku || variant.quality) : "",
      sku: String(variant?.sku || ""),
      options: {
        category: String(product.category || "Accessoires"),
        quality: String(variant?.quality || "Standaard"),
        sku: String(variant?.sku || "")
      },
      qty,
      unitPrice: Math.round(price * 100) / 100
    }
  };
}

function deductShopVariantInventory(product, item) {
  const resolved = resolveShopVariant(product, item);
  if (resolved.error) throw new Error(resolved.error);
  const qty = Number(item?.qty ?? 1);
  if (!Number.isInteger(qty) || qty < 1) throw new Error("Invalid Shop item quantity.");

  if (resolved.variant) {
    const rawStock = String(resolved.variant.stock ?? "").trim();
    const match = rawStock.match(/^(\d+)$/);
    if (!match) throw new Error("Shop variant stock is not a valid whole number.");
    const stock = Number(match[1]);
    if (stock < qty) throw new Error("Insufficient stock for paid Shop variant.");
    resolved.variant.stock = String(stock - qty);
    if (resolved.variantIndex === 0) product.stock = String(stock - qty) + " stuks";
    return { variant: resolved.variant, remaining: stock - qty };
  }

  const rawStock = String(product.stock ?? "").trim();
  const match = rawStock.match(/^(\d+)/);
  if (match) {
    const stock = Number(match[1]);
    if (stock < qty) throw new Error("Insufficient stock for paid Shop product.");
    product.stock = String(stock - qty) + " stuks";
    return { variant: null, remaining: stock - qty };
  }
  return { variant: null, remaining: null };
}

module.exports = {
  saveShopCatalog,
  resolveShopVariant,
  priceShopVariant,
  deductShopVariantInventory
};
