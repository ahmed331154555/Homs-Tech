"use strict";

const crypto = require("crypto");

function offerResponsePage(res, title, message, options = {}) {
  const esc = value => String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const redirectUrl = options.redirectUrl === "https://homs-tech.nl" ? options.redirectUrl : "";
  const redirectDelay = redirectUrl ? 5 : 0;
  const redirectNotice = redirectUrl
    ? '<p style="margin-top:20px;font-size:14px;color:#718096">U wordt over 5 seconden automatisch teruggestuurd naar HOMS TECH…</p><p><a href="https://homs-tech.nl" style="color:#1559a6;font-weight:700">Nu terug naar de website</a></p>'
    : "";
  const redirectMeta = redirectUrl ? '<meta http-equiv="refresh" content="5;url=https://homs-tech.nl">' : "";
  const redirectScript = redirectUrl ? '<script>window.setTimeout(function(){window.location.replace("https://homs-tech.nl");},5000);</script>' : "";
  res.status(200).type("html").send(
    '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + redirectMeta + '<title>' +
    esc(title) + ' · HOMS TECH</title><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f3f6fa;color:#172b3d;font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}main{width:100%;max-width:520px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 12px 36px rgba(15,35,55,.08)}.brand{font-weight:700;color:#1559a6;letter-spacing:.04em;font-size:13px;margin-bottom:18px}h1{font-size:24px;margin:0 0 12px}p{line-height:1.6;color:#526579}.price{font-size:30px;font-weight:800;color:#1559a6;margin:18px 0}.actions{display:grid;gap:12px;margin-top:26px}button{border:0;border-radius:10px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;width:100%}.accept{background:#176b45;color:white}.reject{background:#fff;color:#a12d36;border:1px solid #e4b8bd}small{display:block;color:#718096;margin-top:18px;line-height:1.5}</style></head><body><main><div class="brand">HOMS TECH</div><h1>' +
    esc(title) + '</h1><p>' + esc(message) + '</p>' + redirectNotice + '</main>' + redirectScript + '</body></html>'
  );
}

