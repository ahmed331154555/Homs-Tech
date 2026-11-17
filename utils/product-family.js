"use strict";

function productRecordColor(product) {
  const direct = String(product?.color || product?.kleur || "").trim();
  if (direct) return direct;
  const name = String(product?.name || "")
    .trim()
    .toLowerCase();
  const colors = [
    "titanium naturel",
    "middernacht",
    "sterrenlicht",
    "space grey",
    "space gray",
    "deep purple",
    "natural titanium",
    "black titanium",
    "white titanium",
    "zwart",
    "wit",
    "blauw",
    "groen",
    "rood",
    "geel",
    "paars",
    "roze",
    "goud",
    "zilver",
    "oranje",
    "bruin",
    "grijs",
    "black",
    "white",
    "blue",
    "green",
    "red",
    "yellow",
    "purple",
    "pink",
    "gold",
    "silver",
    "gray",
    "grey",
  ].sort((a, b) => b.length - a.length);
  return colors.find((color) => name.endsWith(" " + color)) || "";
}

function productBaseModel(product) {
  let name = String(
    product?.catalogFamily || product?.catalogModel || product?.name || "",
  ).trim();
  name = name.replace(
    /(?:^|[\s_-])(?:32|64|128|256|512)\s*GB\b|(?:^|[\s_-])1\s*TB\b/gi,
    " ",
  );
  const color = productRecordColor(product);
  if (color && name.toLowerCase().endsWith(" " + color.toLowerCase())) {
    name = name.slice(0, -color.length - 1);
  }
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function getProductFamilyRecords(phones, productIndex) {
  if (
    !Array.isArray(phones) ||
    !Number.isSafeInteger(productIndex) ||
    productIndex < 0
  )
    return [];
  const product = phones[productIndex];
  if (!product || typeof product !== "object" || Array.isArray(product))
    return [];
  const base = productBaseModel(product);
  if (!base) return [{ phone: product, index: productIndex }];

  const records = phones
    .map((phone, index) => ({ phone, index }))
    .filter(
      (record) =>
        record.phone &&
        typeof record.phone === "object" &&
        !Array.isArray(record.phone) &&
        productBaseModel(record.phone) === base,
    );

  return records.length ? records : [{ phone: product, index: productIndex }];
}

module.exports = {
  productRecordColor,
  productBaseModel,
  getProductFamilyRecords,
};
