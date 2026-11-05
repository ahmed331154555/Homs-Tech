"use strict";

const PRODUCT_FIELDS = [
  "id", "name", "title", "brand", "active", "available", "stockStatus", "stock",
  "description", "beschrijving", "price", "salePrice", "sellPrice", "image",
  "imageUrl", "images", "storage", "geheugen", "color", "kleur", "condition",
  "conditie", "warranty", "garantie", "catalogFamily", "catalogModel", "screen",
  "screenSize", "camera", "processor", "gpu", "hardware", "software",
  "connectivity", "memory", "releaseYear", "specifications", "storageOptions",
  "colorOptions", "conditionOptions", "batteryOptions", "vatOptions",
  "tradeInOptions", "variantPrices", "optionGroups", "addonGroups",
  "colorGalleryImages", "colorImages"
];

const OPTION_FIELDS = [
  "id", "label", "active", "enabled", "available", "priceDelta",
  "basePrice", "conditionBasePrice", "image"
];

function pickFields(source, fields) {
  const output = {};
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(source, key)) output[key] = source[key];
  }
  return output;
}

function sanitizeOptionList(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(option => option && typeof option === "object" && !Array.isArray(option))
    .map(option => pickFields(option, OPTION_FIELDS));
}

function sanitizeProduct(product) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const output = pickFields(product, PRODUCT_FIELDS);
  for (const key of ["storageOptions", "colorOptions", "conditionOptions", "batteryOptions", "vatOptions", "tradeInOptions"]) {
    if (Object.prototype.hasOwnProperty.call(output, key)) output[key] = sanitizeOptionList(output[key]) || [];
  }
  if (Array.isArray(output.variantPrices)) {
    output.variantPrices = output.variantPrices.filter(row => row && typeof row === "object" && !Array.isArray(row))
      .map(row => pickFields(row, ["condition", "color", "storage", "price", "active", "available", "stock"]));
  }
  for (const key of ["optionGroups", "addonGroups"]) {
    if (Array.isArray(output[key])) {
      output[key] = output[key].filter(group => group && typeof group === "object" && !Array.isArray(group))
        .map(group => {
          const safe = pickFields(group, ["id", "name", "title", "label", "required", "active"]);
          safe.options = sanitizeOptionList(group.options) || [];
          return safe;
        });
    }
  }
  if (Array.isArray(output.specifications)) {
    output.specifications = output.specifications.filter(item => item && typeof item === "object")
      .map(item => pickFields(item, ["label", "value"]));
  }
  for (const key of ["images"]) {
    if (Array.isArray(output[key])) output[key] = output[key].filter(value => typeof value === "string").slice(0, 8);
  }
  for (const key of ["colorGalleryImages", "colorImages"]) {
    if (output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) {
      const safe = {};
      for (const [color, value] of Object.entries(output[key])) {
        if (typeof value === "string") safe[color] = value;
        else if (Array.isArray(value)) safe[color] = value.filter(item => typeof item === "string").slice(0, 8);
      }
      output[key] = safe;
    } else if (key in output) {
      delete output[key];
    }
  }
  return output;
}

function sanitizeProductCatalogData(source) {
  const input = source && typeof source === "object" ? source : {};
  return {
    phones: Array.isArray(input.phones) ? input.phones.map(sanitizeProduct).filter(Boolean) : [],
    usedPhones: Array.isArray(input.usedPhones) ? input.usedPhones.map(sanitizeProduct).filter(Boolean) : [],
    phone: typeof input.phone === "string" ? input.phone : "",
    whatsapp: typeof input.whatsapp === "string" ? input.whatsapp : "",
    businessName: String(input.businessName || input.siteName || "HOMS TECH"),
    siteName: String(input.siteName || "HOMS TECH"),
    tagline: String(input.tagline || "Telefoonreparatie aan huis")
  };
}

module.exports = { sanitizeProductCatalogData };
