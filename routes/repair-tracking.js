"use strict";

// Repair tracking: a status history for every repair request, internal notes,
// customer-visible messages, a public "track my repair" lookup and a manual
// "send status update" email. The history is written by a database trigger so
// every code path that changes a repair status (admin dropdown, offer flow,
// customer response) is recorded without touching those routes.

const { createBoundedRateLimiter } = require("../utils/bounded-rate-limit");

const SITE_URL = "https://homs-tech.nl";
const NOT_FOUND_MESSAGE =
  "Geen aanvraag gevonden met deze combinatie van aanvraagnummer en e-mailadres.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What the customer sees for each internal status.
const PUBLIC_LABELS = {
  Nieuw: "Aanvraag ontvangen",
  "In behandeling": "In behandeling",
  "Wacht op klant": "Wacht op uw reactie",
  "Wacht op leverancier": "Onderdeel wordt geleverd",
  "Resultaat ontvangen": "Resultaat beschikbaar",
  Mislukt: "Reparatie niet gelukt, we nemen contact op",
  Voltooid: "Voltooid",
  Geannuleerd: "Geannuleerd",
};

function publicLabel(status) {
  return PUBLIC_LABELS[status] || String(status || "");
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

async function ensureRepairTrackingSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS repair_order_events (
      id BIGSERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'status',
      status TEXT,
      note TEXT NOT NULL DEFAULT '',
      visible BOOLEAN NOT NULL DEFAULT FALSE,
      actor TEXT NOT NULL DEFAULT 'system',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS repair_order_events_order_idx ON repair_order_events (order_id, created_at)",
  );
  // The history is a convenience: never let a trigger problem stop the server.
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION homs_log_repair_status() RETURNS trigger AS $$
      BEGIN
        IF LOWER(NEW.service_category) IN ('reparatie', 'repair') THEN
          IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
            INSERT INTO repair_order_events (order_id, kind, status, visible)
            VALUES (NEW.id, 'status', NEW.status, TRUE);
          END IF;
        END IF;
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);
    await pool.query(
      "DROP TRIGGER IF EXISTS homs_repair_status_log ON service_orders",
    );
    await pool.query(`
      CREATE TRIGGER homs_repair_status_log
      AFTER INSERT OR UPDATE OF status ON service_orders
      FOR EACH ROW EXECUTE PROCEDURE homs_log_repair_status()
    `);
  } catch (error) {
    console.error("[REPAIR TRACKING] status trigger not installed:", error);
  }
}

