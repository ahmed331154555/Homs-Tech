"use strict";

const { findShopProductIndex, resolveShopVariant } = require("./shop-catalog");

function validateCartInventoryQuantities(catalog, items) {
  const requested = new Map();
  const register = (key, stock, qty, message, parser = Number) => {
    if (stock === undefined || stock === null || stock === "") return null;
    const available = parser(stock);
    if (!Number.isFinite(available) || available < 0) return message;
    const entry = requested.get(key) || { available, qty: 0, message };
    if (entry.available !== available) return message;
    entry.qty += qty;
    requested.set(key, entry);
    return null;
  };

  for (const item of Array.isArray(items) ? items : []) {
    const type = String(item?.type || "").toLowerCase();
    if (type === "used") return "Tweedehands telefoons zijn niet meer beschikbaar.";
    const list = type === "shop"
      ? (Array.isArray(catalog?.shopProducts) ? catalog.shopProducts : [])
      : (Array.isArray(catalog?.phones) && catalog.phones.length ? catalog.phones : (Array.isArray(catalog?.devices) ? catalog.devices : []));
    const index = type === "shop" ? findShopProductIndex(list, item?.id) : Number(item?.id);
    const product = Number.isInteger(index) && index >= 0 ? list[index] : null;
    const catalogType = type === "shop" ? "shop" : "phones";
    const qty = Number(item?.qty ?? 1);
    if (!product || !Number.isInteger(qty) || qty < 1) return "Een product in uw winkelwagen is niet meer beschikbaar.";

    const options = item.options && typeof item.options === "object" ? item.options : {};
    if (type === "shop") {
      const resolved = resolveShopVariant(product, item);
      if (resolved.error) return resolved.error;
      if (resolved.variant) {
        const error = register("shop-variant:" + JSON.stringify([product.id, resolved.variant.id]), resolved.variant.stock,
          qty, "De voorraad voor deze productkwaliteit is niet correct ingesteld. Neem contact met ons op.");
        if (error) return error;
      } else if (product.stock !== undefined && product.stock !== null && product.stock !== "") {
        const match = String(product.stock).trim().match(/^(\d+)/);
        if (match) {
          const error = register("shop-product:" + JSON.stringify([product.id]), Number(match[1]), qty,
            "De voorraad voor dit Shop-product is niet correct ingesteld.");
          if (error) return error;
        }
      }
    } else if (product.pricingMode === "variant") {
      const rows = Array.isArray(product.variantPrices) ? product.variantPrices : [];
      const row = rows.find(x => x && String(x.condition ?? "") === String(options.condition ?? "") &&
        String(x.color ?? "") === String(options.color ?? "") && String(x.storage ?? "") === String(options.storage ?? ""));
      if (!row) return "Deze uitvoering is niet meer beschikbaar.";
      if (row.stock !== undefined && row.stock !== null && row.stock !== "") {
        const error = register("catalog-variant:" + JSON.stringify([catalogType, index, String(row.condition), String(row.color), String(row.storage)]),
          row.stock, qty, "De voorraad voor deze uitvoering is niet correct ingesteld.");
        if (error) return error;
      }
    } else {
      const stockKey = ["stock", "quantity", "stockQuantity"].find(key => product[key] !== undefined && product[key] !== null && product[key] !== "");
      if (stockKey) {
        const error = register("catalog-product:" + JSON.stringify([catalogType, index]), product[stockKey], qty,
          "De voorraad voor dit product is niet correct ingesteld.");
        if (error) return error;
      }
    }

    const custom = options.custom && typeof options.custom === "object" ? options.custom : {};
    for (const groupType of ["optionGroups", "addonGroups"]) {
      const groups = Array.isArray(product[groupType]) ? product[groupType] : [];
      for (let i = 0; i < groups.length; i += 1) {
        const label = String(custom[groupType + ":" + i] ?? "");
        if (!label) continue;
        const option = (Array.isArray(groups[i]?.options) ? groups[i].options : []).find(x => x && String(x.label) === label);
        if (!option) return "Een extra of variant is niet meer beschikbaar.";
        if (option.stock !== undefined && option.stock !== null && option.stock !== "") {
          const error = register("catalog-option:" + JSON.stringify([catalogType, index, groupType, i, label]),
            option.stock, qty, "Deze optie heeft onvoldoende of onjuist ingestelde voorraad.");
          if (error) return error;
        }
      }
    }
  }

  for (const entry of requested.values()) {
    if (entry.qty > entry.available) return entry.message === "Deze optie heeft onvoldoende of onjuist ingestelde voorraad."
      ? entry.message
      : "Er is onvoldoende voorraad voor de totale hoeveelheid in uw winkelwagen.";
  }
  return null;
}

module.exports = { validateCartInventoryQuantities };
