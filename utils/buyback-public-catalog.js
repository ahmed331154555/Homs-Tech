"use strict";

const { sanitizePublicSiteData } = require("./site-data-sanitizers");

function normalizeBuybackModelName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(apple|iphone|smartphone|telefoon)\b/g, " ")
    .replace(/\b(16|32|64|128|256|512)\s*gb\b|\b1\s*tb\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchesBuybackModel(buybackPhone, salesPhone) {
  const target = normalizeBuybackModelName(buybackPhone?.name);
  const candidate = normalizeBuybackModelName(salesPhone?.name);
  return Boolean(target && candidate && (
    candidate === target ||
    (candidate.length >= 5 && target.length >= 5 &&
      (candidate.includes(target) || target.includes(candidate)))
  ));
}

function projectBuybackPhone(phone) {
  const protocol = String(phone.buybackProtocol || phone.protocol || "1");
  const output = {
    id: phone.id,
    name: phone.name || "",
    brand: phone.brand || "",
    deviceType: phone.deviceType || phone.type || "",
    type: phone.type || "",
    price: phone.price,
    scrapPrice: phone.scrapPrice,
    image: phone.image || "",
    imageOutside: phone.imageOutside || "",
    active: phone.active,
    buybackProtocol: phone.buybackProtocol,
    protocol: phone.protocol
  };

  if (protocol === "1") {
    for (const key of [
      "storageOptions", "conditionOptions", "batteryOptions",
      "faceIdOptions", "screenOptions", "variantOptions",
      "customBuybackQuestions"
    ]) {
      if (Object.prototype.hasOwnProperty.call(phone, key)) output[key] = phone[key];
    }
  } else if (protocol === "2" || protocol === "protocol2") {
    output.protocol2 = phone.protocol2 || {};
  } else if (/^protocol[3-8]$/.test(protocol)) {
    output[protocol] = phone[protocol] || {};
  }

  const settingsKey = protocol === "1" ? "1" : "2";
  const settings = phone.buybackProtocolSettings;
  if (settings && typeof settings === "object" && settings[settingsKey]) {
    output.buybackProtocolSettings = { [settingsKey]: settings[settingsKey] };
  }

  return output;
}

function dataImageBytes(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/")) return 0;
  return Buffer.byteLength(value);
}

function sumDataImageBytes(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sumDataImageBytes(item), 0);
  if (!value || typeof value !== "object") return dataImageBytes(value);
  return Object.values(value).reduce((sum, item) => sum + sumDataImageBytes(item), 0);
}

function buildPublicBuybackCatalogPayload(source) {
  const input = source && typeof source === "object" ? source : {};
  const buybackCatalog = Array.isArray(input.buybackCatalog) ? input.buybackCatalog : [];
  const buybackPhones = (Array.isArray(input.buybackPhones) ? input.buybackPhones : [])
    .filter(phone => phone && typeof phone === "object" && phone.active !== false)
    .map(projectBuybackPhone);
  const sourceSalesPhones = Array.isArray(input.salesPhones) ? input.salesPhones : [];

  // The customer page only uses sales-catalog photos and public specifications
  // for models that actually appear in the active buyback catalog.
  const matchedSalesPhones = [];
  const matchedIndexes = new Set();
  for (const buybackPhone of buybackPhones) {
    const index = sourceSalesPhones.findIndex(phone => matchesBuybackModel(buybackPhone, phone));
    if (index < 0 || matchedIndexes.has(index)) continue;
    matchedIndexes.add(index);
    const phone = sourceSalesPhones[index];
    if (!phone || typeof phone !== "object") continue;
    matchedSalesPhones.push({
      name: phone.name || "",
      brand: phone.brand || "",
      image: phone.image || (Array.isArray(phone.images) ? phone.images.find(Boolean) : "") || "",
      images: Array.isArray(phone.images) ? phone.images.filter(Boolean).slice(0, 1) : [],
      screenSize: phone.screenSize || "",
      processor: phone.processor || "",
      memory: phone.memory || "",
      gpu: phone.gpu || "",
      releaseYear: phone.releaseYear || "",
      connectivity: phone.connectivity || "",
      specifications: Array.isArray(phone.specifications) ? phone.specifications : []
    });
  }

  return sanitizePublicSiteData({
    buybackCatalog,
    buybackPhones,
    salesPhones: matchedSalesPhones
  });
}

module.exports = {
  normalizeBuybackModelName,
  matchesBuybackModel,
  projectBuybackPhone,
  sumDataImageBytes,
  buildPublicBuybackCatalogPayload
};