function registerRepairTrackingRoutes(
  app,
  {
    pool,
    requirePermission,
    escapeHtml,
    fetchImpl = global.fetch,
    getEnv = () => process.env,
  },
) {
  const allow = createBoundedRateLimiter({
    windowMs: 10 * 60 * 1000,
    maxRequests: 12,
    maxEntries: 5000,
  });
  const clientIp = (req) => String(req.ip || "unknown").split(",")[0].trim();

  app.post("/api/repair/track", async (req, res) => {
    try {
      if (!allow(clientIp(req))) {
        return res
          .status(429)
          .json({ error: "Te veel pogingen. Probeer het over enkele minuten opnieuw." });
      }
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const id = Number.parseInt(String(body.requestNo || "").replace(/^#/, ""), 10);
      const email = cleanText(body.email, 254).toLowerCase();
      if (!Number.isSafeInteger(id) || id < 1 || !EMAIL_PATTERN.test(email)) {
        return res
          .status(400)
          .json({ error: "Vul uw aanvraagnummer en e-mailadres in." });
      }
      const found = await pool.query(
        `SELECT id, service_name, price, status, created_at
           FROM service_orders
          WHERE id = $1 AND LOWER(email) = $2
            AND LOWER(service_category) IN ('reparatie', 'repair')
          LIMIT 1`,
        [id, email],
      );
      const order = found.rows[0];
      if (!order) return res.status(404).json({ error: NOT_FOUND_MESSAGE });

      const events = await pool.query(
        `SELECT kind, status, note, created_at
           FROM repair_order_events
          WHERE order_id = $1 AND visible = TRUE AND kind IN ('status', 'message')
          ORDER BY created_at, id`,
        [id],
      );
      const timeline = events.rows.map((row) =>
        row.kind === "message"
          ? { type: "message", text: row.note, at: row.created_at }
          : {
              type: "status",
              status: row.status,
              label: publicLabel(row.status),
              at: row.created_at,
            },
      );
      // Requests created before tracking existed have no history yet.
      if (!timeline.some((item) => item.type === "status")) {
        timeline.unshift({
          type: "status",
          status: order.status,
          label: publicLabel(order.status),
          at: order.created_at,
        });
      }
      const price = /\d/.test(String(order.price || "")) ? String(order.price) : null;
      res.set("Cache-Control", "no-store");
      return res.json({
        requestNo: order.id,
        device: order.service_name,
        status: order.status,
        label: publicLabel(order.status),
        price,
        createdAt: order.created_at,
        timeline,
      });
    } catch (error) {
      console.error("[REPAIR TRACKING] lookup failed:", error);
      return res.status(500).json({ error: "Opzoeken is niet gelukt. Probeer het opnieuw." });
    }
  });

  const viewPermission = requirePermission("orders.view");
  const updatePermission = requirePermission("orders.update");
  const orderId = (req) => {
    const id = Number(req.params.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  app.get("/api/admin/orders/:id/events", viewPermission, async (req, res) => {
    try {
      const id = orderId(req);
      if (!id) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
      const result = await pool.query(
        `SELECT id, kind, status, note, visible, actor, created_at
           FROM repair_order_events WHERE order_id = $1
          ORDER BY created_at DESC, id DESC LIMIT 200`,
        [id],
      );
      return res.json({
        events: result.rows.map((r) => ({
          id: String(r.id),
          kind: r.kind,
          status: r.status,
          note: r.note,
          visible: Boolean(r.visible),
          actor: r.actor,
          at: r.created_at,
        })),
      });
    } catch (error) {
      console.error("[REPAIR TRACKING] events failed:", error);
      return res.status(500).json({ error: "Tijdlijn laden mislukt." });
    }
  });

  app.post("/api/admin/orders/:id/notes", updatePermission, async (req, res) => {
    try {
      const id = orderId(req);
      if (!id) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
      const note = cleanText(req.body && req.body.note, 1000);
      if (!note) return res.status(400).json({ error: "Schrijf eerst een notitie." });
      const visible = Boolean(req.body && req.body.visible === true);
      const exists = await pool.query(
        "SELECT 1 FROM service_orders WHERE id = $1 AND LOWER(service_category) IN ('reparatie', 'repair')",
        [id],
      );
      if (!exists.rows.length) return res.status(404).json({ error: "Aanvraag niet gevonden." });
      await pool.query(
        `INSERT INTO repair_order_events (order_id, kind, note, visible, actor)
         VALUES ($1, $2, $3, $4, 'admin')`,
        [id, visible ? "message" : "note", note, visible],
      );
      return res.status(201).json({ ok: true });
    } catch (error) {
      console.error("[REPAIR TRACKING] note failed:", error);
      return res.status(500).json({ error: "Opslaan mislukt." });
    }
  });

  app.post("/api/admin/orders/:id/notify", updatePermission, async (req, res) => {
    try {
      const id = orderId(req);
      if (!id) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
      const env = getEnv();
      if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
        return res.status(503).json({ error: "E-mail is niet geconfigureerd (RESEND_API_KEY / RESEND_FROM_EMAIL)." });
      }
      const found = await pool.query(
        `SELECT id, name, email, service_name, status
           FROM service_orders
          WHERE id = $1 AND LOWER(service_category) IN ('reparatie', 'repair')`,
        [id],
      );
      const order = found.rows[0];
      if (!order) return res.status(404).json({ error: "Aanvraag niet gevonden." });
      const label = publicLabel(order.status);
      const trackUrl = `${SITE_URL}/reparatie-volgen.html`;
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL,
          to: [order.email],
          subject: `HOMS TECH — status van uw reparatie #${order.id}: ${label}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#203449">
            <h2>Update over uw reparatie</h2>
            <p>Beste ${escapeHtml(order.name)},</p>
            <p>De status van uw reparatie van <b>${escapeHtml(order.service_name)}</b> (aanvraag #${order.id}) is nu:</p>
            <p style="font-size:18px"><b>${escapeHtml(label)}</b></p>
            <p>U kunt de voortgang altijd volgen met uw aanvraagnummer en e-mailadres via
            <a href="${trackUrl}">${trackUrl}</a>.</p>
            <p>Met vriendelijke groet,<br><b>HOMS TECH</b></p></div>`,
        }),
      });
      if (!response.ok) {
        return res.status(502).json({ error: `De e-mail kon niet worden verzonden (HTTP ${response.status}).` });
      }
      await pool.query(
        `INSERT INTO repair_order_events (order_id, kind, note, visible, actor)
         VALUES ($1, 'email', $2, FALSE, 'admin')`,
        [id, `Statusupdate per e-mail verzonden: ${label}`],
      );
      return res.json({ ok: true });
    } catch (error) {
      console.error("[REPAIR TRACKING] notify failed:", error);
      return res.status(500).json({ error: "Verzenden mislukt." });
    }
  });
}

module.exports = {
  registerRepairTrackingRoutes,
  ensureRepairTrackingSchema,
  publicLabel,
  PUBLIC_LABELS,
};
