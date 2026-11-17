"use strict";

// Public settings are recursively filtered so nested catalog records cannot expose
// supplier costs, credentials, or internal-only metadata.
const PRIVATE_FIELD_PATTERN =
  /(?:supplier|purchase|buy.?price|wholesale|cost|margin|profit|inkoop|kostprijs|winst|secret|password|credential|token|api.?key|private|internal|admin.?only|webhook.?secret|client.?secret)/i;

function stripPrivatePublicFields(value) {
  if (Array.isArray(value)) return value.map(stripPrivatePublicFields);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_FIELD_PATTERN.test(key)) continue;
    output[key] = stripPrivatePublicFields(nested);
  }
  return output;
}

function sanitizePublicSiteData(input) {
  const data =
    input && typeof input === "object" ? stripPrivatePublicFields(input) : {};
  // Retired catalog data is not exposed through public settings.
  delete data.gsmImport;
  delete data.gsmServices;
  if (data.homepage && typeof data.homepage === "object") {
    delete data.homepage.gsm;
  }
  return data;
}

function replaceEmbeddedHomepageImages(value, phoneIndex, path = "") {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      replaceEmbeddedHomepageImages(
        item,
        phoneIndex,
        path ? path + "." + index : String(index),
      ),
    );
  }
  if (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value)
  ) {
    return (
      "/api/homepage/phone-image/" +
      encodeURIComponent(String(phoneIndex)) +
      "?path=" +
      encodeURIComponent(path)
    );
  }
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = replaceEmbeddedHomepageImages(
      nested,
      phoneIndex,
      path ? path + "." + key : key,
    );
  }
  return output;
}

// The homepage only needs these public fields; omit page-specific settings.
function sanitizeHomepageSiteData(input) {
  const source = input && typeof input === "object" ? input : {};
  const fields = [
    "phone",
    "whatsapp",
    "homepage",
    "deviceCategories",
    "phones",
    "services",
    "why",
  ];
  const data = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field))
      data[field] = source[field];
  }

  // Keep the homepage catalog small while honoring the exact products selected
  // in Homepage > Populaire apparaten. Preserve original indices for product links.
  if (Array.isArray(data.phones)) {
    const phones = data.phones;
    const popular =
      data.homepage && typeof data.homepage === "object"
        ? data.homepage.popular
        : null;
    const selected = Array.isArray(popular?.indexes)
      ? [
          ...new Set(
            popular.indexes
              .map(Number)
              .filter(
                (index) =>
                  Number.isInteger(index) &&
                  index >= 0 &&
                  index < phones.length,
              ),
          ),
        ]
      : [];

    // The homepage response contains a compact, already-selected phone list.
    // Clear stale selections when every saved index is outside the current catalog;
    // otherwise the browser filters this fallback list a second time and shows no phones.
    if (popular && Array.isArray(popular.indexes)) {
      data.homepage = {
        ...data.homepage,
        popular: { ...popular, indexes: selected },
      };
    }
    const configuredLimit = Number(popular?.limit);
    const limit = Number.isFinite(configuredLimit)
      ? Math.max(1, Math.min(50, Math.floor(configuredLimit)))
      : 12;
    const selectedIndices = selected.length
      ? selected.slice(0, limit)
      : Array.from(
          { length: Math.min(phones.length, limit) },
          (_, offset) =>
            phones.length - Math.min(phones.length, limit) + offset,
        );
    data.phones = selectedIndices.map((originalIndex) => {
      const phone = phones[originalIndex];
      const preservedIndex =
        phone &&
        typeof phone === "object" &&
        Number.isInteger(phone._index) &&
        phone._index >= 0
          ? phone._index
          : originalIndex;
      if (typeof phone === "string")
        return { name: phone, _index: preservedIndex };
      if (!phone || typeof phone !== "object")
        return { name: "Apparaat", _index: preservedIndex };

      // Keep the database-selected original catalog index so product links remain stable.
      // The homepage SQL query may already have reduced the catalog to selected rows.
      const compact = { _index: preservedIndex };
      for (const key of [
        "name",
        "brand",
        "image",
        "price",
        "salePrice",
        "sellPrice",
        "verkoopprijs",
      ]) {
        if (Object.prototype.hasOwnProperty.call(phone, key))
          compact[key] = phone[key];
      }
      if (Array.isArray(phone.images))
        compact.images = phone.images.filter(Boolean).slice(0, 1);
      if (Array.isArray(phone.variantPrices)) {
        compact.variantPrices = phone.variantPrices
          .filter((row) => row && row.active !== false)
          .map((row) => ({
            storage: row.storage,
            color: row.color,
            price: row.price,
            active: row.active,
          }));
      }
      if (
        phone.colorGalleryImages &&
        typeof phone.colorGalleryImages === "object"
      ) {
        compact.colorGalleryImages = {};
        for (const [color, gallery] of Object.entries(
          phone.colorGalleryImages,
        )) {
          if (Array.isArray(gallery) && gallery[0])
            compact.colorGalleryImages[color] = [gallery[0]];
        }
      }
      if (phone.colorImages && typeof phone.colorImages === "object") {
        compact.colorImages = phone.colorImages;
      }
      if (Array.isArray(phone.colorOptions)) {
        compact.colorOptions = phone.colorOptions.map((option) => ({
          label: option?.label,
          image: option?.image,
        }));
      }
      // Replace embedded Base64 photos with small URLs while preserving the
      // original catalog index and nested color/gallery paths for the image route.
      return replaceEmbeddedHomepageImages(compact, preservedIndex);
    });
  }

  if (Array.isArray(data.services)) {
    data.services = data.services.map((service, index) => {
      if (
        !Array.isArray(service) ||
        typeof service[3] !== "string" ||
        !/^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(
          service[3],
        )
      ) {
        return service;
      }
      const compact = service.slice();
      compact[3] = "/api/homepage/service-image/" + index;
      return compact;
    });
  }

  return sanitizePublicSiteData(data);
}

module.exports = {
  sanitizePublicSiteData,
  sanitizeHomepageSiteData,
};
