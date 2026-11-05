"use strict";

function sanitizeDevicesCatalogData(source) {
  const input = source && typeof source === "object" ? source : {};
  const output = {
    phone: input.phone || "",
    whatsapp: input.whatsapp || "",
    businessName: input.businessName || input.siteName || "HOMS TECH",
    tagline: input.tagline || "Telefoonreparatie aan huis"
  };

  if (Array.isArray(input.phones)) {
    output.phones = input.phones.map((phone) => {
      if (!phone || typeof phone !== "object") return phone;

      const compact = {};
      const allowedFields = [
        "id", "name", "brand", "active", "warranty", "garantie",
        "description", "price", "salePrice", "sellPrice", "verkoopprijs",
        "storage", "geheugen", "color", "kleur", "condition", "conditie",
        "stock", "image", "imageUrl"
      ];

      for (const key of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(phone, key)) {
          compact[key] = phone[key];
        }
      }

      if (Array.isArray(phone.images)) {
        compact.images = phone.images.filter(image => typeof image === "string" && image).slice(0, 1);
      }

      if (Array.isArray(phone.conditionOptions)) {
        compact.conditionOptions = phone.conditionOptions
          .filter((option) => option && option.active !== false && option.available !== false)
          .map((option) => ({
            active: option.active,
            available: option.available,
            basePrice: option.basePrice,
            conditionBasePrice: option.conditionBasePrice
          }));
      }

      if (Array.isArray(phone.variantPrices)) {
        compact.variantPrices = phone.variantPrices
          .filter((row) => row && row.active !== false)
          .map((row) => ({
            storage: row.storage,
            color: row.color,
            price: row.price,
            stock: row.stock,
            active: row.active
          }));
      }

      if (phone.colorGalleryImages && typeof phone.colorGalleryImages === "object") {
        compact.colorGalleryImages = {};
        for (const [color, gallery] of Object.entries(phone.colorGalleryImages)) {
          if (Array.isArray(gallery)) {
            const firstImage = gallery.find(image => typeof image === "string" && image);
            if (firstImage) compact.colorGalleryImages[color] = [firstImage];
          }
        }
      }

      if (phone.colorImages && typeof phone.colorImages === "object" && !Array.isArray(phone.colorImages)) {
        compact.colorImages = {};
        for (const [color, image] of Object.entries(phone.colorImages)) {
          if (typeof image === "string") compact.colorImages[color] = image;
        }
      }

      if (Array.isArray(phone.colorOptions)) {
        compact.colorOptions = phone.colorOptions.map((option) => ({
          label: option?.label,
          image: option?.image
        }));
      }

      return compact;
    });
  }

  if (Array.isArray(input.devices)) {
    output.devices = input.devices.map((device) => ({
      name: device?.name,
      brand: device?.brand,
      price: device?.price
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
            stock: variant?.stock
          }))
        : []
    };
  });
}

module.exports = {
  sanitizeDevicesCatalogData,
  sanitizeCartStockData
};
