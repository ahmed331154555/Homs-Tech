"use strict";

function registerAdminOrderRoutes(app, { pool, requirePermission, escapeHtml, fetchImpl = global.fetch, getEnv = () => process.env }) {
  app.get("/api/admin/orders", requirePermission("orders.view"), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, customer_id, service_category, service_name, service_group, price, price_currency, source_price, source_currency, service_instructions, required_fields, extra_fields, service_source_id, service_source_url, name, email, phone, username, imei, notes, status, provider_reference, execution_note, result_data, execution_updated_at, created_at
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
      if (meta.repairQuote !== true) {
        return res.status(400).json({ error: "Dit is geen repair request." });
      }

      const formattedPrice = price.toLocaleString("nl-NL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      const offer = {
        price: formattedPrice,
        rawPrice: price.toFixed(2),
        message,
        validity,
        duration,
        updatedAt: new Date().toISOString(),
        emailSent: false,
        sentAt: null
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
        <p>Wilt u akkoord gaan of heeft u vragen? Beantwoord deze e-mail, dan helpen wij u verder.</p>
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
