"use strict";

function sanitizeDevicesCatalogData(source) {
  const input = source && typeof source === "object" ? source : {};
  const output = {
    phone: input.phone || "",
    whatsapp: input.whatsapp || "",
    businessName: input.businessName || input.siteName || "HOMS TECH",
    tagline: input.tagline || "Telefoonreparatie aan huis",
  };

  if (Array.isArray(input.phones)) {
    output.phones = input.phones.map((phone) => {
      if (!phone || typeof phone !== "object") return phone;

      const compact = {};
      const allowedFields = [
        "id",
        "name",
        "brand",
        "active",
        "warranty",
        "garantie",
        "description",
        "price",
        "salePrice",
        "sellPrice",
        "verkoopprijs",
        "storage",
        "geheugen",
        "color",
        "kleur",
        "condition",
        "conditie",
        "stock",
      ];
      for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(phone, key))
          compact[key] = phone[key];
      }

      const primaryImage =
        (typeof phone.image === "string" && phone.image) ||
        (typeof phone.imageUrl === "string" && phone.imageUrl) ||
        "";
      if (primaryImage) compact.image = primaryImage;
      else if (Array.isArray(phone.images)) {
        const firstImage = phone.images.find(
          (image) => typeof image === "string" && image,
        );
        if (firstImage) compact.images = [firstImage];
      }

      if (Array.isArray(phone.conditionOptions)) {
        compact.conditionOptions = phone.conditionOptions
          .filter(
            (option) =>
              option && option.active !== false && option.available !== false,
          )
          .map((option) => {
            const safe = {
              active: option.active,
              available: option.available,
              basePrice: option.basePrice,
              conditionBasePrice: option.conditionBasePrice,
            };
            for (const key of ["condition", "name", "label", "title"]) {
              if (Object.prototype.hasOwnProperty.call(option, key))
                safe[key] = option[key];
            }
            return safe;
          });
      }

      if (Array.isArray(phone.variantPrices)) {
        compact.variantPrices = phone.variantPrices
          .filter((row) => row && row.active !== false)
          .map((row) => ({
            storage: row.storage,
            color: row.color,
            price: row.price,
            stock: row.stock,
            active: row.active,
          }));
      }

      const galleryImages = {};
      if (
        phone.colorGalleryImages &&
        typeof phone.colorGalleryImages === "object" &&
        !Array.isArray(phone.colorGalleryImages)
      ) {
        for (const [color, gallery] of Object.entries(
          phone.colorGalleryImages,
        )) {
          const firstImage = Array.isArray(gallery)
            ? gallery.find((image) => typeof image === "string" && image)
            : "";
          if (firstImage) galleryImages[color] = [firstImage];
        }
      }
      const galleryColors = new Set(Object.keys(galleryImages));
      if (galleryColors.size) compact.colorGalleryImages = galleryImages;

      const colorImages = {};
      if (
        phone.colorImages &&
        typeof phone.colorImages === "object" &&
        !Array.isArray(phone.colorImages)
      ) {
        for (const [color, image] of Object.entries(phone.colorImages)) {
          if (typeof image === "string" && image && !galleryColors.has(color)) {
            colorImages[color] = image;
          }
        }
      }
      const imageColors = new Set([
        ...galleryColors,
        ...Object.keys(colorImages),
      ]);
      if (Object.keys(colorImages).length) compact.colorImages = colorImages;

      if (Array.isArray(phone.colorOptions)) {
        const colorOptions = phone.colorOptions
          .filter(
            (option) =>
              option &&
              typeof option.label === "string" &&
              typeof option.image === "string" &&
              option.image &&
              !imageColors.has(option.label),
          )
          .map((option) => ({ label: option.label, image: option.image }));
        if (colorOptions.length) compact.colorOptions = colorOptions;
      }

      return compact;
    });
  }

  if (Array.isArray(input.devices)) {
    output.devices = input.devices.map((device) => ({
      name: device?.name,
      brand: device?.brand,
      price: device?.price,
    }));
  }

  return output;
}
function sanitizeCartStockData(products) {
  if (!Array.isArray(products)) return [];

  return products.map((product) => {
    if (!product || typeof product !== "object") return product;

    return {
      stock: product.stock,
      variants: Array.isArray(product.variants)
        ? product.variants.map((variant) => ({
            id: variant?.id,
            sku: variant?.sku,
            quality: variant?.quality,
            stock: variant?.stock,
          }))
        : [],
    };
  });
}

module.exports = {
  sanitizeDevicesCatalogData,
  sanitizeCartStockData,
};
