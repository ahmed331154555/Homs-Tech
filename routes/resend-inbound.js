"use strict";

/** Register the Resend inbound webhook before express.json so Svix sees the exact raw body. */
function registerResendInboundWebhook(app, {
  express,
  pool,
  cryptoImpl,
  getEnv = () => process.env,
  fetchImpl = fetch,
  getNow = () => Date.now()
}) {
  // Resend inbound webhook: preserve the exact raw body so Svix signatures can be verified.
app.post("/api/webhooks/resend/inbound", express.raw({ type: "application/json", limit: "2mb" }), async (req,res) => {
  try {
    const secret=String(getEnv().RESEND_WEBHOOK_SECRET||"");
    if(!secret)return res.status(503).send("Webhook secret not configured");
    const raw=Buffer.isBuffer(req.body)?req.body:Buffer.from("");
    const id=String(req.headers["svix-id"]||""),timestamp=String(req.headers["svix-timestamp"]||""),signature=String(req.headers["svix-signature"]||"");
    if(!id||!timestamp||!signature||!/^\d+$/.test(timestamp)||Math.abs(getNow()/1000-Number(timestamp))>300)return res.status(400).send("Invalid webhook headers");
    const secretBytes=Buffer.from(secret.replace(/^whsec_/,""),"base64");
    const signed=Buffer.concat([Buffer.from(id+"."+timestamp+"."),raw]);
    const expected=cryptoImpl.createHmac("sha256",secretBytes).update(signed).digest("base64");
    const valid=signature.split(" ").some(part=>{const [version,value]=part.split(",");if(version!=="v1"||!value)return false;const a=Buffer.from(value),b=Buffer.from(expected);return a.length===b.length&&cryptoImpl.timingSafeEqual(a,b);});
    if(!valid)return res.status(401).send("Invalid signature");
    const event=JSON.parse(raw.toString("utf8"));
    if(event.type!=="email.received"||!event.data?.email_id)return res.status(200).send("Ignored");
    const apiKey=getEnv().RESEND_API_KEY;if(!apiKey)return res.status(503).send("Resend API key not configured");
    const response=await fetchImpl("https://api.resend.com/emails/receiving/"+encodeURIComponent(event.data.email_id),{headers:{Authorization:"Bearer "+apiKey}});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){
      console.error("Resend receiving API request failed:",response.status,JSON.stringify(payload).slice(0,1200));
      return res.status(502).send("Could not retrieve received email");
    }
    // Resend's REST endpoint returns the received email object directly (not wrapped in { data }).
    // Accept both shapes to remain compatible with SDK-style wrappers.
    const mail =
      payload?.data && typeof payload.data === "object"
        ? payload.data
        : payload;

    if (!mail?.id) {
      console.error(
        "Resend receiving API returned an unexpected payload:",
        JSON.stringify(payload).slice(0, 1200)
      );
      return res.status(502).send("Could not retrieve received email");
    }

    const headerValue = (...names) => {
      const headers =
        mail.headers && typeof mail.headers === "object" ? mail.headers : {};

      for (const name of names) {
        const key = Object.keys(headers).find(
          (headerName) => headerName.toLowerCase() === name.toLowerCase()
        );
        if (!key) continue;

        const value = headers[key];
        return (Array.isArray(value) ? value.join(" ") : String(value || "")).trim();
      }

      return "";
    };

    // Resend exposes the RFC Message-ID as a top-level message_id field.
    // Keep header fallback for compatibility with alternate payload shapes.
    const originalMessageId = String(
      mail.message_id || headerValue("message-id") || ""
    ).trim().slice(0, 998);
    const originalReferences = String(
      mail.references || headerValue("references", "in-reply-to") || ""
    ).trim().slice(0, 4000);

    const stored = await pool.query(
      `INSERT INTO admin_emails(
        resend_email_id, message_id, references_header, direction, from_address,
        to_addresses, subject, text_body, html_body, attachments, is_read, created_at
      ) VALUES(
        $1, $2, $3, 'inbound', $4, $5::jsonb, $6, $7, $8, $9::jsonb, FALSE,
        COALESCE($10::timestamptz, NOW())
      ) ON CONFLICT(resend_email_id) DO NOTHING`,
      [
        String(mail.id || event.data.email_id),
        originalMessageId,
        originalReferences,
        String(mail.from || event.data.from || "").slice(0, 320),
        JSON.stringify(
          Array.isArray(mail.to)
            ? mail.to
            : Array.isArray(event.data.to)
              ? event.data.to
              : []
        ),
        String(mail.subject || event.data.subject || "(geen onderwerp)").slice(0, 500),
        String(mail.text || "").slice(0, 100000),
        String(mail.html || "").slice(0, 200000),
        JSON.stringify(
          Array.isArray(mail.attachments)
            ? mail.attachments.map((attachment) => ({
                filename: String(
                  attachment.filename || attachment.name || "Bijlage"
                ).slice(0, 240),
                content_type: String(
                  attachment.content_type || attachment.type || ""
                ).slice(0, 120),
                size: Number(attachment.size) || 0,
                id: attachment.id || null
              }))
            : []
        ),
        mail.created_at || event.data.created_at || null
      ]
    );

    // Send a short notification to the owner's Gmail; the full message remains in the admin inbox.
    const from = getEnv().RESEND_FROM_EMAIL;
    const notifyEmail = String(
      getEnv().RESEND_INBOUND_NOTIFY_EMAIL ||
      getEnv().ORDER_NOTIFICATION_EMAIL ||
      getEnv().REPAIR_REQUEST_EMAIL ||
      ""
    ).trim();
    if (stored.rowCount > 0 && from && notifyEmail) {
      fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: [notifyEmail],
          subject: "Nieuwe HOMS TECH e-mail: " + String(mail.subject || "").slice(0, 120),
          text:
            "Nieuwe e-mail ontvangen van " +
            String(mail.from || "onbekend") +
            ". Open de HOMS TECH admin inbox om het bericht te lezen."
        })
      }).catch((error) => {
        console.error("Inbound notification failed:", error.message);
      });
    }
    return res.status(200).send("OK");
  }catch(e){console.error("Resend inbound webhook:",e);return res.status(500).send("Webhook processing failed");}
});
}

module.exports = { registerResendInboundWebhook };
