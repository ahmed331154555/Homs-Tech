"use strict";

function registerRepairQuoteRoutes(app, { pool, checkRepairRequestRateLimit, validateRepairQuotePayload, resolveRepairRequestCustomerId, jwt, escapeHtml, fetchImpl, getEnv }) {
// Public repair quote requests from the Prices page. Photos are limited and stored with the request.
app.post("/api/repair-requests", async (req, res) => {
  try {
    const b = req.body || {};

    // 1. Honeypot check (anti-bot)
    if (b.website) {
      return res.status(201).json({ success: true, requestNo: Math.floor(10000 + Math.random() * 90000) });
    }

    // 2. Rate limiting check (per IP)
    const clientIp = String(req.ip || req.socket.remoteAddress || "unknown").trim();
    if (!checkRepairRequestRateLimit(clientIp)) {
      return res.status(429).json({ error: "Te veel aanvragen vanaf uw netwerk. Wacht 15 minuten en probeer het opnieuw." });
    }

    let validated;
    try {
      validated = validateRepairQuotePayload(b);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }
    const { brand, model, issue, name, email, phone, photos } = validated;

    // 4. Link only a verified customer session whose account email matches the request.
    // Never attach a public form to an account based on an email address alone.
    const customerId = await resolveRepairRequestCustomerId({
      token: req.cookies?.customerToken,
      jwtSecret: getEnv().JWT_SECRET,
      verifyToken: jwt.verify,
      email,
      findVerifiedCustomer: async (customerIdFromToken, customerEmail) => {
        const customerResult = await pool.query(
          "SELECT id FROM customers WHERE id = $1 AND LOWER(email) = $2 AND email_verified = TRUE LIMIT 1",
          [customerIdFromToken, customerEmail]
        );
        return customerResult.rows[0] || null;
      }
    });

    // 5. Save order in PostgreSQL FIRST
    const extraFields = JSON.stringify({ repairQuote: true, brand, model, photos });
    const result = await pool.query(
      `INSERT INTO service_orders
       (customer_id, service_category, service_name, service_group, price, name, email, phone, notes, status, extra_fields)
       VALUES ($1, 'Reparatie', $2, 'Website aanvraag', 'Op aanvraag', $3, $4, $5, $6, 'Nieuw', $7)
       RETURNING id, created_at`,
      [customerId, brand + " " + model, name, email, phone, issue, extraFields]
    );
    const request = result.rows[0];

    // 6. Send an automatic Dutch receipt confirmation to the customer.
    if (getEnv().RESEND_API_KEY && getEnv().RESEND_FROM_EMAIL) {
      try {
        const customerResponse = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${getEnv().RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: getEnv().RESEND_FROM_EMAIL,
            to: [email],
            subject: `HOMS TECH — ontvangstbevestiging reparatieaanvraag #${request.id}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#203449">
              <h2>Bedankt voor uw reparatieaanvraag</h2>
              <p>Beste ${escapeHtml(name)},</p>
              <p>We hebben uw reparatieaanvraag voor <b>${escapeHtml(brand)} ${escapeHtml(model)}</b> goed ontvangen.</p>
              <p>Ons team bekijkt uw aanvraag en neemt zo snel mogelijk contact met u op over de reparatiemogelijkheden en de prijs.</p>
              <p>Dit bericht is een automatische ontvangstbevestiging; er is nog geen reparatieprijs bevestigd.</p>
              <p>Met vriendelijke groet,<br>
              <b>HOMS TECH</b>
              </p>
              </div>`
          })
        });
        if (!customerResponse.ok) console.error("Repair customer confirmation failed:", customerResponse.status, await customerResponse.text().catch(() => ""));
        else console.log("Repair customer confirmation sent:", request.id);
      } catch (mailError) { console.error("Repair customer confirmation error:", mailError); }
    } else {
      console.error("Repair customer confirmation skipped: missing RESEND_API_KEY or RESEND_FROM_EMAIL");
    }

    // 7. Notify the site owner about repair requests.
    const repairNotifyEmail = getEnv().REPAIR_REQUEST_EMAIL || getEnv().ORDER_NOTIFICATION_EMAIL;
    if (getEnv().RESEND_API_KEY && getEnv().RESEND_FROM_EMAIL && repairNotifyEmail) {
      try {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${getEnv().RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: getEnv().RESEND_FROM_EMAIL,
            to: [repairNotifyEmail],
            subject: `Nieuwe HOMS TECH reparatieaanvraag #${request.id}`,
            html: `<div style="font-family:Arial,sans-serif;color:#203449">
              <h2>Nieuwe reparatieaanvraag #${request.id}</h2>
              <p>
              <b>Toestel:</b> ${escapeHtml(brand)} ${escapeHtml(model)}</p>
              <p>
              <b>Probleem:</b>
              <br>${escapeHtml(issue).replace(/\\n/g,"<br>")}</p>
              <p>
              <b>Klant:</b> ${escapeHtml(name)}</p>
              <p>
              <b>E-mail:</b> ${escapeHtml(email)}</p>
              <p>
              <b>Telefoon:</b> ${escapeHtml(phone || "-")}</p>
              <p>Bekijk de aanvraag in de HOMS TECH-admin. Foto's zijn opgeslagen bij de aanvraag.</p>
              </div>`
          })
        });
        if (!response.ok) console.error("Repair request notification failed:", response.status, await response.text().catch(() => ""));
      } catch (mailError) { console.error("Repair request notification error:", mailError); }
    }

    res.status(201).json({ success: true, requestNo: request.id, createdAt: request.created_at });
  } catch (error) {
    console.error("Repair quote request error:", error);
    res.status(500).json({ error: "De aanvraag kon niet worden opgeslagen. Probeer het later opnieuw." });
  }
});
}

module.exports = { registerRepairQuoteRoutes };
