"use strict";

// Public Easy Unlocker storefront: lists the services the owner picked and
// stores customer requests. Nothing here talks to the supplier or takes payment;
// the owner handles each request manually from the admin page.

const { createBoundedRateLimiter } = require("../utils/bounded-rate-limit");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = ["new", "paid", "done", "cancelled"];

async function ensureEasyUnlockerRequestSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eu_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eu_requests (
      id BIGSERIAL PRIMARY KEY,
      product_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      price_eur NUMERIC(12,2),
      customer_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS eu_requests_created_idx ON eu_requests (created_at DESC)",
  );
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanRate(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number) || number <= 0 || number > 10) return null;
  return Math.round(number * 10000) / 10000;
}

// Sale price in EUR, or null while no USD→EUR rate is configured.
function salePriceEur(price, marginPercent, rate) {
  if (!rate) return null;
  const base = Number(price) * (1 + Number(marginPercent || 0) / 100) * rate;
  if (!Number.isFinite(base)) return null;
  return Math.round(base * 100) / 100;
}

function publicService(row, rate) {
  return {
    id: row.product_id,
    name: row.name,
    categoryName: row.category_name,
    imageUrl: row.image_url,
    priceEur: salePriceEur(row.price, row.margin_percent, rate),
    fields: (Array.isArray(row.fields) ? row.fields : []).map((f) => ({
      name: f.name,
      type: f.type,
      required: Boolean(f.required),
    })),
  };
}

async function readRate(queryWithConnectionRetry) {
  const result = await queryWithConnectionRetry(
    "SELECT value FROM eu_config WHERE key = 'usd_eur_rate'",
    [],
    3,
  );
  return cleanRate(result.rows[0] && result.rows[0].value);
}

function registerEasyUnlockerPublicRoutes(
  app,
  { requirePermission, queryWithConnectionRetry },
) {
  const permission = requirePermission("site.save");
  const allow = createBoundedRateLimiter({
    windowMs: 60 * 60 * 1000,
    maxRequests: 8,
    maxEntries: 5000,
  });
  const clientIp = (req) =>
    String(req.ip || "unknown").split(",")[0].trim();

  app.get("/api/easy-unlocker/services", async (_req, res) => {
    try {
      const rate = await readRate(queryWithConnectionRetry);
      const result = await queryWithConnectionRetry(
        `SELECT * FROM eu_services
          WHERE published = TRUE AND in_catalog = TRUE
          ORDER BY category_name, name`,
        [],
        3,
      );
      res.set("Cache-Control", "no-store");
      return res.json({ services: result.rows.map((r) => publicService(r, rate)) });
    } catch (error) {
      console.error("[EASY UNLOCKER] public list failed:", error);
      return res.status(503).json({ error: "Diensten konden niet worden geladen." });
    }
  });

  app.post("/api/easy-unlocker/requests", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      // Honeypot: bots fill hidden fields.
      if (body.website) return res.json({ ok: true });
      if (!allow(clientIp(req))) {
        return res.status(429).json({ error: "Te veel aanvragen. Probeer het later opnieuw." });
      }
      const name = cleanText(body.name, 120);
      const email = cleanText(body.email, 254).toLowerCase();
      const phone = cleanText(body.phone, 60);
      if (name.length < 2) return res.status(400).json({ error: "Vul uw naam in." });
      if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
      }
      const serviceId = cleanText(body.serviceId, 40);
      const found = await queryWithConnectionRetry(
        "SELECT * FROM eu_services WHERE product_id = $1 AND published = TRUE AND in_catalog = TRUE",
        [serviceId],
        3,
      );
      const service = found.rows[0];
      if (!service) return res.status(404).json({ error: "Deze dienst is niet beschikbaar." });

      const input = body.fields && typeof body.fields === "object" ? body.fields : {};
      const fields = {};
      for (const def of Array.isArray(service.fields) ? service.fields : []) {
        const key = cleanText(def.name, 80);
        if (!key) continue;
        const value = cleanText(input[key], 200);
        if (def.required && !value) {
          return res.status(400).json({ error: "Vul het veld '" + key + "' in." });
        }
        if (value) fields[key] = value;
      }

      const rate = await readRate(queryWithConnectionRetry);
      const price = salePriceEur(service.price, service.margin_percent, rate);
      await queryWithConnectionRetry(
        `INSERT INTO eu_requests
           (product_id, service_name, price_eur, customer_name, email, phone, fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [service.product_id, service.name, price, name, email, phone, JSON.stringify(fields)],
        3,
      );
      return res.status(201).json({
        ok: true,
        message: "Bedankt! Uw aanvraag is ontvangen. We nemen contact met u op over de betaling.",
      });
    } catch (error) {
      console.error("[EASY UNLOCKER] request failed:", error);
      return res.status(500).json({ error: "Versturen is niet gelukt. Probeer het opnieuw." });
    }
  });

  app.get("/api/admin/easy-unlocker/rate", permission, async (_req, res) => {
    try {
      return res.json({ rate: await readRate(queryWithConnectionRetry) });
    } catch (error) {
      console.error("[EASY UNLOCKER] rate read failed:", error);
      return res.status(500).json({ error: "Koers laden mislukt." });
    }
  });

  app.put("/api/admin/easy-unlocker/rate", permission, async (req, res) => {
    try {
      const rate = cleanRate(req.body && req.body.rate);
      if (rate === null) {
        return res.status(400).json({ error: "Koers moet een getal tussen 0 en 10 zijn, bijvoorbeeld 0,86." });
      }
      await queryWithConnectionRetry(
        `INSERT INTO eu_config (key, value) VALUES ('usd_eur_rate', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(rate)],
        3,
      );
      return res.json({ rate });
    } catch (error) {
      console.error("[EASY UNLOCKER] rate save failed:", error);
      return res.status(500).json({ error: "Opslaan mislukt." });
    }
  });

  app.get("/api/admin/easy-unlocker/requests", permission, async (_req, res) => {
    try {
      const result = await queryWithConnectionRetry(
        "SELECT * FROM eu_requests ORDER BY created_at DESC LIMIT 200",
        [],
        3,
      );
      return res.json({
        requests: result.rows.map((r) => ({
          id: String(r.id),
          serviceName: r.service_name,
          priceEur: r.price_eur === null ? null : Number(r.price_eur),
          name: r.customer_name,
          email: r.email,
          phone: r.phone,
          fields: r.fields || {},
          status: r.status,
          createdAt: r.created_at,
        })),
      });
    } catch (error) {
      console.error("[EASY UNLOCKER] requests list failed:", error);
      return res.status(500).json({ error: "Aanvragen laden mislukt." });
    }
  });

  app.patch("/api/admin/easy-unlocker/requests/:id", permission, async (req, res) => {
    try {
      const id = String(req.params.id || "");
      const status = String(req.body && req.body.status);
      if (!/^\d{1,18}$/.test(id) || !STATUSES.includes(status)) {
        return res.status(400).json({ error: "Ongeldige status." });
      }
      const result = await queryWithConnectionRetry(
        "UPDATE eu_requests SET status = $2 WHERE id = $1 RETURNING id",
        [id, status],
        3,
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Aanvraag niet gevonden." });
      return res.json({ ok: true });
    } catch (error) {
      console.error("[EASY UNLOCKER] request update failed:", error);
      return res.status(500).json({ error: "Opslaan mislukt." });
    }
  });
}

module.exports = {
  registerEasyUnlockerPublicRoutes,
  ensureEasyUnlockerRequestSchema,
  salePriceEur,
  cleanRate,
};
