"use strict";

const CONTACT_RATE_LIMIT = 5;
const CONTACT_RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_TRACKED_IPS = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeContactRequest(body = {}) {
  return {
    name: String(body.name || "").trim().slice(0, 120),
    email: String(body.email || "").trim().toLowerCase().slice(0, 254),
    phone: String(body.phone || "").trim().slice(0, 60),
    topic: String(body.topic || "Algemene vraag").trim().slice(0, 120),
    message: String(body.message || "").trim().slice(0, 8000)
  };
}

function isValidContactRequest({ name, email, message }) {
  return name.length >= 2 && EMAIL_PATTERN.test(email) && message.length >= 8;
}

function getClientIp(req) {
  return String(req.ip || req.headers?.["x-forwarded-for"] || "unknown")
    .split(",")[0]
    .trim();
}

function pruneExpiredAttempts(attempts, now) {
  if (attempts.size <= MAX_TRACKED_IPS) return;

  for (const [ip, timestamps] of attempts.entries()) {
    const active = timestamps.filter(timestamp => now - timestamp < CONTACT_RATE_WINDOW_MS);
    if (active.length) {
      attempts.set(ip, active);
    } else {
      attempts.delete(ip);
    }
  }
}

function buildContactMessage({ name, email, phone, topic, message }) {
  return [
    "Nieuw contactbericht via HOMS TECH",
    "Naam: " + name,
    "E-mail: " + email,
    "Telefoon: " + (phone || "-"),
    "Onderwerp: " + topic,
    "",
    "Bericht:",
    message
  ].join("\n");
}

function registerContactRoutes(app, {
  pool,
  escapeHtml,
  cryptoImpl,
  getEnv = () => process.env,
  fetchImpl = fetch,
  getNow = () => Date.now()
}) {
  const contactFormAttempts = new Map();

  /* Public HOMS TECH contact form. Messages are stored in the existing admin email inbox. */
  app.post("/api/contact", async (req, res) => {
    try {
      const env = getEnv();
      const ip = getClientIp(req);
      const now = getNow();
      const recent = (contactFormAttempts.get(ip) || [])
        .filter(timestamp => now - timestamp < CONTACT_RATE_WINDOW_MS);

      if (recent.length >= CONTACT_RATE_LIMIT) {
        return res.status(429).json({
          error: "U heeft te veel berichten verstuurd. Probeer het later opnieuw."
        });
      }

      // Honeypot: silently accept automated submissions without storing them.
      if (String(req.body?.website || "").trim()) {
        return res.json({ success: true });
      }

      const contact = normalizeContactRequest(req.body);
      if (!isValidContactRequest(contact)) {
        return res.status(400).json({
          error: "Vul uw naam, een geldig e-mailadres en een bericht in."
        });
      }

      recent.push(now);
      contactFormAttempts.set(ip, recent);
      pruneExpiredAttempts(contactFormAttempts, now);

      const subject = ("Website contact: " + contact.topic).slice(0, 240);
      const body = buildContactMessage(contact);
      const id = "contact-" + cryptoImpl.randomUUID();
      const notifyEmail = String(
        env.REPAIR_REQUEST_EMAIL || env.ORDER_NOTIFICATION_EMAIL || ""
      ).trim();
      const htmlBody =
        '<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">' +
        escapeHtml(body) +
        "</pre>";

      await pool.query(
        "INSERT INTO admin_emails(resend_email_id,direction,from_address,to_addresses,subject,text_body,html_body,attachments,is_read) VALUES($1,'inbound',$2,$3::jsonb,$4,$5,$6,'[]'::jsonb,FALSE)",
        [
          id,
          contact.email,
          JSON.stringify(notifyEmail ? [notifyEmail] : []),
          subject,
          body,
          htmlBody
        ]
      );

      if (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL && notifyEmail) {
        fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + env.RESEND_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: env.RESEND_FROM_EMAIL,
            to: [notifyEmail],
            reply_to: contact.email,
            subject: "Nieuwe HOMS TECH contactaanvraag",
            text: body
          })
        })
          .then(async response => {
            if (!response.ok) {
              const details = await response.text().catch(() => "");
              console.error("Contact notification failed:", response.status, details);
            }
          })
          .catch(error => {
            console.error("Contact notification error:", error.message);
          });
      }

      return res.status(201).json({
        success: true,
        message: "Uw bericht is ontvangen. We nemen zo snel mogelijk contact met u op."
      });
    } catch (error) {
      console.error("Public contact form error:", error);
      return res.status(500).json({
        error: "Uw bericht kon niet worden verstuurd. Probeer het later opnieuw."
      });
    }
  });
}

module.exports = { registerContactRoutes };
