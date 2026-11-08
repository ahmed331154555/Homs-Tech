"use strict";

const ANNOUNCEMENT_BAR_PAGES = new Set([
  "home",
  "about",
  "devices",
  "product",
  "repair",
  "sell",
  "prices",
  "shop",
  "account",
  "cart",
  "checkout",
  "contact",
  "payment",
  "privacy",
  "design"
]);

const DEFAULT_MESSAGES = [
  "1 jaar garantie",
  "Snel geleverd",
  "Betrouwbare service",
  "Betaalbare prijzen"
];

function normalizeAnnouncementBarSettings(input) {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  const color = (candidate, fallback) =>
    /^#[0-9a-f]{6}$/i.test(String(candidate || "")) ? String(candidate) : fallback;
  const messages = Array.isArray(value.messages) && value.messages.length
    ? value.messages
      .map(message => String(message || "").trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 8)
    : DEFAULT_MESSAGES;

  return {
    enabled: value.enabled !== false,
    messages,
    background: color(value.background, "#071d2d"),
    textColor: color(value.textColor, "#eaf4ff"),
    accentColor: color(value.accentColor, "#60a5fa"),
    speed: Math.max(20, Math.min(600, Number(value.speed) || 140)),
    direction: value.direction === "ltr" ? "ltr" : "rtl",
    mode: value.mode === "static" ? "static" : "scroll",
    height: Math.max(30, Math.min(64, Number(value.height) || 42)),
    fontSize: Math.max(10, Math.min(22, Number(value.fontSize) || 14))
  };
}

function registerAnnouncementBarRoutes(app, {
  requirePermission,
  queryWithConnectionRetry
}) {
  app.get("/api/announcement-bars", async (req, res) => {
    try {
      const page = String(req.query.page || "home").trim().toLowerCase();
      if (!ANNOUNCEMENT_BAR_PAGES.has(page)) {
        return res.status(400).json({ error: "Ongeldige pagina." });
      }

      const result = await queryWithConnectionRetry(
        "SELECT data->'announcementBars'-> $1 AS settings FROM site_settings WHERE id=1",
        [page],
        4
      );
      res.set("Cache-Control", "no-store");
      return res.json({
        settings: normalizeAnnouncementBarSettings(result.rows[0]?.settings)
      });
    } catch (error) {
      console.error("[ANNOUNCEMENT BAR] Public load failed:", error);
      return res.status(500).json({ error: "Berichtenbalk kon niet worden geladen." });
    }
  });

  app.get(
    "/api/admin/announcement-bars",
    requirePermission("site.save"),
    async (req, res) => {
      try {
        const result = await queryWithConnectionRetry(
          "SELECT data->'announcementBars' AS bars FROM site_settings WHERE id=1",
          [],
          4
        );
        res.set("Cache-Control", "no-store");
        return res.json({ bars: result.rows[0]?.bars || {} });
      } catch (error) {
        console.error("[ANNOUNCEMENT BAR] Admin load failed:", error);
        return res.status(500).json({ error: "Instellingen konden niet worden geladen." });
      }
    }
  );

  app.put(
    "/api/admin/announcement-bars/:page",
    requirePermission("site.save"),
    async (req, res) => {
      try {
        const page = String(req.params.page || "").trim().toLowerCase();
        if (!ANNOUNCEMENT_BAR_PAGES.has(page)) {
          return res.status(400).json({ error: "Ongeldige pagina." });
        }

        const settings = normalizeAnnouncementBarSettings(req.body);
        const result = await queryWithConnectionRetry(
          "UPDATE site_settings SET data=jsonb_set(data,'{announcementBars}',COALESCE(data->'announcementBars','{}'::jsonb)||jsonb_build_object($1,$2::jsonb),TRUE) WHERE id=1 RETURNING data->'announcementBars'-> $1 AS settings",
          [page, JSON.stringify(settings)],
          4
        );
        if (!result.rows.length) {
          return res.status(404).json({ error: "Website-instellingen niet gevonden." });
        }

        return res.json({
          success: true,
          settings: normalizeAnnouncementBarSettings(result.rows[0].settings)
        });
      } catch (error) {
        console.error("[ANNOUNCEMENT BAR] Admin save failed:", error);
        return res.status(500).json({ error: "Instellingen opslaan is mislukt." });
      }
    }
  );
}

module.exports = {
  normalizeAnnouncementBarSettings,
  registerAnnouncementBarRoutes
};
