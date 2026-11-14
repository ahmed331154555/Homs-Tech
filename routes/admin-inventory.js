"use strict";

const { findShopProductIndex } = require("../utils/shop-catalog");

const MOVEMENT_DIRECTIONS = Object.freeze({
  purchase: 1,
  return: 1,
  sale: -1,
  damage: -1
});

function numericStock(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 2147483647) {
    throw new Error(label + " heeft geen geldig geheel voorraadgetal.");
  }
  return number;
}

function phoneVariantKey(row) {
  return [row?.storage, row?.color, row?.condition].map(value => String(value ?? "").trim()).join("::");
}

function findPhoneIndex(products, productId) {
  const requested = String(productId ?? "").trim();
  if (!requested) return -1;
  const byId = products.findIndex(product => product && product.id != null && String(product.id) === requested);
  if (byId >= 0) return byId;
  if (!/^\d+$/.test(requested)) return -1;
  const index = Number(requested);
  return Number.isSafeInteger(index) && index >= 0 && index < products.length ? index : -1;
}

function stockLabel(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function inventoryCatalog(data) {
  const rows = [];
  const phones = Array.isArray(data.phones) ? data.phones : [];
  const shopProducts = Array.isArray(data.shopProducts) ? data.shopProducts : [];

  phones.forEach((product, productIndex) => {
    const productId = String(product?.id ?? productIndex);
    // Match checkout and paid-order deduction: only variant-priced phones
    // track stock per variant; legacy products use parent stock.
    const variants = product?.pricingMode === "variant" && Array.isArray(product?.variantPrices)
      ? product.variantPrices
      : [];
    if (variants.length) {
      variants.forEach((variant, variantIndex) => rows.push({
        itemType: "phone",
        productId,
        productIndex,
        variantIndex,
        variantKey: phoneVariantKey(variant),
        variantId: "",
        name: String(product?.name || "Telefoon"),
        variantLabel: [variant?.storage, variant?.color, variant?.condition].filter(Boolean).join(" · ") || "Uitvoering " + (variantIndex + 1),
        sku: String(variant?.sku || product?.sku || ""),
        stock: stockLabel(variant?.stock),
        active: variant?.available !== false && variant?.active !== false,
        category: "Telefoons"
      }));
    } else {
      rows.push({
        itemType: "phone",
        productId,
        productIndex,
        variantIndex: -1,
        variantKey: "",
        variantId: "",
        name: String(product?.name || "Telefoon"),
        variantLabel: "Standaard",
        sku: String(product?.sku || ""),
        stock: stockLabel(product?.stock),
        active: product?.stockStatus !== "unavailable",
        category: "Telefoons"
      });
    }
  });

  shopProducts.forEach((product, productIndex) => {
    const productId = String(product?.id ?? productIndex);
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length) {
      variants.forEach((variant, variantIndex) => rows.push({
        itemType: "shop",
        productId,
        productIndex,
        variantIndex,
        variantKey: "",
        variantId: String(variant?.id || ""),
        name: String(product?.name || "Shop-product"),
        variantLabel: String(variant?.quality || "Standaard"),
        sku: String(variant?.sku || ""),
        stock: stockLabel(variant?.stock),
        active: variant?.active !== false,
        category: String(product?.category || "Shop")
      }));
    } else {
      const raw = String(product?.stock ?? "").trim();
      const match = raw.match(/^(\d+)/);
      rows.push({
        itemType: "shop",
        productId,
        productIndex,
        variantIndex: -1,
        variantKey: "",
        variantId: "",
        name: String(product?.name || "Shop-product"),
        variantLabel: "Standaard",
        sku: String(product?.sku || ""),
        stock: match ? Number(match[1]) : null,
        active: product?.active !== false,
        category: String(product?.category || "Shop")
      });
    }
  });
  return rows;
}

