"use strict";

function registerAdminBuybackOrderRoutes(app, {
  pool,
  requirePermission,
  ensureBuybackOrdersTable,
  escapeHtml,
  getEnv = () => process.env,
  fetchImpl = fetch
}) {
  app.get("/api/admin/buyback-orders", requirePermission("buyback_orders.view"), async (req, res) => {
    try {
      await ensureBuybackOrdersTable(pool);
      const result = await pool.query(`
        SELECT id,order_no,name,email,phone,address,device,brand,model,storage,condition,
               face_id,battery,screen,offered_price,iban,payment_method,answers,trade_in,trade_in_linked_order_id,final_offer,final_offer_sent_at,status,created_at
        FROM buyback_orders
        WHERE status NOT IN ('Wacht op aankoop', 'Wacht op betaling')
        ORDER BY created_at DESC
      `);
      res.json({ orders: result.rows });
    } catch (error) {
      console.error("BUYBACK LOAD ERROR:", error);
      res.status(500).json({ error: "Verkoopaanvragen konden niet worden geladen." });
    }
  });

  app.put("/api/admin/buyback-orders/:id/offer", requirePermission("buyback_orders.update"), async (req, res) => {
    try {
      const offer = Number(req.body?.finalOffer);
      if (!Number.isFinite(offer) || offer < 0 || offer > 1000000) {
        return res.status(400).json({ error: "Vul een geldig definitief bedrag in." });
      }
      const found = await pool.query("SELECT id,order_no,name,email,device FROM buyback_orders WHERE id=$1", [req.params.id]);
      if (!found.rows.length) return res.status(404).json({ error: "Verkoopaanvraag niet gevonden." });
      const order = found.rows[0];
      const env = getEnv();
      const apiKey = env.RESEND_API_KEY;
      const from = env.RESEND_FROM_EMAIL;
      if (!apiKey || !from) return res.status(503).json({ error: "E-mail is niet ingesteld. Controleer RESEND_API_KEY en RESEND_FROM_EMAIL." });
      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [order.email],
          subject: "Uw definitieve prijsvoorstel van HOMS TECH – " + order.order_no,
          reply_to: "mail@inbound.homs-tech.nl",
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#1f2937;line-height:1.6">
            <h2 style="color:#0f2740">Uw prijsvoorstel is klaar</h2>
            <p>Beste ${escapeHtml(order.name)},</p>
            <p>Na beoordeling van uw ${escapeHtml(order.device)} bieden wij u definitief:</p>
            <p style="font-size:30px;font-weight:800;color:#2563eb">€ ${offer.toFixed(2)}</p>
            <p>Dit aanbod is gebaseerd op de door u verstrekte informatie en onze beoordeling. Wilt u akkoord gaan? Beantwoord dan deze e-mail of neem contact met ons op.</p>
            <p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p>
          </div>`
        })
      });
      const mailData = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("Resend " + response.status + ": " + JSON.stringify(mailData));
      const updated = await pool.query(
        "UPDATE buyback_orders SET final_offer=$1,final_offer_sent_at=NOW(),status='Aanbod verzonden' WHERE id=$2 RETURNING id,status,final_offer,final_offer_sent_at",
        [offer, req.params.id]
      );
      res.json({ success: true, order: updated.rows[0] });
    } catch (error) {
      console.error("BUYBACK OFFER EMAIL ERROR:", error);
      res.status(500).json({ error: "Het prijsvoorstel kon niet worden verstuurd. " + String(error.message || "") });
    }
  });

  app.put("/api/admin/buyback-orders/:id/status", requirePermission("buyback_orders.update"), async (req, res) => {
    try {
      const allowed = ["Nieuw", "In behandeling", "Aanbod verzonden", "Goedgekeurd", "Afgewezen", "Voltooid"];
      const status = String(req.body?.status || "").trim();
      if (!allowed.includes(status)) return res.status(400).json({ error: "Ongeldige status." });
      const result = await pool.query(`
        UPDATE buyback_orders
        SET status=$1
        WHERE id=$2
        RETURNING id,status
      `, [status, req.params.id]);
      if (!result.rows.length) return res.status(404).json({ error: "Verkoopaanvraag niet gevonden." });
      res.json({ success: true, order: result.rows[0] });
    } catch (error) {
      console.error("BUYBACK STATUS ERROR:", error);
      res.status(500).json({ error: "Status kon niet worden gewijzigd." });
    }
  });

  app.delete("/api/admin/buyback-orders/:id", requirePermission("buyback_orders.delete"), async (req, res) => {
    try {
      const result = await pool.query(
        "DELETE FROM buyback_orders WHERE id=$1 RETURNING id",
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Verkoopaanvraag niet gevonden." });
      res.json({ success: true });
    } catch (error) {
      console.error("BUYBACK DELETE ERROR:", error);
      res.status(500).json({ error: "Verkoopaanvraag kon niet worden verwijderd." });
    }
  });
}

module.exports = { registerAdminBuybackOrderRoutes };
