"use strict";
const { normalizeDutchPostcode, isPostcodeCovered } = require("../utils/repair-coverage");

function registerRepairOrderRoutes(app, { pool, jwt, escapeHtml, fetchImpl, getEnv }) {
// ---------------- REPAIR / SERVICE ORDERS ----------------

app.get("/api/repair/coverage", async (req, res) => {
  try {
    const postcode = normalizeDutchPostcode(req.query.postcode);
    if (!postcode) return res.status(400).json({ error: "Vul een geldige Nederlandse postcode in.", covered: false });
    const result = await pool.query("SELECT data->'repairCoverage' AS areas FROM site_settings WHERE id = 1");
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, covered: isPostcodeCovered(postcode, result.rows[0]?.areas) });
  } catch (error) {
    console.error("Repair coverage check error:", error);
    return res.status(503).json({ error: "Werkgebied kon niet worden gecontroleerd.", covered: false });
  }
});

app.get("/api/repair/availability", async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "Ongeldige datum." });
    }

    const result = await pool.query(`
      SELECT appointment_time
      FROM service_orders
      WHERE service_category = 'Reparatie'
        AND service_group = 'Aan huis'
        AND appointment_date = $1::date
        AND appointment_time IS NOT NULL
        AND status <> 'Geannuleerd'
      ORDER BY appointment_time
    `, [date]);

    res.json({
      success: true,
      date,
      booked: result.rows.map(r => r.appointment_time)
    });
  } catch (error) {
    console.error("Repair availability error:", error);
    res.status(500).json({ error: "Beschikbaarheid kon niet worden geladen." });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      serviceCategory = "",
      serviceName = "",
      serviceGroup = "",
      price = "",
      name = "",
      email = "",
      phone = "",
      username = "",
      imei = "",
      serial = "",
      notes = "",
      priceCurrency = "EUR",
      appointmentDate = "",
      appointmentTime = "",
      extraFields = {}
    } = req.body || {};

    const clean = {
      serviceCategory: String(serviceCategory || "").trim(),
      serviceName: String(serviceName || "").trim(),
      serviceGroup: String(serviceGroup || "").trim(),
      price: String(price || "").trim(),
      name: String(name || "").trim(),
      email: String(email || "").trim().toLowerCase(),
      phone: String(phone || "").trim(),
      username: String(username || "").trim(),
      imei: String(imei || "").trim(),
      serial: String(serial || "").trim(),
      notes: String(notes || "").trim(),
      priceCurrency: String(priceCurrency || "EUR").trim().toUpperCase(),
      appointmentDate: String(appointmentDate || "").trim(),
      appointmentTime: String(appointmentTime || "").trim(),
      extraFields: (extraFields && typeof extraFields === "object") ? extraFields : {}
    };

    const isHomeRepair =
      clean.serviceCategory.toLowerCase() === "reparatie" &&
      clean.serviceGroup.toLowerCase() === "aan huis";

    if (isHomeRepair) {
      const postcode = normalizeDutchPostcode(clean.extraFields.postcode || clean.notes);
      const coverage = await pool.query("SELECT data->'repairCoverage' AS areas FROM site_settings WHERE id = 1");
      if (!postcode || !isPostcodeCovered(postcode, coverage.rows[0]?.areas)) {
        return res.status(403).json({ error: "Reparatie aan huis is niet beschikbaar in uw postcodegebied. Kies Toestel opsturen om uw reparatie per post aan te melden." });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.appointmentDate)) {
        return res.status(400).json({ error: "Kies een datum voor uw afspraak." });
      }
      if (!/^\d{2}:\d{2} - \d{2}:\d{2}$/.test(clean.appointmentTime)) {
        return res.status(400).json({ error: "Kies een beschikbaar tijdstip." });
      }

      // Prevent direct API submissions for times outside the public schedule.
      const allowedTimes = new Set([
        "09:00 - 10:00",
        "10:00 - 11:00",
        "11:00 - 12:00",
        "12:00 - 13:00",
        "13:00 - 14:00",
        "14:00 - 15:00",
        "15:00 - 16:00",
        "16:00 - 17:00",
        "17:00 - 18:00",
        "18:00 - 19:00"
      ]);

      if (!allowedTimes.has(clean.appointmentTime)) {
        return res.status(400).json({ error: "Ongeldig tijdstip." });
      }
    }

    const serviceInstructions = "";
    const requiredFieldsSnapshot = "[]";
    const sourcePriceSnapshot = "";
    const sourceCurrencySnapshot = "";

    let customerId = null;
    try {
      if (req.cookies.customerToken) {
        const decoded = jwt.verify(req.cookies.customerToken, getEnv().JWT_SECRET);
        customerId = decoded.customerId || null;
      }
    } catch {}

    const result = await pool.query(
      `INSERT INTO service_orders
       (
         customer_id, service_category, service_name, service_group, price, name,
         email, phone, username, imei, notes, service_source_id, service_source_url,
         price_currency, appointment_date, appointment_time, service_instructions,
         required_fields, source_price, source_currency, extra_fields
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, status, created_at, appointment_date, appointment_time`,
      [
        customerId, clean.serviceCategory, clean.serviceName, clean.serviceGroup, clean.price,
        clean.name, clean.email, clean.phone, clean.username, clean.imei, clean.notes,
        "", "", clean.priceCurrency,
        isHomeRepair ? clean.appointmentDate : null, isHomeRepair ? clean.appointmentTime : null,
        serviceInstructions, requiredFieldsSnapshot, sourcePriceSnapshot, sourceCurrencySnapshot, JSON.stringify(clean.extraFields || {})
      ]
    );

    // Notify the store owner for repair/service orders as well as quote-form requests.
    if (clean.serviceCategory.toLowerCase() === "reparatie") {
      const notifyEmail = getEnv().REPAIR_REQUEST_EMAIL || getEnv().ORDER_NOTIFICATION_EMAIL;
      if (getEnv().RESEND_API_KEY && getEnv().RESEND_FROM_EMAIL && notifyEmail) {
        try {
          const appointment = isHomeRepair
            ? `<p><b>Afspraak:</b> ${escapeHtml(clean.appointmentDate)} · ${escapeHtml(clean.appointmentTime)}</p>`
            : "";
          const mailResponse = await fetchImpl("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${getEnv().RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: getEnv().RESEND_FROM_EMAIL,
              to: [notifyEmail],
              subject: `Nieuwe HOMS TECH reparatiebestelling #${result.rows[0].id}`,
              html: `<div style="font-family:Arial,sans-serif;color:#203449">
                <h2>Nieuwe reparatiebestelling #${result.rows[0].id}</h2>
                <p>
                <b>Toestel/service:</b> ${escapeHtml(clean.serviceName)}</p>
                <p>
                <b>Klant:</b> ${escapeHtml(clean.name)}</p>
                <p>
                <b>E-mail:</b> ${escapeHtml(clean.email)}</p>
                <p>
                <b>Telefoon:</b> ${escapeHtml(clean.phone)}</p>
                <p>
                <b>Prijs:</b> ${escapeHtml(clean.price || "Op aanvraag")} ${escapeHtml(clean.priceCurrency || "EUR")}</p>${appointment}<p>
                <b>Opmerking:</b>
                <br>${escapeHtml(clean.notes || "-").replace(/\\n/g, "<br>")}</p>
                <p>Bekijk de aanvraag in de HOMS TECH-admin.</p>
                </div>`
            })
          });
          if (!mailResponse.ok) console.error("Service repair notification failed:", mailResponse.status, await mailResponse.text().catch(() => ""));
          else console.log("Service repair notification sent:", result.rows[0].id);
        } catch (mailError) {
          console.error("Service repair notification error:", mailError);
        }
      } else {
        console.error("Service repair notification skipped: missing RESEND_API_KEY, RESEND_FROM_EMAIL, or notification recipient");
      }
    }

    if (clean.serviceCategory.toLowerCase() === "reparatie" && getEnv().RESEND_API_KEY && getEnv().RESEND_FROM_EMAIL) {
      try {
        const customerResponse = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${getEnv().RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: getEnv().RESEND_FROM_EMAIL,
            to: [clean.email],
            subject: `HOMS TECH — ontvangstbevestiging reparatie #${result.rows[0].id}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#203449">
              <h2>Bedankt voor uw reparatieaanvraag</h2>
              <p>Beste ${escapeHtml(clean.name)},</p>
              <p>We hebben uw aanvraag voor <b>${escapeHtml(clean.serviceName)}</b> goed ontvangen.</p>
              <p>We bekijken uw aanvraag en nemen zo snel mogelijk contact met u op.</p>
              <p>De definitieve reparatieprijs is pas bevestigd nadat we uw aanvraag hebben beoordeeld.</p>
              <p>Met vriendelijke groet,<br>
              <b>HOMS TECH</b>
              </p>
              </div>`
          })
        });
        if (!customerResponse.ok) console.error("Service repair customer confirmation failed:", customerResponse.status, await customerResponse.text().catch(() => ""));
        else console.log("Service repair customer confirmation sent:", result.rows[0].id);
      } catch (mailError) {
        console.error("Service repair customer confirmation error:", mailError);
      }
    }

    res.status(201).json({
      success: true,
      order: result.rows[0]
    });
  } catch (error) {
    console.error("Create service order error:", error);

    if (
      error &&
      error.code === "23505" &&
      error.constraint === "service_orders_repair_appointment_unique"
    ) {
      return res.status(409).json({
        error: "Dit tijdstip is helaas al bezet. Kies een ander tijdstip."
      });
    }

    res.status(500).json({
      error: "Bestelling kon niet worden aangemaakt."
    });
  }
});
}

module.exports = { registerRepairOrderRoutes };