function registerAdminOrderRoutes(app, { pool, requirePermission, escapeHtml, fetchImpl = global.fetch, getEnv = () => process.env }) {
  // GET only displays the choice page. The customer decision is recorded by POST,
  // preventing email security scanners from accidentally accepting/rejecting offers.
  app.get("/repair-offer-response/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const token = String(req.query.token || "");
      if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{64}$/i.test(token)) return offerResponsePage(res, "Ongeldige link", "Deze link is niet geldig. Neem contact op met HOMS TECH.");
      const result = await pool.query("SELECT extra_fields FROM service_orders WHERE id = $1", [id]);
      if (!result.rows.length) return offerResponsePage(res, "Aanvraag niet gevonden", "We konden deze reparatieaanvraag niet vinden.");
      let meta = {};
      try { meta = typeof result.rows[0].extra_fields === "string" ? JSON.parse(result.rows[0].extra_fields || "{}") : (result.rows[0].extra_fields || {}); } catch {}
      const offer = meta.offer || {};
      const candidate = crypto.createHash("sha256").update(token).digest("hex");
      const stored = String(offer.responseTokenHash || "");
      const valid = /^[a-f0-9]{64}$/i.test(stored) && crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(stored, "hex"));
      if (!valid || !offer.responseTokenExpiresAt || new Date(offer.responseTokenExpiresAt).getTime() < Date.now()) return offerResponsePage(res, "Link verlopen", "Deze offerte-link is niet meer geldig. Neem contact op met HOMS TECH voor hulp.");
      if (offer.responseStatus !== "pending") return offerResponsePage(res, "Keuze al ontvangen", "Uw keuze voor deze offerte is al geregistreerd. Bedankt voor uw reactie.");
      const esc = value => String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
      const device = meta.brand ? meta.brand + " " + (meta.model || "") : "uw reparatie";
      const requestedDecision = String(req.query.decision || "");
      const decisionButtons = requestedDecision === "accepted"
        ? '<button class="accept" type="submit" name="decision" value="accepted">✓ Bevestig acceptatie</button>'
        : requestedDecision === "rejected"
          ? '<button class="reject" type="submit" name="decision" value="rejected">✕ Bevestig afwijzing</button>'
          : '<button class="accept" type="submit" name="decision" value="accepted">✓ Ik accepteer de offerte</button><button class="reject" type="submit" name="decision" value="rejected">✕ Ik wijs de offerte af</button>';
      res.status(200).type("html").send(
        '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reparatieofferte · HOMS TECH</title>' +
        '<style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f3f6fa;color:#172b3d;font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}main{width:100%;max-width:520px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:28px;box-shadow:0 12px 36px rgba(15,35,55,.08)}.brand{font-weight:700;color:#1559a6;letter-spacing:.04em;font-size:13px;margin-bottom:18px}h1{font-size:24px;margin:0 0 12px}.price{font-size:30px;font-weight:800;color:#1559a6;margin:18px 0}p{line-height:1.6;color:#526579}.actions{display:grid;gap:12px;margin-top:26px}button{border:0;border-radius:10px;padding:16px;font-size:16px;font-weight:700;cursor:pointer;width:100%}.accept{background:#176b45;color:white}.reject{background:#fff;color:#a12d36;border:1px solid #e4b8bd}small{display:block;color:#718096;margin-top:18px;line-height:1.5}</style></head><body><main><div class="brand">HOMS TECH</div><h1>Uw reparatieofferte</h1><p>U reageert op de offerte voor <strong>' +
        esc(device) + '</strong>.</p><div class="price">€ ' + esc(offer.price) + '</div><p>Geschatte duur: ' + esc(offer.duration || "In overleg") +
        '<br>Offerte geldig: ' + esc(offer.validity || "14 dagen") + '</p><p>Kies hieronder of u akkoord gaat met de reparatieofferte.</p>' +
        '<form method="post" action="/api/repair-offers/respond"><input type="hidden" name="id" value="' + id + '"><input type="hidden" name="token" value="' + esc(token) + '">' +
        '<div class="actions">' + decisionButtons + '</div></form>' +
        '<small>Uw keuze wordt direct aan HOMS TECH doorgegeven.</small></main></body></html>'
      );
    } catch (error) {
      console.error("[REPAIR OFFER RESPONSE] Page failed:", error);
      return offerResponsePage(res, "Er ging iets mis", "Probeer het later opnieuw of neem contact op met HOMS TECH.");
    }
  });

  app.post("/api/repair-offers/respond", async (req, res) => {
    try {
      const id = Number(req.body && req.body.id);
      const token = String((req.body && req.body.token) || "");
      const decision = String((req.body && req.body.decision) || "");
      if (!Number.isSafeInteger(id) || id < 1 || !/^[a-f0-9]{64}$/i.test(token) || !["accepted", "rejected"].includes(decision)) return offerResponsePage(res, "Ongeldige reactie", "Uw reactie kon niet worden verwerkt. Controleer de link en probeer opnieuw.");
      const result = await pool.query("SELECT id, name, email, service_name, service_category, extra_fields FROM service_orders WHERE id = $1", [id]);
      if (!result.rows.length) return offerResponsePage(res, "Aanvraag niet gevonden", "We konden deze reparatieaanvraag niet vinden.");
      const order = result.rows[0];
      const category = String(order.service_category || "").trim().toLowerCase();
      if (category !== "reparatie" && category !== "repair") return offerResponsePage(res, "Ongeldige aanvraag", "Deze link hoort niet bij een reparatieaanvraag.");
      let meta = {};
      try { meta = typeof order.extra_fields === "string" ? JSON.parse(order.extra_fields || "{}") : (order.extra_fields || {}); } catch {}
      const offer = meta.offer || {};
      const candidate = crypto.createHash("sha256").update(token).digest("hex");
      const stored = String(offer.responseTokenHash || "");
      const valid = /^[a-f0-9]{64}$/i.test(stored) && crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(stored, "hex"));
      if (!valid || !offer.responseTokenExpiresAt || new Date(offer.responseTokenExpiresAt).getTime() < Date.now()) return offerResponsePage(res, "Link verlopen", "Deze offerte-link is niet meer geldig. Neem contact op met HOMS TECH.");
      if (offer.responseStatus !== "pending") return offerResponsePage(res, "Keuze al ontvangen", "Uw keuze is al geregistreerd. Bedankt voor uw reactie.");
      const accepted = decision === "accepted";
      const newStatus = accepted ? "Akkoord door klant" : "Afgewezen door klant";
      offer.responseStatus = decision;
      offer.respondedAt = new Date().toISOString();
      meta.offer = offer;
      const saved = await pool.query("UPDATE service_orders SET status = $1, extra_fields = $2 WHERE id = $3 RETURNING id", [newStatus, JSON.stringify(meta), id]);
      if (!saved.rows.length) return offerResponsePage(res, "Aanvraag niet gevonden", "We konden uw reactie niet opslaan.");
      const env = typeof getEnv === "function" ? getEnv() || {} : {};
      const notifyEmail = String(env.REPAIR_REQUEST_EMAIL || env.ORDER_NOTIFICATION_EMAIL || "").trim();
      if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && notifyEmail && typeof fetchImpl === "function") {
        try {
          const safe = typeof escapeHtml === "function" ? escapeHtml : value => String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
          const notifyHtml = '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#203449;line-height:1.6"><h2>Reactie op reparatieofferte #' + id + '</h2><p>De klant heeft de offerte <strong>' + (accepted ? "geaccepteerd" : "afgewezen") + '</strong>.</p><p><b>Klant:</b> ' + safe(order.name || "-") + '<br><b>E-mail:</b> ' + safe(order.email || "-") + '<br><b>Toestel:</b> ' + safe(order.service_name || "-") + '<br><b>Offerte:</b> € ' + safe(offer.price || "-") + '<br><b>Status:</b> ' + safe(newStatus) + '</p><p>Open de HOMS TECH-admin om de aanvraag verder af te handelen.</p></div>';
          const mailResponse = await fetchImpl("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [notifyEmail], subject: "HOMS TECH — klant heeft offerte #" + id + (accepted ? " geaccepteerd" : " afgewezen"), html: notifyHtml }) });
          if (!mailResponse.ok) console.error("[REPAIR OFFER RESPONSE] Admin notification failed:", mailResponse.status, await mailResponse.text().catch(() => ""));
        } catch (mailError) { console.error("[REPAIR OFFER RESPONSE] Admin notification error:", mailError); }
      } else {
        console.error("[REPAIR OFFER RESPONSE] Admin notification skipped: Resend or REPAIR_REQUEST_EMAIL/ORDER_NOTIFICATION_EMAIL is not configured.");
      }
      return offerResponsePage(res, accepted ? "Bedankt voor uw akkoord!" : "Uw afwijzing is ontvangen", accepted
        ? "U heeft de reparatieofferte geaccepteerd. HOMS TECH neemt contact met u op om de reparatie verder af te stemmen."
        : "U heeft de reparatieofferte afgewezen. HOMS TECH is hiervan op de hoogte.",
        accepted ? { redirectUrl: "https://homs-tech.nl" } : {});
    } catch (error) {
      console.error("[REPAIR OFFER RESPONSE] Submission failed:", error);
      return offerResponsePage(res, "Er ging iets mis", "Uw reactie kon niet worden verwerkt. Neem contact op met HOMS TECH.");
    }
  });

  app.get("/api/admin/orders", requirePermission("orders.view"), async (req, res) => {
    try {
      const result = await pool.query(
        \`SELECT id, customer_id, service_category, service_name, service_group, price, price_currency, source_price, source_currency, service_instructions, required_fields,
                CASE
                  WHEN extra_fields LIKE '%"repairQuote":true%' AND extra_fields LIKE '%"dataUrl"%'
                  THEN regexp_replace(
                    extra_fields,
                    '("dataUrl"[[:space:]]*:[[:space:]]*")[^"]*(")',
                    '\\1\\2',
                    'g'
                  )
                  ELSE extra_fields
                END AS extra_fields,
                service_source_id, service_source_url, name, email, phone, username, imei, notes, status, provider_reference, execution_note, result_data, execution_updated_at, created_at
         FROM service_orders
         WHERE LOWER(service_category) IN ('reparatie','repair')
         ORDER BY created_at DESC`
      );

      const sanitizedOrders = result.rows.map(order => {
        if (!order.extra_fields) return order;
        try {
          const meta = JSON.parse(order.extra_fields);
          if (meta.repairQuote === true && Array.isArray(meta.photos)) {
            const sanitizedPhotos = meta.photos.map((p, index) => ({
              name: p.name || `foto-${index + 1}`,
              type: p.type || "image/jpeg",
              url: `/api/admin/repair-requests/${order.id}/photos/${index}`
            }));
            return {
              ...order,
              extra_fields: JSON.stringify({ ...meta, photos: sanitizedPhotos })
            };
          }
        } catch {}
        return order;
      });

      res.json({ orders: sanitizedOrders });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Bestellingen konden niet worden geladen." });
    }
  });

  app.get("/api/admin/repair-requests/:id/photos/:index", requirePermission("orders.view"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const index = Number(req.params.index);
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(index) || index < 0) {
        return res.status(400).send("Ongeldig verzoek.");
      }
      const result = await pool.query("SELECT extra_fields FROM service_orders WHERE id = $1", [id]);
      if (!result.rows.length) return res.status(404).send("Aanvraag niet gevonden.");

      let meta = {};
      try { meta = JSON.parse(result.rows[0].extra_fields || "{}"); } catch {}
      const photos = Array.isArray(meta.photos) ? meta.photos : [];
      const photo = photos[index];
      if (!photo || !photo.dataUrl) return res.status(404).send("Foto niet gevonden.");

      const match = String(photo.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return res.status(400).send("Fotoformaat ongeldig.");
      const contentType = match[1];
      const buffer = Buffer.from(match[2], "base64");
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "private, max-age=86400");
      res.send(buffer);
    } catch (err) {
      console.error("Photo serve error:", err);
      res.status(500).send("Foto kon niet worden geladen.");
    }
  });

  // Save a repair quote first, then send the customer email through Resend.
  app.post("/api/admin/repair-requests/:id/offer", requirePermission("orders.update"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
      }

      const priceInput = String(req.body?.price ?? "").trim().replace(",", ".");
      if (!/^\d+(?:\.\d{1,2})?$/.test(priceInput)) {
        return res.status(400).json({ error: "Vul een geldige prijs in (tussen 0 en 100.000)." });
      }
      const price = Number(priceInput);
      if (!Number.isFinite(price) || price < 0 || price > 100000) {
        return res.status(400).json({ error: "Vul een geldige prijs in (tussen 0 en 100.000)." });
      }

      const message = String(req.body?.message || "").trim().slice(0, 3000);
      const validity = String(req.body?.validity || "14 dagen").trim().slice(0, 80);
      const duration = String(req.body?.duration || "In overleg").trim().slice(0, 120);
      if (!message) return res.status(400).json({ error: "Vul een bericht aan de klant in." });

      const found = await pool.query(
        "SELECT id, name, email, service_category, service_name, notes, extra_fields FROM service_orders WHERE id = $1",
        [id]
      );
      if (!found.rows.length) return res.status(404).json({ error: "Aanvraag niet gevonden." });

      const order = found.rows[0];
      let meta = {};
      try {
        const parsed = typeof order.extra_fields === "string"
          ? JSON.parse(order.extra_fields || "{}")
          : order.extra_fields;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) meta = parsed;
      } catch {
        return res.status(409).json({ error: "De aanvraaggegevens zijn beschadigd en kunnen niet veilig worden bijgewerkt." });
      }
      // Accept both dedicated repair-quote form submissions and ordinary
      // repair bookings created from the repair page. The route is scoped to
      // service_orders, but still verify the category before allowing an offer.
      const serviceCategory = String(order.service_category || "").trim().toLowerCase();
      const isRepairOrder = serviceCategory === "reparatie" || serviceCategory === "repair";
      if (!isRepairOrder) {
        return res.status(400).json({ error: "Een offerte kan alleen voor een reparatieaanvraag worden verstuurd." });
      }

      const formattedPrice = price.toLocaleString("nl-NL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      const responseToken = crypto.randomBytes(32).toString("hex");
      const offer = {
        price: formattedPrice,
        rawPrice: price.toFixed(2),
        message,
        validity,
        duration,
        updatedAt: new Date().toISOString(),
        emailSent: false,
        sentAt: null,
        responseStatus: "pending",
        responseTokenHash: crypto.createHash("sha256").update(responseToken).digest("hex"),
        responseTokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
      meta.offer = offer;

      const saved = await pool.query(
        "UPDATE service_orders SET price = $1, status = 'Wacht op klant', extra_fields = $2 WHERE id = $3 RETURNING id, price, status, extra_fields",
        [formattedPrice, JSON.stringify(meta), id]
      );
      if (!saved.rows.length) return res.status(404).json({ error: "Aanvraag niet gevonden." });
      let updatedOrder = saved.rows[0];

      const env = typeof getEnv === "function" ? getEnv() || {} : {};
      if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || typeof fetchImpl !== "function") {
        return res.json({
          success: true,
          emailSent: false,
          warning: "De offerte is opgeslagen, maar e-mail is niet verzonden. Controleer RESEND_API_KEY en RESEND_FROM_EMAIL in Render.",
          order: updatedOrder
        });
      }

      const customerEmail = String(order.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        return res.json({
          success: true,
          emailSent: false,
          warning: "De offerte is opgeslagen, maar het e-mailadres van de klant ontbreekt of is ongeldig.",
          order: updatedOrder
        });
      }

      const safe = typeof escapeHtml === "function"
        ? escapeHtml
        : value => String(value).replace(/[&<>"']/g, character => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
          })[character]);
      const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#203449;line-height:1.6">
        <h2>Uw reparatieofferte van HOMS TECH</h2>
        <p>Hallo ${safe(order.name || "klant")},</p>
        <p>Bedankt voor uw reparatieaanvraag voor <strong>${safe(meta.brand || "")} ${safe(meta.model || order.service_name || "uw toestel")}</strong>.</p>
        <p><strong>Uw omschrijving:</strong><br>${safe(order.notes || "-").replace(/\r?\n/g, "<br>")}</p>
        <div style="padding:18px;background:#f1f7ff;border-radius:12px;margin:20px 0">
          <div style="font-size:14px;color:#53677d">Voorgestelde reparatieprijs</div>
          <div style="font-size:30px;font-weight:bold;color:#1459a6">€ ${formattedPrice}</div>
          <p><strong>Geschatte duur:</strong> ${safe(duration)}</p>
          <p><strong>Offerte geldig:</strong> ${safe(validity)}</p>
        </div>
        <p style="white-space:pre-wrap">${safe(message)}</p>
        <div style="margin:28px 0;padding:20px;background:#f7f9fc;border:1px solid #e2e8f0;border-radius:12px">
          <h3 style="margin:0 0 10px;color:#203449">Uw keuze</h3>
          <p style="margin:0 0 18px">Bent u akkoord met deze reparatieofferte? Open de beveiligde pagina en bevestig daar uw keuze.</p>
          <a href="${String(env.PUBLIC_SITE_URL || env.APP_URL || "https://homs-tech.nl").replace(/\/$/, "")}/repair-offer-response/${id}?token=${responseToken}&amp;decision=accepted" style="display:inline-block;background:#176b45;color:#fff;text-decoration:none;font-weight:bold;padding:14px 20px;border-radius:9px;margin:0 8px 10px 0">✓ Offerte accepteren</a>
          <a href="${String(env.PUBLIC_SITE_URL || env.APP_URL || "https://homs-tech.nl").replace(/\/$/, "")}/repair-offer-response/${id}?token=${responseToken}&amp;decision=rejected" style="display:inline-block;background:#fff;color:#a12d36;text-decoration:none;font-weight:bold;padding:13px 20px;border:1px solid #e4b8bd;border-radius:9px;margin:0 0 10px">✕ Offerte afwijzen</a>
          <p style="font-size:12px;color:#64748b;margin:14px 0 0">Na uw keuze vragen wij u deze op de beveiligde pagina nog één keer te bevestigen. Deze persoonlijke link is 30 dagen geldig.</p>
        </div>
        <p>Heeft u vragen? Beantwoord deze e-mail, dan helpen wij u verder.</p>
        <p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p>
      </div>`;

      try {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL,
            to: [customerEmail],
            subject: `HOMS TECH reparatieofferte #${id} — € ${formattedPrice}`,
            html,
            ...(env.REPAIR_REQUEST_EMAIL ? { reply_to: env.REPAIR_REQUEST_EMAIL } : {})
          })
        });
        const emailResult = await response.json().catch(() => ({}));
        if (!response.ok) {
          console.error("[REPAIR OFFER] Resend rejected email:", response.status, emailResult);
          return res.json({
            success: true,
            emailSent: false,
            warning: `De offerte is opgeslagen, maar Resend heeft de e-mail geweigerd (HTTP ${response.status}). Controleer het afzenderadres en de domeinverificatie.`,
            order: updatedOrder
          });
        }

        meta.offer.emailSent = true;
        meta.offer.sentAt = new Date().toISOString();
        meta.offer.emailId = String(emailResult.id || "");
        try {
          const finalSave = await pool.query(
            "UPDATE service_orders SET extra_fields = $1 WHERE id = $2 RETURNING id, price, status, extra_fields",
            [JSON.stringify(meta), id]
          );
          if (finalSave.rows.length) updatedOrder = finalSave.rows[0];
        } catch (saveError) {
          // Resend has already accepted the email. Never report this as an email
          // failure, otherwise the admin may resend the same offer unintentionally.
          console.error("[REPAIR OFFER] Email sent, but delivery metadata could not be saved:", saveError);
          updatedOrder = { ...updatedOrder, extra_fields: JSON.stringify(meta) };
          return res.json({
            success: true,
            emailSent: true,
            warning: "De e-mail is verzonden, maar de verzendbevestiging kon niet worden opgeslagen. Controleer Resend voordat u opnieuw verzendt.",
            order: updatedOrder
          });
        }
        return res.json({ success: true, emailSent: true, order: updatedOrder });
      } catch (mailError) {
        console.error("[REPAIR OFFER] Email delivery failed:", mailError);
        return res.json({
          success: true,
          emailSent: false,
          warning: "De offerte is opgeslagen, maar de e-mail kon niet worden verzonden. Controleer de Resend-logs.",
          order: updatedOrder
        });
      }
    } catch (error) {
      console.error("[REPAIR OFFER] Request failed:", error);
      return res.status(500).json({ error: "De offerte kon niet worden verwerkt. Controleer de serverlogs." });
    }
  });

  app.put("/api/admin/orders/:id/status", requirePermission("orders.update"), async (req, res) => {
    try {
      const allowed = ["Nieuw", "In behandeling", "Wacht op klant", "Wacht op leverancier", "Resultaat ontvangen", "Mislukt", "Voltooid", "Geannuleerd"];
      const status = String(req.body?.status || "").trim();

      if (!allowed.includes(status)) {
        return res.status(400).json({ error: "Ongeldige status." });
      }

      const result = await pool.query(
        `UPDATE service_orders SET status = $1 WHERE id = $2 RETURNING id, status`,
        [status, req.params.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: "Bestelling niet gevonden." });
      }

      res.json({ success: true, order: result.rows[0] });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Status kon niet worden gewijzigd." });
    }
  });

  app.delete("/api/admin/orders/:id", requirePermission("orders.delete"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: "Ongeldig order-ID." });
      }

      const result = await pool.query(
        "DELETE FROM service_orders WHERE id = $1 RETURNING id",
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: "Order niet gevonden." });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Delete repair request error:", error);
      res.status(500).json({ error: "Order kon niet worden verwijderd." });
    }
  });
}

module.exports = { registerAdminOrderRoutes };