function registerAdminInventoryRoutes(app, { pool, requirePermission }) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    throw new TypeError("A database pool is required.");
  }

  app.get("/api/admin/inventory", requirePermission("site.save"), async (req, res) => {
    try {
      const [settings, history] = await Promise.all([
        pool.query("SELECT data->'phones' AS phones, data->'devices' AS devices, data->'shopProducts' AS shop_products FROM site_settings WHERE id=1"),
        pool.query(
          "SELECT id,item_type,product_id,variant_id,product_name,variant_label,sku,movement_type,quantity,stock_before,stock_after,reference,note,created_by,created_at FROM inventory_movements ORDER BY id DESC LIMIT 100"
        )
      ]);
      if (!settings.rows.length) return res.status(404).json({ error: "Productcatalogus niet gevonden." });
      const thresholdValue = Number(req.query?.threshold ?? 2);
      const threshold = Number.isSafeInteger(thresholdValue) && thresholdValue >= 0 && thresholdValue <= 1000 ? thresholdValue : 2;
      const catalog = settings.rows[0];
      const items = inventoryCatalog({
        phones: Array.isArray(catalog.phones) ? catalog.phones : [],
        devices: Array.isArray(catalog.devices) ? catalog.devices : [],
        shopProducts: Array.isArray(catalog.shop_products) ? catalog.shop_products : []
      });
      const tracked = items.filter(item => item.stock !== null);
      const totalUnits = tracked.reduce((sum, item) => sum + item.stock, 0);
      const lowStock = tracked.filter(item => item.stock <= threshold);
      const outOfStock = tracked.filter(item => item.stock === 0);
      return res.json({
        items,
        movements: history.rows,
        summary: {
          products: items.length,
          trackedProducts: tracked.length,
          totalUnits,
          lowStockCount: lowStock.length,
          outOfStockCount: outOfStock.length,
          untrackedCount: items.length - tracked.length,
          threshold
        }
      });
    } catch (error) {
      console.error("Admin inventory load failed:", error);
      return res.status(500).json({ error: "Voorraad en voorraadgeschiedenis laden is mislukt." });
    }
  });

  app.post("/api/admin/inventory/movements", requirePermission("site.save"), async (req, res) => {
    const body = req.body || {};
    const itemType = String(body.itemType || "").trim().toLowerCase();
    const productId = String(body.productId ?? "").trim();
    const variantId = String(body.variantId ?? "").trim();
    const variantKey = String(body.variantKey ?? "").trim();
    const movementType = String(body.movementType || "").trim().toLowerCase();
    const note = String(body.note || "").trim().slice(0, 500);
    const reference = String(body.reference || "").trim().slice(0, 100);
    const quantity = Number(body.quantity);
    if (!["phone", "shop"].includes(itemType) || !productId) {
      return res.status(400).json({ error: "Selecteer een geldig product." });
    }
    if (!["purchase", "sale", "return", "damage", "correction"].includes(movementType)) {
      return res.status(400).json({ error: "Kies een geldige voorraadmutatie." });
    }
    if (!Number.isSafeInteger(quantity) || quantity === 0 || Math.abs(quantity) > 100000) {
      return res.status(400).json({ error: "Vul een geldig geheel aantal in." });
    }
    if (movementType === "correction" ? quantity === 0 : quantity < 1) {
      return res.status(400).json({ error: "Gebruik een positief aantal. Bij correctie mag het aantal ook negatief zijn." });
    }
    if (movementType === "correction" && !note) {
      return res.status(400).json({ error: "Vermeld bij een voorraadcorrectie altijd de reden." });
    }

    const delta = movementType === "correction" ? quantity : quantity * MOVEMENT_DIRECTIONS[movementType];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT data->'phones' AS phones, data->'shopProducts' AS shop_products FROM site_settings WHERE id=1 FOR UPDATE"
      );
      if (!locked.rows.length) throw new Error("Productcatalogus niet gevonden.");
      const data = {
        phones: Array.isArray(locked.rows[0].phones) ? locked.rows[0].phones : [],
        shopProducts: Array.isArray(locked.rows[0].shop_products) ? locked.rows[0].shop_products : []
      };
      const catalogKey = itemType === "shop" ? "shopProducts" : "phones";
      const catalog = Array.isArray(data[catalogKey]) ? data[catalogKey] : [];
      const productIndex = itemType === "shop"
        ? findShopProductIndex(catalog, productId)
        : findPhoneIndex(catalog, productId);
      if (productIndex < 0 || !catalog[productIndex]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Product niet gevonden. Vernieuw de voorraadpagina en probeer opnieuw." });
      }
      const product = catalog[productIndex];
      let stockOwner = product;
      let stockField = "stock";
      let variantLabel = "Standaard";
      let sku = String(product.sku || "");
      if (itemType === "shop") {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.length) {
          const variantIndex = variants.findIndex(variant => variant && String(variant.id || "") === variantId);
          if (variantIndex < 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Productoptie is gewijzigd. Vernieuw de voorraadpagina en selecteer de optie opnieuw." });
          }
          stockOwner = variants[variantIndex];
          variantLabel = String(stockOwner.quality || "Standaard");
          sku = String(stockOwner.sku || sku);
          if (stockOwner.active === false && delta < 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Deze productoptie is uitgeschakeld en kan niet als verkoop worden afgeboekt." });
          }
        } else if (variantId) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "Productoptie is gewijzigd. Vernieuw de voorraadpagina." });
        }
      } else {
        const variants = Array.isArray(product.variantPrices) ? product.variantPrices : [];
        if (variants.length) {
          const variantIndex = Number(body.variantIndex);
          if (!Number.isInteger(variantIndex) || variantIndex < 0 || variantIndex >= variants.length ||
              phoneVariantKey(variants[variantIndex]) !== variantKey) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Telefoonuitvoering is gewijzigd. Vernieuw de voorraadpagina en selecteer de uitvoering opnieuw." });
          }
          stockOwner = variants[variantIndex];
          stockField = "stock";
          variantLabel = [stockOwner.storage, stockOwner.color, stockOwner.condition].filter(Boolean).join(" · ") || "Uitvoering " + (variantIndex + 1);
          sku = String(stockOwner.sku || sku);
          if (stockOwner.available === false && delta < 0) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Deze telefoonuitvoering is niet beschikbaar voor verkoop." });
          }
        } else if ((body.variantIndex !== undefined && Number(body.variantIndex) !== -1) || variantKey) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "Telefoonproduct is gewijzigd. Vernieuw de voorraadpagina." });
        }
      }

      let currentStockValue = stockOwner[stockField];
      if (itemType === "shop" && stockOwner === product) {
        const rawStock = String(currentStockValue ?? "").trim();
        const match = rawStock.match(/^(\d+)/);
        if (!rawStock) {
          // An empty stock field is an untracked item; its first delivery
          // establishes the opening balance instead of blocking the user.
          currentStockValue = 0;
        } else if (!match) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "De bestaande Shop-voorraad is geen geldig getal. Corrigeer eerst de voorraadwaarde in het product." });
        } else {
          currentStockValue = match[1];
        }
      }
      let stockBefore;
      try {
        stockBefore = numericStock(currentStockValue, "De huidige voorraad");
      } catch (stockError) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: stockError.message });
      }
      const stockAfter = stockBefore + delta;
      if (stockAfter < 0 || stockAfter > 2147483647) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: stockAfter < 0
            ? "Onvoldoende voorraad. Huidige voorraad: " + stockBefore + " stuks."
            : "De nieuwe voorraad is groter dan de maximaal toegestane waarde."
        });
      }
      if (itemType === "shop" && stockOwner !== product) {
        stockOwner.stock = String(stockAfter);
        const variants = Array.isArray(product.variants) ? product.variants : [];
        const variantIndex = variants.indexOf(stockOwner);
        if (variantIndex === 0) product.stock = String(stockAfter) + " stuks";
      } else if (itemType === "shop") {
        stockOwner.stock = String(stockAfter) + " stuks";
      } else {
        stockOwner.stock = stockAfter;
      }

      const productName = String(product.name || "Product").slice(0, 200);
      const actor = String(req.admin?.username || req.admin?.email || "Admin").slice(0, 120);
      await client.query(
        catalogKey === "shopProducts"
          ? "UPDATE site_settings SET data=jsonb_set(data,'{shopProducts}',$1::jsonb,true) WHERE id=1"
          : "UPDATE site_settings SET data=jsonb_set(data,'{phones}',$1::jsonb,true) WHERE id=1",
        [JSON.stringify(catalog)]
      );
      const inserted = await client.query(
        "INSERT INTO inventory_movements(item_type,product_id,variant_id,product_name,variant_label,sku,movement_type,quantity,stock_before,stock_after,reference,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id,item_type,product_id,variant_id,product_name,variant_label,sku,movement_type,quantity,stock_before,stock_after,reference,note,created_by,created_at",
        [itemType, productId, variantId || variantKey, productName, variantLabel, sku, movementType, delta, stockBefore, stockAfter, reference, note, actor]
      );
      await client.query("COMMIT");
      return res.status(201).json({ success: true, stock: stockAfter, movement: inserted.rows[0] });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("Admin inventory movement failed:", error);
      return res.status(500).json({ error: error.message || "Voorraadmutatie opslaan is mislukt." });
    } finally {
      client.release();
    }
  });
}

module.exports = { registerAdminInventoryRoutes, inventoryCatalog, phoneVariantKey };
