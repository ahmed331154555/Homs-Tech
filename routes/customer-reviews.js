"use strict";

const crypto = require("node:crypto");

const ORDER_TYPES = new Set(["repair", "buy", "sell"]);
const TOKEN_TTL_DAYS = 30;
const INVITE_DELAY_HOURS = 24;
const POLL_INTERVAL_MS = 5 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function safeText(value, max) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

async function ensureCustomerReviewSchema(pool) {
  await pool.query("ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS review_handed_over_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS review_delivered_at TIMESTAMPTZ");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_reviews (
      id BIGSERIAL PRIMARY KEY,
      order_type TEXT NOT NULL CHECK (order_type IN ('repair','buy','sell')),
      order_id BIGINT NOT NULL,
      customer_id INTEGER,
      customer_email TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      display_name_consent BOOLEAN NOT NULL DEFAULT FALSE,
      review_consent BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL CHECK (status IN ('pending_review','published','rejected','hidden')),
      admin_reply TEXT NOT NULL DEFAULT '',
      admin_reply_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at TIMESTAMPTZ,
      UNIQUE(order_type, order_id)
    );
    CREATE INDEX IF NOT EXISTS customer_reviews_public_idx
      ON customer_reviews(status, published_at DESC);
    CREATE INDEX IF NOT EXISTS customer_reviews_type_idx
      ON customer_reviews(order_type, status, submitted_at DESC);

    CREATE TABLE IF NOT EXISTS customer_review_invites (
      id BIGSERIAL PRIMARY KEY,
      order_type TEXT NOT NULL CHECK (order_type IN ('repair','buy','sell')),
      order_id BIGINT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_id INTEGER,
      token_hash TEXT NOT NULL UNIQUE,
      due_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      used_at TIMESTAMPTZ,
      send_attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TIMESTAMPTZ,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(order_type, order_id)
    );
    CREATE INDEX IF NOT EXISTS customer_review_invites_due_idx
      ON customer_review_invites(due_at) WHERE sent_at IS NULL AND used_at IS NULL;
  `);
}

function registerCustomerReviewRoutes(app, {
  pool,
  requirePermission,
  getEnv = () => process.env,
  fetchImpl = global.fetch
}) {
  app.get("/api/reviews", async (req, res) => {
    try {
      const type = String(req.query.type || "").trim().toLowerCase();
      const params = [];
      let filter = "";
      if (ORDER_TYPES.has(type)) {
        params.push(type);
        filter = " AND order_type = $1";
      }
      const [summary, rows] = await Promise.all([
        pool.query(
          "SELECT COUNT(*)::int AS count, COALESCE(ROUND(AVG(rating)::numeric,1),0) AS average FROM customer_reviews WHERE status='published'" + filter,
          params
        ),
        pool.query(
          "SELECT id, order_type, customer_name, rating, title, body, admin_reply, published_at FROM customer_reviews WHERE status='published'" + filter + " ORDER BY published_at DESC LIMIT 50",
          params
        )
      ]);
      res.set("Cache-Control", "no-store");
      return res.json({ summary: summary.rows[0], reviews: rows.rows });
    } catch (error) {
      console.error("[REVIEWS] Public list failed:", error);
      return res.status(500).json({ error: "Taidot konden niet worden geladen." });
    }
  });

  app.get("/api/reviews/invite/:token", async (req, res) => {
    try {
      const token = String(req.params.token || "");
      if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(404).json({ error: "Deze beoordelingslink is ongeldig." });
      const result = await pool.query(
        "SELECT order_type, expires_at, sent_at, used_at FROM customer_review_invites WHERE token_hash=$1 LIMIT 1",
        [hashToken(token)]
      );
      const invite = result.rows[0];
      if (!invite || !invite.sent_at || invite.used_at || new Date(invite.expires_at).getTime() <= Date.now()) {
        return res.status(410).json({ error: "Deze beoordelingslink is verlopen of al gebruikt." });
      }
      return res.json({ valid: true, orderType: invite.order_type });
    } catch (error) {
      console.error("[REVIEWS] Invite validation failed:", error);
      return res.status(500).json({ error: "De link kon niet worden gecontroleerd." });
    }
  });

  app.post("/api/reviews/invite/:token", async (req, res) => {
    const client = await pool.connect();
    try {
      const token = String(req.params.token || "");
      const rating = Number(req.body && req.body.rating);
      const title = safeText(req.body && req.body.title, 120);
      const body = safeText(req.body && req.body.body, 3000);
      const customerName = safeText(req.body && req.body.customerName, 120);
      const displayNameConsent = req.body && req.body.displayNameConsent === true;
      const reviewConsent = req.body && req.body.reviewConsent === true;
      if (!/^[a-f0-9]{64}$/i.test(token) || !Number.isInteger(rating) || rating < 1 || rating > 5 ||
          body.length < 10 || !customerName || !displayNameConsent || !reviewConsent) {
        return res.status(400).json({ error: "Vul uw naam, beoordeling en toelichting in en geef expliciet toestemming voor publicatie." });
      }
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT * FROM customer_review_invites WHERE token_hash=$1 FOR UPDATE",
        [hashToken(token)]
      );
      const invite = found.rows[0];
      if (!invite || !invite.sent_at || invite.used_at || new Date(invite.expires_at).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return res.status(410).json({ error: "Deze beoordelingslink is verlopen of al gebruikt." });
      }
      const status = rating <= 2 ? "pending_review" : "published";
      const saved = await client.query(
        `INSERT INTO customer_reviews
          (order_type,order_id,customer_id,customer_email,customer_name,rating,title,body,
           display_name_consent,review_consent,status,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,TRUE,$9,CASE WHEN $9='published' THEN NOW() ELSE NULL END)
         ON CONFLICT (order_type,order_id) DO NOTHING
         RETURNING id,status`,
        [invite.order_type, invite.order_id, invite.customer_id, invite.customer_email, customerName, rating, title, body, status]
      );
      if (!saved.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Voor deze bestelling is al een beoordeling ontvangen." });
      }
      await client.query("UPDATE customer_review_invites SET used_at=NOW() WHERE id=$1 AND used_at IS NULL", [invite.id]);
      await client.query("COMMIT");
      return res.status(201).json({
        success: true,
        status,
        message: status === "published"
          ? "Bedankt! Uw beoordeling is gepubliceerd."
          : "Bedankt! Uw beoordeling wordt door HOMS TECH gecontroleerd."
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[REVIEWS] Submission failed:", error);
      return res.status(500).json({ error: "Uw beoordeling kon niet worden opgeslagen." });
    } finally {
      client.release();
    }
  });

  app.get("/api/admin/reviews", requirePermission("orders.view"), async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const validStatus = ["pending_review", "published", "rejected", "hidden"].includes(status);
      const params = validStatus ? [status] : [];
      const result = await pool.query(
        "SELECT id,order_type,order_id,customer_email,customer_name,rating,title,body,status,admin_reply,submitted_at,published_at FROM customer_reviews " +
        (validStatus ? "WHERE status=$1 " : "") + "ORDER BY submitted_at DESC LIMIT 200",
        params
      );
      const [counts, summary] = await Promise.all([
        pool.query("SELECT status,COUNT(*)::int AS count FROM customer_reviews GROUP BY status"),
        pool.query("SELECT COUNT(*)::int AS count,COALESCE(ROUND(AVG(rating)::numeric,1),0) AS average FROM customer_reviews WHERE status='published'")
      ]);
      return res.json({ reviews: result.rows, counts: counts.rows, summary: summary.rows[0] });
    } catch (error) {
      console.error("[REVIEWS] Admin list failed:", error);
      return res.status(500).json({ error: "Beoordelingen konden niet worden geladen." });
    }
  });

  app.put("/api/admin/reviews/:id", requirePermission("orders.update"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const action = String(req.body && req.body.action || "");
      if (!Number.isSafeInteger(id) || id < 1 || !["publish", "reject", "hide", "reply"].includes(action)) {
        return res.status(400).json({ error: "Ongeldige beoordelingsactie." });
      }
      let result;
      if (action === "publish") {
        result = await pool.query(
          "UPDATE customer_reviews SET status='published',published_at=COALESCE(published_at,NOW()) WHERE id=$1 AND status IN ('pending_review','hidden') RETURNING id,status",
          [id]
        );
      } else if (action === "reject") {
        result = await pool.query(
          "UPDATE customer_reviews SET status='rejected' WHERE id=$1 AND status='pending_review' RETURNING id,status",
          [id]
        );
      } else if (action === "hide") {
        result = await pool.query(
          "UPDATE customer_reviews SET status='hidden' WHERE id=$1 AND status='published' RETURNING id,status",
          [id]
        );
      } else {
        const reply = safeText(req.body && req.body.reply, 2000);
        if (reply.length < 2) return res.status(400).json({ error: "Het antwoord is te kort." });
        result = await pool.query(
          "UPDATE customer_reviews SET admin_reply=$1,admin_reply_at=NOW() WHERE id=$2 AND status='published' RETURNING id,status,admin_reply",
          [reply, id]
        );
      }
      if (!result.rows.length) return res.status(404).json({ error: "Beoordeling niet gevonden of actie niet toegestaan." });
      return res.json({ success: true, review: result.rows[0] });
    } catch (error) {
      console.error("[REVIEWS] Admin update failed:", error);
      return res.status(500).json({ error: "De beoordeling kon niet worden bijgewerkt." });
    }
  });

  app.post("/api/admin/reviews/invite", requirePermission("orders.update"), async (req, res) => {
    try {
      const type = String(req.body && req.body.orderType || "").trim().toLowerCase();
      const id = Number(req.body && req.body.orderId);
      if (!ORDER_TYPES.has(type) || !Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldig ordertype of ordernummer." });
      }
      const order = await loadEligibleOrder(pool, type, id);
      if (!order) return res.status(409).json({ error: "Deze bestelling voldoet nog niet aan de voorwaarden voor een beoordeling." });
      const token = crypto.randomBytes(32).toString("hex");
      const dueAt = new Date(Date.now() + INVITE_DELAY_HOURS * 60 * 60 * 1000);
      const expiresAt = new Date(dueAt.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
      const inserted = await pool.query(
        `INSERT INTO customer_review_invites
          (order_type,order_id,customer_email,customer_name,customer_id,token_hash,due_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (order_type,order_id) DO NOTHING
         RETURNING id,due_at,expires_at`,
        [type, id, order.email, order.name, order.customer_id || null, hashToken(token), dueAt, expiresAt]
      );
      if (!inserted.rows.length) return res.status(409).json({ error: "Er bestaat al een beoordelingsuitnodiging voor deze bestelling." });
      return res.status(201).json({ success: true, dueAt: inserted.rows[0].due_at, expiresAt: inserted.rows[0].expires_at });
    } catch (error) {
      console.error("[REVIEWS] Invite creation failed:", error);
      return res.status(500).json({ error: "De beoordelingsuitnodiging kon niet worden aangemaakt." });
    }
  });

  async function loadEligibleOrder(db, type, id) {
    let sql;
    if (type === "repair") {
      sql = "SELECT id,name,email,customer_id FROM service_orders WHERE id=$1 AND LOWER(service_category) IN ('reparatie','repair') AND status='Voltooid' AND review_handed_over_at IS NOT NULL";
    } else if (type === "buy") {
      sql = "SELECT id,name,email,customer_id FROM webshop_orders WHERE id=$1 AND status='Voltooid' AND payment_status='Paid' AND review_delivered_at IS NOT NULL";
    } else {
      sql = "SELECT id,name,email,NULL::integer AS customer_id FROM buyback_orders WHERE id=$1 AND trade_in=FALSE AND status='Voltooid' AND sale_settled_at IS NOT NULL";
    }
    const result = await db.query(sql, [id]);
    return result.rows[0] || null;
  }

  app.post("/api/admin/reviews/confirm-completion", requirePermission("orders.update"), async (req, res) => {
    try {
      const type = String(req.body && req.body.orderType || "").trim().toLowerCase();
      const id = Number(req.body && req.body.orderId);
      if (!["repair", "buy"].includes(type) || !Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldig ordertype of ordernummer." });
      }
      let result;
      if (type === "repair") {
        result = await pool.query(
          "UPDATE service_orders SET review_handed_over_at=COALESCE(review_handed_over_at,NOW()) WHERE id=$1 AND LOWER(service_category) IN ('reparatie','repair') AND status='Voltooid' RETURNING id",
          [id]
        );
      } else {
        result = await pool.query(
          "UPDATE webshop_orders SET review_delivered_at=COALESCE(review_delivered_at,NOW()) WHERE id=$1 AND status='Voltooid' AND payment_status='Paid' RETURNING id",
          [id]
        );
      }
      if (!result.rows.length) return res.status(409).json({ error: "Bestelling is niet voltooid of de betaling is niet bevestigd." });
      const order = await loadEligibleOrder(pool, type, id);
      const token = crypto.randomBytes(32).toString("hex");
      const dueAt = new Date(Date.now() + INVITE_DELAY_HOURS * 60 * 60 * 1000);
      const expiresAt = new Date(dueAt.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
      const invite = await pool.query(
        `INSERT INTO customer_review_invites
          (order_type,order_id,customer_email,customer_name,customer_id,token_hash,due_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (order_type,order_id) DO NOTHING RETURNING id`,
        [type, id, order.email, order.name, order.customer_id || null, hashToken(token), dueAt, expiresAt]
      );
      if (!invite.rows.length) return res.status(409).json({ error: "Voor deze bestelling bestaat al een uitnodiging." });
      return res.status(201).json({ success: true, message: "De uitnodiging wordt 24 uur na bevestiging verzonden." });
    } catch (error) {
      console.error("[REVIEWS] Completion confirmation failed:", error);
      return res.status(500).json({ error: "De voltooiing kon niet worden bevestigd." });
    }
  });

  async function queueSettledSellInvites() {
    const candidates = await pool.query(
      `SELECT b.id,b.email,b.name,NULL::integer AS customer_id
       FROM buyback_orders b
       WHERE b.trade_in=FALSE AND b.status='Voltooid' AND b.sale_settled_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM customer_review_invites i WHERE i.order_type='sell' AND i.order_id=b.id)
         AND NOT EXISTS (SELECT 1 FROM customer_reviews r WHERE r.order_type='sell' AND r.order_id=b.id)
       UNION ALL
       SELECT b.id,b.email,b.name,NULL::integer AS customer_id
       FROM buyback_orders b
       JOIN webshop_orders w ON w.id=b.trade_in_linked_order_id
       WHERE b.trade_in=TRUE AND b.trade_in_adjustment_status='Settled' AND w.trade_in_status='Settled'
         AND NOT EXISTS (SELECT 1 FROM customer_review_invites i WHERE i.order_type='sell' AND i.order_id=b.id)
         AND NOT EXISTS (SELECT 1 FROM customer_reviews r WHERE r.order_type='sell' AND r.order_id=b.id)
       LIMIT 50`
    );
    for (const order of candidates.rows) {
      const token = crypto.randomBytes(32).toString("hex");
      const dueAt = new Date(Date.now() + INVITE_DELAY_HOURS * 60 * 60 * 1000);
      const expiresAt = new Date(dueAt.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO customer_review_invites
          (order_type,order_id,customer_email,customer_name,customer_id,token_hash,due_at,expires_at)
         VALUES ('sell',$1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (order_type,order_id) DO NOTHING`,
        [order.id, order.email, order.name, order.customer_id, hashToken(token), dueAt, expiresAt]
      );
    }
  }

  async function sendDueInvites() {
    const env = getEnv() || {};
    const apiKey = String(env.RESEND_API_KEY || "").trim();
    const from = String(env.RESEND_FROM_EMAIL || "").trim();
    const baseUrl = String(env.PUBLIC_SITE_URL || env.APP_URL || "https://homs-tech.nl").replace(/\/+$/, "");
    try { await queueSettledSellInvites(); } catch (error) { console.error("[REVIEWS] Sell invite queue failed:", error); }
    if (!apiKey || !from || typeof fetchImpl !== "function") return;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const due = await client.query(
        `SELECT id,order_type,order_id,customer_email,customer_name,token_hash
         FROM customer_review_invites
         WHERE sent_at IS NULL AND used_at IS NULL AND due_at <= NOW()
           AND expires_at > NOW() AND send_attempts < 5
           AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '10 minutes')
         ORDER BY due_at ASC
         LIMIT 10 FOR UPDATE SKIP LOCKED`
      );
      if (due.rows.length) {
        await client.query("UPDATE customer_review_invites SET claimed_at=NOW() WHERE id = ANY($1::bigint[])", [due.rows.map(row => row.id)]);
      }
      await client.query("COMMIT");
      for (const invite of due.rows) {
        // Tokens are stored only as hashes. A one-time plaintext token is created when the invite is queued.
        // If a queued invite has no recoverable token, rotate it before sending.
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = hashToken(token);
        const rotated = await pool.query(
          "UPDATE customer_review_invites SET token_hash=$1,send_attempts=send_attempts+1,claimed_at=NULL WHERE id=$2 AND sent_at IS NULL RETURNING id",
          [tokenHash, invite.id]
        );
        if (!rotated.rows.length) continue;
        const link = baseUrl + "/review.html?token=" + encodeURIComponent(token);
        const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#172b43;line-height:1.6"><div style="background:#071d2d;color:#fff;padding:20px;border-radius:12px;font-size:22px;font-weight:800">HOMS <span style="color:#60a5fa">TECH</span></div><h2>Hoe was uw ervaring?</h2><p>Beste ${escapeHtml(invite.customer_name || "klant")},</p><p>Uw bestelling bij HOMS TECH is afgerond. We horen graag hoe uw ervaring was. Het invullen duurt maar een minuut.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:13px 20px;border-radius:9px;font-weight:700">Geef uw beoordeling</a></p><p style="font-size:13px;color:#64748b">Deze persoonlijke link is 30 dagen geldig en kan één keer worden gebruikt.</p><p>Met vriendelijke groet,<br>HOMS TECH</p></div>`;
        try {
          const response = await fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [invite.customer_email], subject: "Deel uw ervaring met HOMS TECH", html })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error("Resend " + response.status + ": " + JSON.stringify(data));
          await pool.query("UPDATE customer_review_invites SET sent_at=NOW(),claimed_at=NULL,last_error='' WHERE id=$1 AND sent_at IS NULL", [invite.id]);
        } catch (error) {
          await pool.query("UPDATE customer_review_invites SET last_error=$1,claimed_at=NULL WHERE id=$2 AND sent_at IS NULL", [safeText(error.message, 500), invite.id]);
          console.error("[REVIEWS] Invite email failed:", invite.id, error.message || error);
        }
      }
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[REVIEWS] Invite worker failed:", error);
    } finally {
      client.release();
    }
  }

  return {
    ensureCustomerReviewSchema,
    startWorker() {
      const timer = setInterval(sendDueInvites, POLL_INTERVAL_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
      sendDueInvites().catch(error => console.error("[REVIEWS] Initial worker tick failed:", error));
      return timer;
    }
  };
}

module.exports = { registerCustomerReviewRoutes, ensureCustomerReviewSchema };
