"use strict";

const { normalizeDiscount } = require("../utils/discounts");

function registerAdminDiscountRoutes(app, { requirePermission, queryWithConnectionRetry }) {
  app.get("/api/admin/discounts", requirePermission("site.save"), async (_req, res) => {
    try {
      const result = await queryWithConnectionRetry(
        "SELECT data->'shopDiscounts' AS discounts, data->'shopProducts' AS shop_products, data->'phones' AS phones FROM site_settings WHERE id=1",
        [], 4
      );
      const row = result.rows[0] || {};
      const products = [
        ...(Array.isArray(row.shop_products) ? row.shop_products.map((p, i) => ({ id: String(i), name: p.name || "Product", type: "shop" })) : []),
        ...(Array.isArray(row.phones) ? row.phones.map((p, i) => ({ id: String(i), name: p.name || "Telefoon", type: "phone" })) : [])
      ];
      res.set("Cache-Control", "no-store");
      return res.json({ discounts: Array.isArray(row.discounts) ? row.discounts : [], products });
    } catch (error) {
      console.error("[ADMIN DISCOUNTS] Load failed:", error);
      return res.status(500).json({ error: "Kortingen konden niet worden geladen." });
    }
  });

  app.put("/api/admin/discounts", requirePermission("site.save"), async (req, res) => {
    try {
      const input = Array.isArray(req.body?.discounts) ? req.body.discounts : null;
      if (!input || input.length > 500) return res.status(400).json({ error: "Ongeldige kortingslijst." });
      const discounts = input.map(item => normalizeDiscount(item));
      const result = await queryWithConnectionRetry(
        "UPDATE site_settings SET data=jsonb_set(data,'{shopDiscounts}',$1::jsonb,TRUE) WHERE id=1 RETURNING data->'shopDiscounts' AS discounts",
        [JSON.stringify(discounts)], 4
      );
      if (!result.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });
      return res.json({ success: true, discounts: result.rows[0].discounts || [] });
    } catch (error) {
      return res.status(400).json({ error: error.message || "Kortingen opslaan is mislukt." });
    }
  });
}

module.exports = { registerAdminDiscountRoutes };
