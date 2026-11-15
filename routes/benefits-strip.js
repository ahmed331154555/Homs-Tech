"use strict";

const DEFAULT_BENEFITS = ["Snelle service", "Betrouwbaar", "Aan huis", "Betaalbare prijzen"];
const DEFAULT_BENEFIT_ICONS = ["⚡", "⭐", "🏠", "€"];

function normalizeBenefitsStrip(input) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const items = Array.isArray(value.items)
    ? value.items.map(item => String(item || "").trim().slice(0, 100)).filter(Boolean).slice(0, 10)
    : DEFAULT_BENEFITS;
  const icons = Array.isArray(value.icons) ? value.icons.slice(0, 10).map(icon => String(icon || "").trim().slice(0, 8)) : DEFAULT_BENEFIT_ICONS;
  const color = (candidate, fallback) => /^#[0-9a-f]{6}$/i.test(String(candidate || "")) ? String(candidate) : fallback;
  return {
    enabled: value.enabled !== false,
    items: items.length ? items : DEFAULT_BENEFITS,
    icons,
    background: color(value.background, "#ffffff"),
    textColor: color(value.textColor, "#334155"),
    accentColor: color(value.accentColor, "#2563eb"),
    speed: Math.max(20, Math.min(500, Number(value.speed) || 90)),
    direction: value.direction === "ltr" ? "ltr" : "rtl",
    mode: value.mode === "static" ? "static" : "scroll",
    fontSize: Math.max(11, Math.min(24, Number(value.fontSize) || 16)),
    fontWeight: ["400", "500", "600", "700", "800"].includes(String(value.fontWeight)) ? String(value.fontWeight) : "700",
    fontStyle: value.fontStyle === "italic" ? "italic" : "normal",
    height: Math.max(48, Math.min(120, Number(value.height) || 84))
  };
}

function registerBenefitsStripRoutes(app, { requirePermission, queryWithConnectionRetry }) {
  app.get("/api/benefits-strip", async (_req, res) => {
    try {
      const result = await queryWithConnectionRetry("SELECT data->'benefitsStrip' AS settings FROM site_settings WHERE id=1", [], 4);
      res.set("Cache-Control", "no-store");
      return res.json({ settings: normalizeBenefitsStrip(result.rows[0]?.settings) });
    } catch (error) {
      console.error("[BENEFITS STRIP] Public load failed:", error);
      return res.status(500).json({ error: "Voordelenbalk kon niet worden geladen." });
    }
  });

  app.get("/api/admin/benefits-strip", requirePermission("site.save"), async (_req, res) => {
    try {
      const result = await queryWithConnectionRetry("SELECT data->'benefitsStrip' AS settings FROM site_settings WHERE id=1", [], 4);
      res.set("Cache-Control", "no-store");
      return res.json({ settings: normalizeBenefitsStrip(result.rows[0]?.settings) });
    } catch (error) {
      console.error("[BENEFITS STRIP] Admin load failed:", error);
      return res.status(500).json({ error: "Instellingen konden niet worden geladen." });
    }
  });

  app.put("/api/admin/benefits-strip", requirePermission("site.save"), async (req, res) => {
    try {
      const settings = normalizeBenefitsStrip(req.body);
      const result = await queryWithConnectionRetry(
        "UPDATE site_settings SET data=jsonb_set(data,'{benefitsStrip}',$1::jsonb,TRUE) WHERE id=1 RETURNING data->'benefitsStrip' AS settings",
        [JSON.stringify(settings)], 4
      );
      if (!result.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, settings: normalizeBenefitsStrip(result.rows[0].settings) });
    } catch (error) {
      console.error("[BENEFITS STRIP] Admin save failed:", error);
      return res.status(500).json({ error: "Instellingen opslaan is mislukt." });
    }
  });
}

module.exports = { DEFAULT_BENEFITS, DEFAULT_BENEFIT_ICONS, normalizeBenefitsStrip, registerBenefitsStripRoutes };
