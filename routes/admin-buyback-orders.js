"use strict";

function registerAdminBuybackOrderRoutes(app, {
  pool,
  requirePermission,
  ensureBuybackOrdersTable,
  escapeHtml = value => String(value ?? ""),
  crypto,
  getEnv = () => process.env,
  fetchImpl = fetch
}) {
  const safe = value => escapeHtml(String(value ?? ""));
  const money = value => Number(value || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sendMail = async ({ to, subject, html, attachments }) => {
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
      const error = new Error("E-mail is niet ingesteld. Controleer RESEND_API_KEY en RESEND_FROM_EMAIL.");
      error.code = "EMAIL_NOT_CONFIGURED";
      throw error;
    }
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.RESEND_FROM_EMAIL, to: [to], reply_to: "mail@inbound.homs-tech.nl", subject, html, ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("E-mail kon niet worden verzonden (" + response.status + ").");
    return data;
  };

  async function sendCustomerOffer(orderId) {
    await ensureBuybackOrdersTable(pool);
    const found = await pool.query(
      "SELECT id,order_no,name,email,device,sale_inspected_value,sale_inspection_reason,status FROM buyback_orders WHERE id=$1",
      [orderId]
    );
    if (!found.rows.length) {
      const error = new Error("Inkoopaanvraag niet gevonden.");
      error.status = 404;
      throw error;
    }
    const order = found.rows[0];
    if (order.sale_inspected_value === null || order.sale_inspected_value === undefined) {
      const error = new Error("Sla eerst de definitieve inspectiewaarde op.");
      error.status = 409;
      throw error;
    }
    if (["Klant akkoord", "Klant niet akkoord", "Voltooid"].includes(order.status)) {
      const error = new Error("Dit voorstel kan niet opnieuw worden verstuurd omdat de aanvraag al is afgehandeld.");
      error.status = 409;
      throw error;
    }
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const updated = await pool.query(
      "UPDATE buyback_orders SET sale_approval_token_hash=$1,sale_approval_expires_at=$2,sale_approval_decision_at=NULL,status='Aanbod verzonden' WHERE id=$3 RETURNING id,status",
      [tokenHash, expiresAt, orderId]
    );
    const approvalUrl = "https://homs-tech.nl/buyback-response.html?token=" + encodeURIComponent(token);
    try {
      await sendMail({
        to: order.email,
        subject: "Uw definitieve verkoopvoorstel van HOMS TECH – " + order.order_no,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px;color:#1f2937;line-height:1.65">
          <div style="background:#071d2d;color:#fff;padding:18px 22px;border-radius:12px;font-size:22px;font-weight:800">HOMS <span style="color:#60a5fa">TECH</span></div>
          <h2 style="color:#102d42">Uw definitieve verkoopvoorstel</h2>
          <p>Beste ${safe(order.name)},</p>
          <p>We hebben uw ${safe(order.device || "telefoon")} gecontroleerd. Op basis van de inspectie kunnen wij u het volgende bedrag aanbieden:</p>
          <p style="font-size:32px;font-weight:900;color:#15803d;margin:18px 0">€ ${money(order.sale_inspected_value)}</p>
          <p><strong>Uw aanvraag:</strong> ${safe(order.order_no)}</p>
          <p>Wilt u uw telefoon voor dit bedrag aan HOMS TECH verkopen? Kies hieronder akkoord of niet akkoord. De link is 7 dagen geldig.</p>
          <p style="margin:26px 0"><a href="${approvalUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:9px;font-weight:800">Akkoord / Niet akkoord</a></p>
          <p>Na uw akkoord maken we het afgesproken bedrag over naar het door u opgegeven rekeningnummer. U ontvangt daarna een aparte bevestiging.</p>
          <p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p>
        </div>`
      });
      return { sent: true, email: order.email, order: updated.rows[0] };
    } catch (error) {
      await pool.query(
        "UPDATE buyback_orders SET status='Aanbod klaar',sale_approval_token_hash=NULL,sale_approval_expires_at=NULL WHERE id=$1 AND sale_approval_token_hash=$2",
        [orderId, tokenHash]
      );
      throw error;
    }
  }

  async function sendPayoutConfirmation(orderId) {
    await ensureBuybackOrdersTable(pool);
    const found = await pool.query(
      "SELECT id,order_no,name,email,device,sale_inspected_value,sale_settlement_note,status FROM buyback_orders WHERE id=$1",
      [orderId]
    );
    if (!found.rows.length) {
      const error = new Error("Zelfstandige inkoopaanvraag niet gevonden.");
      error.status = 404;
      throw error;
    }
    const order = found.rows[0];
    if (order.status !== "Voltooid") {
      const error = new Error("Bevestig eerst de daadwerkelijke uitbetaling.");
      error.status = 409;
      throw error;
    }
    await sendMail({
      to: order.email,
      subject: "Uw betaling is overgemaakt – HOMS TECH " + order.order_no,
      html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px;color:#1f2937;line-height:1.65">
        <div style="background:#071d2d;color:#fff;padding:18px 22px;border-radius:12px;font-size:22px;font-weight:800">HOMS <span style="color:#60a5fa">TECH</span></div>
        <h2 style="color:#15803d">Uw verkoop is afgerond</h2>
        <p>Beste ${safe(order.name)},</p>
        <p>We bevestigen dat het afgesproken bedrag voor uw ${safe(order.device || "telefoon")} is overgemaakt.</p>
        <p style="font-size:32px;font-weight:900;color:#15803d">€ ${money(order.sale_inspected_value)}</p>
        <p><strong>Aanvraagnummer:</strong> ${safe(order.order_no)}</p>
        <p>Bedankt voor het verkopen van uw toestel aan HOMS TECH.</p>
        <p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p>
      </div>`
    });
    await pool.query("UPDATE buyback_orders SET sale_payout_email_sent_at=NOW() WHERE id=$1",[orderId]);
    return { sent: true, email: order.email };
  }

  app.get("/api/admin/buyback-orders", requirePermission("buyback_orders.view"), async (req, res) => {
    try {
      await ensureBuybackOrdersTable(pool);
      const result = await pool.query(`
        SELECT b.id,b.order_no,b.name,b.email,b.phone,b.address,b.device,b.brand,b.model,b.storage,b.condition,
               b.face_id,b.battery,b.screen,b.offered_price,b.iban,b.account_holder_name,b.payment_method,b.answers,b.trade_in,
               b.trade_in_linked_order_id,b.final_offer,b.final_offer_sent_at,b.status,b.created_at,
               b.sale_inspected_value,b.sale_inspection_reason,b.sale_approval_expires_at,
               b.sale_approval_decision_at,b.sale_settlement_note,b.sale_settled_at,b.sale_payout_email_sent_at,
               b.postnl_tracking_number,b.shipping_label_filename,b.shipping_label_uploaded_at,b.shipping_label_email_sent_at,
               w.id AS linked_webshop_order_id,w.order_no AS linked_webshop_order_no,
               w.status AS linked_webshop_status,w.payment_status AS linked_webshop_payment_status,
               w.trade_in_status AS linked_trade_in_status,
               w.trade_in_estimated_value AS linked_trade_in_estimated_value,
               w.trade_in_inspected_value AS linked_trade_in_inspected_value
        FROM buyback_orders b
        LEFT JOIN webshop_orders w ON w.trade_in_order_id=b.id
        WHERE (b.trade_in=FALSE AND b.status NOT IN ('Wacht op aankoop', 'Wacht op betaling'))
           OR (b.trade_in=TRUE AND w.id IS NOT NULL)
        ORDER BY b.created_at DESC
      `);
      res.json({ orders: result.rows });
    } catch (error) {
      console.error("BUYBACK LOAD ERROR:", error);
      res.status(500).json({ error: "Verkoopaanvragen konden niet worden geladen." });
    }
  });

  app.put("/api/admin/buyback-orders/:id/inspection", requirePermission("buyback_orders.update"), async (req, res) => {
    const id = Number(req.params.id);
    const inspectedValue = Number(req.body?.inspectedValue);
    const reason = String(req.body?.reason || "").trim().slice(0, 1000);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
    if (!Number.isFinite(inspectedValue) || inspectedValue < 0 || inspectedValue > 100000) return res.status(400).json({ error: "Vul een geldige definitieve inkoopwaarde in." });
    if (reason.length < 5) return res.status(400).json({ error: "Geef een korte inspectienotitie van minimaal 5 tekens." });
    try {
      await ensureBuybackOrdersTable(pool);
      const updated = await pool.query(
        "UPDATE buyback_orders SET sale_inspected_value=$1,sale_inspection_reason=$2,status='Aanbod klaar',sale_approval_token_hash=NULL,sale_approval_expires_at=NULL WHERE id=$3 AND trade_in=FALSE AND status NOT IN ('Klant akkoord','Klant niet akkoord','Voltooid') RETURNING id",
        [inspectedValue, reason, id]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Aanvraag niet gevonden of al afgehandeld." });
      let customerOffer = { sent: false, reason: "send-failed" };
      try { customerOffer = await sendCustomerOffer(id); }
      catch (emailError) {
        console.error("Buyback customer offer email failed:", id, emailError.message || emailError);
        customerOffer = { sent: false, reason: emailError.code === "EMAIL_NOT_CONFIGURED" ? "email-not-configured" : "send-failed" };
      }
      return res.json({ success: true, customerOffer });
    } catch (error) {
      console.error("Buyback inspection error:", error);
      return res.status(500).json({ error: "De inspectie kon niet worden opgeslagen." });
    }
  });

  app.put("/api/admin/buyback-orders/:id/offer", requirePermission("buyback_orders.update"), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const result = await sendCustomerOffer(id);
      return res.json({ success: true, customerOffer: result });
    } catch (error) {
      console.error("BUYBACK OFFER EMAIL ERROR:", error);
      return res.status(error.status || (error.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502)).json({ error: error.message || "Het prijsvoorstel kon niet worden verstuurd." });
    }
  });

  app.post("/api/buyback/decision", async (req, res) => {
    const token = String(req.body?.token || "").trim();
    const decision = String(req.body?.decision || "").trim();
    if (!/^[a-f0-9]{64}$/i.test(token) || !["accept", "reject"].includes(decision)) {
      return res.status(400).json({ error: "Ongeldige bevestigingslink." });
    }
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const client = await pool.connect();
    try {
      await ensureBuybackOrdersTable(client);
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT id,status,sale_approval_expires_at FROM buyback_orders WHERE sale_approval_token_hash=$1 AND trade_in=FALSE FOR UPDATE",
        [tokenHash]
      );
      if (!found.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Deze bevestigingslink is ongeldig of al gebruikt." });
      }
      const order = found.rows[0];
      if (order.status !== "Aanbod verzonden") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Dit voorstel is niet meer actief." });
      }
      if (!order.sale_approval_expires_at || new Date(order.sale_approval_expires_at).getTime() < Date.now()) {
        await client.query("ROLLBACK");
        return res.status(410).json({ error: "Deze bevestigingslink is verlopen. Neem contact op met HOMS TECH." });
      }
      const nextStatus = decision === "accept" ? "Klant akkoord" : "Klant niet akkoord";
      await client.query(
        "UPDATE buyback_orders SET status=$1,sale_approval_token_hash=NULL,sale_approval_decision_at=NOW() WHERE id=$2",
        [nextStatus, order.id]
      );
      await client.query("COMMIT");
      return res.json({ success: true, decision, status: nextStatus });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("Buyback customer decision failed:", error);
      return res.status(500).json({ error: "Uw keuze kon niet worden opgeslagen. Probeer het later opnieuw." });
    } finally {
      client.release();
    }
  });

  app.put("/api/admin/buyback-orders/:id/settlement", requirePermission("buyback_orders.update"), async (req, res) => {
    const id = Number(req.params.id);
    const note = String(req.body?.settlementNote || "").trim().slice(0, 1000);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
    if (note.length < 5) return res.status(400).json({ error: "Vermeld wanneer en hoe het bedrag aan de klant is overgemaakt." });
    try {
      await ensureBuybackOrdersTable(pool);
      const updated = await pool.query(
        "UPDATE buyback_orders SET status='Voltooid',sale_settlement_note=$1,sale_settled_at=NOW() WHERE id=$2 AND trade_in=FALSE AND status='Klant akkoord' RETURNING id",
        [note, id]
      );
      if (!updated.rows.length) return res.status(409).json({ error: "De klant heeft nog niet akkoord gegeven of de aanvraag is al afgehandeld." });
      let payoutEmail = { sent: false, reason: "send-failed" };
      try { payoutEmail = await sendPayoutConfirmation(id); }
      catch (emailError) {
        console.error("Buyback payout confirmation email failed:", id, emailError.message || emailError);
        payoutEmail = { sent: false, reason: emailError.code === "EMAIL_NOT_CONFIGURED" ? "email-not-configured" : "send-failed" };
      }
      return res.json({ success: true, payoutEmail });
    } catch (error) {
      console.error("Buyback settlement error:", error);
      return res.status(500).json({ error: "De uitbetaling kon niet worden geregistreerd." });
    }
  });

  app.post("/api/admin/buyback-orders/:id/settlement-email", requirePermission("buyback_orders.update"), async (req, res) => {
    const id = Number(req.params.id);
    try {
      const payoutEmail = await sendPayoutConfirmation(id);
      return res.json({ success: true, payoutEmail });
    } catch (error) {
      console.error("Buyback payout confirmation retry failed:", error);
      return res.status(error.status || (error.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502)).json({ error: error.message || "De bevestigingsmail kon niet worden verzonden." });
    }
  });

  // Upload a manually purchased PostNL PDF label. No carrier API or filesystem storage is used.
  app.put("/api/admin/buyback-orders/:id/shipping-label", requirePermission("buyback_orders.update"), async (req, res) => {
    const id = Number(req.params.id);
    const fileName = String(req.body?.fileName || "").replace(/[\/\\]/g, "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 180);
    const trackingNumber = String(req.body?.trackingNumber || "").trim().slice(0, 80);
    const encoded = String(req.body?.fileData || "").replace(/^data:application\/pdf;base64,/i, "").trim();
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
    if (!fileName || !/\.pdf$/i.test(fileName)) return res.status(400).json({ error: "Upload een geldig PDF-verzendlabel." });
    if (!encoded || encoded.length > 11_184_812 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      return res.status(400).json({ error: "Het PDF-bestand ontbreekt of is te groot (maximaal 8 MB)." });
    }
    const pdf = Buffer.from(encoded, "base64");
    if (!pdf.length || pdf.length > 8 * 1024 * 1024 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return res.status(400).json({ error: "Het bestand is geen geldig PDF-verzendlabel of is groter dan 8 MB." });
    }
    try {
      await ensureBuybackOrdersTable(pool);
      const updated = await pool.query(
        "UPDATE buyback_orders SET shipping_label_pdf=$1,shipping_label_filename=$2,postnl_tracking_number=$3,shipping_label_uploaded_at=NOW(),shipping_label_email_sent_at=NULL WHERE id=$4 RETURNING id,shipping_label_filename,postnl_tracking_number,shipping_label_uploaded_at",
        [pdf, fileName, trackingNumber, id]
      );
      if (!updated.rows.length) return res.status(404).json({ error: "Zelfstandige inkoopaanvraag niet gevonden." });
      return res.json({ success: true, shipping: updated.rows[0] });
    } catch (error) {
      console.error("PostNL shipping label upload failed:", error);
      return res.status(500).json({ error: "Het PostNL-verzendlabel kon niet worden opgeslagen." });
    }
  });

  app.get("/api/admin/buyback-orders/:id/shipping-label", requirePermission("buyback_orders.view"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
    try {
      await ensureBuybackOrdersTable(pool);
      const found = await pool.query(
        "SELECT shipping_label_pdf,shipping_label_filename FROM buyback_orders WHERE id=$1",
        [id]
      );
      if (!found.rows.length || !found.rows[0].shipping_label_pdf) return res.status(404).json({ error: "Er is nog geen PostNL-verzendlabel geüpload." });
      const fileName = String(found.rows[0].shipping_label_filename || "postnl-verzendlabel.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="' + fileName + '"');
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(Buffer.from(found.rows[0].shipping_label_pdf));
    } catch (error) {
      console.error("PostNL shipping label download failed:", error);
      return res.status(500).json({ error: "Het PostNL-verzendlabel kon niet worden geopend." });
    }
  });

  app.post("/api/admin/buyback-orders/:id/shipping-label-email", requirePermission("buyback_orders.update"), async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig aanvraagnummer." });
    try {
      await ensureBuybackOrdersTable(pool);
      const found = await pool.query(
        "SELECT id,order_no,name,email,device,postnl_tracking_number,shipping_label_pdf,shipping_label_filename FROM buyback_orders WHERE id=$1",
        [id]
      );
      if (!found.rows.length) return res.status(404).json({ error: "Zelfstandige inkoopaanvraag niet gevonden." });
      const order = found.rows[0];
      if (!order.shipping_label_pdf) return res.status(409).json({ error: "Upload eerst het PostNL-verzendlabel." });
      if (!order.email) return res.status(409).json({ error: "Voor deze aanvraag is geen e-mailadres bekend." });
      const tracking = String(order.postnl_tracking_number || "").trim();
      const trackingHtml = tracking
        ? '<p><strong>Track & Trace:</strong> ' + safe(tracking) + '</p><p>U kunt uw zending volgen via <a href="https://www.postnl.nl/tracktrace/">PostNL Track & Trace</a>.</p>'
        : '<p>U ontvangt de Track & Trace-gegevens zodra deze beschikbaar zijn.</p>';
      const fileName = String(order.shipping_label_filename || "PostNL-verzendlabel.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
      await sendMail({
        to: order.email,
        subject: "Uw PostNL-verzendlabel – HOMS TECH " + order.order_no,
        html: '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:28px;color:#1f2937;line-height:1.65"><div style="background:#071d2d;color:#fff;padding:18px 22px;border-radius:12px;font-size:22px;font-weight:800">HOMS <span style="color:#60a5fa">TECH</span></div><h2>Uw PostNL-verzendlabel</h2><p>Beste ' + safe(order.name) + ',</p><p>In de bijlage vindt u het verzendlabel voor uw ' + safe(order.device || "telefoon") + '. Print het label en bevestig het stevig op de verpakking. Lever het pakket in volgens de instructies van PostNL.</p>' + trackingHtml + '<p><strong>Aanvraagnummer:</strong> ' + safe(order.order_no) + '</p><p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p></div>',
        attachments: [{ filename: fileName, content: Buffer.from(order.shipping_label_pdf).toString("base64") }]
      });
      await pool.query("UPDATE buyback_orders SET shipping_label_email_sent_at=NOW() WHERE id=$1 AND trade_in=FALSE", [id]);
      return res.json({ success: true, sent: true, email: order.email });
    } catch (error) {
      console.error("PostNL shipping label email failed:", error);
      return res.status(error.code === "EMAIL_NOT_CONFIGURED" ? 503 : 502).json({ error: error.message || "Het PostNL-verzendlabel kon niet per e-mail worden verstuurd." });
    }
  });

  app.put("/api/admin/buyback-orders/:id/status", requirePermission("buyback_orders.update"), async (req, res) => {
    try {
      const allowed = ["Nieuw", "In behandeling"];
      const status = String(req.body?.status || "").trim();
      if (!allowed.includes(status)) return res.status(400).json({ error: "Deze status wordt automatisch bijgewerkt via de afhandelingsstappen." });
      const result = await pool.query(
        "UPDATE buyback_orders SET status=$1 WHERE id=$2 AND trade_in=FALSE AND status NOT IN ('Klant akkoord','Klant niet akkoord','Voltooid') RETURNING id,status",
        [status, req.params.id]
      );
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
        "DELETE FROM buyback_orders WHERE id=$1 AND trade_in=FALSE RETURNING id",
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
