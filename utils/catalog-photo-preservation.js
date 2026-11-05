"use strict";

function preserveExistingProductPhotos(existingProduct, incomingProduct) {
  if (!existingProduct || !incomingProduct || typeof existingProduct !== "object" || typeof incomingProduct !== "object") return incomingProduct;
  const fields = ["images", "colorImages", "colorGalleryImages", "colorGallery", "galleryImages", "variantImages"];
  const containsPhotos = value => Array.isArray(value)
    ? value.some(v => typeof v === "string" && v.trim() !== "")
    : value && typeof value === "object"
      ? Object.values(value).some(v => containsPhotos(v))
      : typeof value === "string" && value.trim() !== "";
  for (const field of fields) {
    if (containsPhotos(existingProduct[field]) && !containsPhotos(incomingProduct[field])) {
      incomingProduct[field] = existingProduct[field];
    }
  }
  return incomingProduct;
}

function preserveExistingCatalogPhotos(existingData, incomingData) {
  for (const collection of ["phones", "usedPhones", "devices"]) {
    const oldItems = Array.isArray(existingData?.[collection]) ? existingData[collection] : [];
    const newItems = Array.isArray(incomingData?.[collection]) ? incomingData[collection] : [];
    for (const item of newItems) {
      if (!item || typeof item !== "object") continue;
      const oldItem = oldItems.find(old => old && (
        (item.id != null && old.id != null && String(old.id) === String(item.id)) ||
        (item.id == null && old.id == null && String(old.name || old.model || "") === String(item.name || item.model || ""))
      ));
      if (oldItem) preserveExistingProductPhotos(oldItem, item);
    }
  }
  return incomingData;
}

function preserveExistingBuybackPhotos(existingData, incomingData) {
  const existingBrands = Array.isArray(existingData?.buybackCatalog) ? existingData.buybackCatalog : [];
  const incomingBrands = Array.isArray(incomingData?.buybackCatalog) ? incomingData.buybackCatalog : [];
  for (const brand of incomingBrands) {
    if (!brand || typeof brand !== "object") continue;
    const oldBrand = existingBrands.find(old => old && (
      (brand.id != null && old.id != null && String(old.id) === String(brand.id)) ||
      (brand.id == null && old.id == null && String(old.name || "").trim() === String(brand.name || "").trim())
    ));
    if (oldBrand && String(oldBrand.image || "").trim() && !String(brand.image || "").trim()) brand.image = oldBrand.image;
  }
  const existingPhones = Array.isArray(existingData?.buybackPhones) ? existingData.buybackPhones : [];
  const incomingPhones = Array.isArray(incomingData?.buybackPhones) ? incomingData.buybackPhones : [];
  for (const phone of incomingPhones) {
    if (!phone || typeof phone !== "object") continue;
    const oldPhone = existingPhones.find(old => old && (
      (phone.id != null && old.id != null && String(old.id) === String(phone.id)) ||
      (phone.id == null && old.id == null && String(old.name || "").trim() === String(phone.name || "").trim() && String(old.brand || "").trim() === String(phone.brand || "").trim())
    ));
    if (oldPhone && String(oldPhone.image || "").trim() && !String(phone.image || "").trim()) phone.image = oldPhone.image;
  }
  return incomingData;
}

module.exports = {
  preserveExistingProductPhotos,
  preserveExistingCatalogPhotos,
  preserveExistingBuybackPhotos
};
