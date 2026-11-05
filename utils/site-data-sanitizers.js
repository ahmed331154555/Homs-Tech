"use strict";

// Public-facing settings omit supplier cost data and importer diagnostics.
function sanitizePublicSiteData(input) {
  const data = input && typeof input === "object" ? { ...input } : {};
  // Retired catalog data is not exposed through public settings.
  delete data.gsmImport;
  delete data.gsmServices;
  if (data.homepage && typeof data.homepage === "object") {
    data.homepage = { ...data.homepage };
    delete data.homepage.gsm;
  }
  return data;
}

// The homepage only needs these public fields; omit page-specific settings.
function sanitizeHomepageSiteData(input) {
  const source = input && typeof input === "object" ? input : {};
  const fields = ["phone", "whatsapp", "homepage", "deviceCategories", "phones", "services", "why"];
  const data = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) data[field] = source[field];
  }

  // The homepage slider renders only the final 15 expanded phone variants.
  // Send only the source phone records that can contribute to those cards,
  // preserving original product indices so product links keep pointing correctly.
  if (Array.isArray(data.phones)) {
    const phones = data.phones;
    const contributionCounts = phones.map(phone => {
      const rows = Array.isArray(phone?.variantPrices)
        ? phone.variantPrices.filter(row => row && row.active !== false)
        : [];
      if (!rows.length) return 1;
      const groups = new Set();
      for (const row of rows) {
        const storage = String(row.storage || "").trim();
        const color = String(row.color || "").trim();
        if (storage && color) groups.add(storage.toLocaleLowerCase() + "|" + color.toLocaleLowerCase());
      }
      return groups.size;
    });
    let cutoff = phones.length;
    let visibleCards = 0;
    for (let i = phones.length - 1; i >= 0; i--) {
      cutoff = i;
      visibleCards += contributionCounts[i];
      if (visibleCards >= 15) break;
    }
    data.phones = phones.slice(cutoff).map((phone, offset) => {
      const originalIndex = cutoff + offset;
      if (typeof phone === "string") return { name: phone, _index: originalIndex };
      if (!phone || typeof phone !== "object") return { name: "Apparaat", _index: originalIndex };

      // Keep only fields the homepage product cards actually render.
      // The stored catalog and full API response remain untouched.
      const compact = { _index: originalIndex };
      for (const key of ["name", "brand", "image", "price", "salePrice", "sellPrice", "verkoopprijs"]) {
        if (Object.prototype.hasOwnProperty.call(phone, key)) compact[key] = phone[key];
      }
      if (Array.isArray(phone.images)) compact.images = phone.images.filter(Boolean).slice(0, 1);
      if (Array.isArray(phone.variantPrices)) {
        compact.variantPrices = phone.variantPrices
          .filter(row => row && row.active !== false)
          .map(row => ({
            storage: row.storage,
            color: row.color,
            price: row.price,
            active: row.active
          }));
      }
      if (phone.colorGalleryImages && typeof phone.colorGalleryImages === "object") {
        compact.colorGalleryImages = {};
        for (const [color, gallery] of Object.entries(phone.colorGalleryImages)) {
          if (Array.isArray(gallery) && gallery[0]) compact.colorGalleryImages[color] = [gallery[0]];
        }
      }
      if (phone.colorImages && typeof phone.colorImages === "object") {
        compact.colorImages = phone.colorImages;
      }
      if (Array.isArray(phone.colorOptions)) {
        compact.colorOptions = phone.colorOptions.map(option => ({
          label: option?.label,
          image: option?.image
        }));
      }
      return compact;
    });
  }

  return sanitizePublicSiteData(data);
}

module.exports = {
  sanitizePublicSiteData,
  sanitizeHomepageSiteData
};
