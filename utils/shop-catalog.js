"use strict";

/**
 * Persist only the Shop catalog key so unrelated site settings are not overwritten.
 */
async function saveShopCatalog(queryWithConnectionRetry, shopProducts, expectedShopProducts) {
  const result = await queryWithConnectionRetry(
    "UPDATE site_settings SET data = jsonb_set(data, '{shopProducts}', $1::jsonb, true) WHERE id = 1 AND COALESCE(data->'shopProducts', '[]'::jsonb) = $2::jsonb RETURNING data->'shopProducts' AS products",
    [JSON.stringify(shopProducts), JSON.stringify(expectedShopProducts)],
    4
  );

  if (!result.rows.length) return null;
  return Array.isArray(result.rows[0]?.products)
    ? result.rows[0].products
    : [];
}

function validateShopCatalogImages(products) {
  if (!Array.isArray(products)) return "Shop catalog must be a product list.";
  const maxImageChars = 1_800_000;
  const maxCatalogImageChars = 40_000_000;
  let catalogImageChars = 0;

  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    const product = products[productIndex] || {};
    const images = Array.isArray(product.images) ? product.images : [];
    if (images.length > 4) return "A Shop product may contain at most four photos.";
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex];
      if (image == null || image === "") continue;
      if (typeof image !== "string") return "Invalid Shop photo at product " + (productIndex + 1) + ".";
      if (/^https?:\/\//i.test(image)) continue;
      if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/]+=*$/i.test(image)) {
        return "Unsupported Shop photo format at product " + (productIndex + 1) + ". Use PNG, JPG, WebP or GIF.";
      }
      if (image.length > maxImageChars) return "A Shop photo is too large. Reduce each photo to 1.2 MB or less.";
      catalogImageChars += image.length;
      if (catalogImageChars > maxCatalogImageChars) {
        return "The total Shop photo data is too large. Reduce or remove some photos before saving.";
      }
    }
  }
  return null;
}

function validateShopCatalogIdentifiers(products) {
  if (!Array.isArray(products)) return "Shop catalog must be a product list.";
  const productIds = new Set();
  const variantIds = new Set();
  const skus = new Map();

  for (let productIndex = 0; productIndex < products.length; productIndex += 1) {
    const product = products[productIndex] || {};
    const productLabel = String(product.name || "product " + (productIndex + 1));
    const productId = String(product.id ?? "").trim();
    if (!productId) return "Missing product ID at " + productLabel + ".";
    if (productIds.has(productId)) return "Duplicate Shop product ID: " + productId + ".";
    productIds.add(productId);

    const variants = Array.isArray(product.variants) ? product.variants : [];
    const qualities = new Set();
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const variant = variants[variantIndex] || {};
      const variantId = String(variant.id ?? "").trim();
      if (!variantId) return "Missing option ID at " + productLabel + ".";
      if (variantIds.has(variantId)) return "Duplicate Shop option ID: " + variantId + ".";
      variantIds.add(variantId);

      const sku = String(variant.sku ?? "").trim();
      if (!sku) return "Missing SKU at " + productLabel + ".";
      const skuKey = sku.toUpperCase();
      if (skus.has(skuKey)) return "Duplicate Shop SKU: " + sku + ".";
      skus.set(skuKey, productLabel);

      const quality = String(variant.quality ?? "").trim().toLocaleLowerCase();
      if (quality && qualities.has(quality)) return "Duplicate quality name at " + productLabel + ": " + variant.quality + ".";
      if (quality) qualities.add(quality);
    }
  }
  return null;
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
  validateShopCatalogIdentifiers,
  validateShopCatalogImages,
  findShopProductIndex,
  resolveShopVariant,
  priceShopVariant,
  deductShopVariantInventory
};
