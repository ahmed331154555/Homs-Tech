require("dotenv").config();

const express = require("express");
const compression = require("compression");
const { pool, wait, queryWithConnectionRetry } = require("./config/database");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const { hashPassword, verifyPassword } = require("./utils/password");
const { escapeHtml } = require("./utils/html");
const { moneyNumber } = require("./utils/money");
const { deviceText, deviceMoney } = require("./utils/device-register");
const { invoicePdfEscape } = require("./utils/invoice-pdf");
const path = require("path");
const {
  sanitizeDevicesCatalogData,
  sanitizeCartStockData
} = require("./utils/catalog-sanitizers");
const app = express();
const { registerAdminOrderRoutes } = require("./routes/admin-orders");
const { registerAdminWebshopOrderRoutes } = require("./routes/admin-webshop-orders");
const { validateRepairQuotePayload } = require("./utils/repair-quote");
const { validateBuybackOfferedPrice } = require("./utils/buyback-order");
const { sanitizePublicSiteData, sanitizeHomepageSiteData } = require("./utils/site-data-sanitizers");
const { mollieStatusToLocal, molliePaymentMatchesOrder } = require("./utils/mollie-payment");
const { encryptPayPalSecret, decryptPayPalSecret, getPayPalBaseUrl } = require("./utils/payment-secrets");
const { allowLiveChat, liveChatAutomaticReply } = require("./utils/live-chat");
const { checkRepairRequestRateLimit } = require("./utils/repair-request-rate-limit");
const { createPaidOrderInventoryDeductor } = require("./utils/paid-order-inventory");
const { priceProductFromCatalog } = require("./utils/cart-pricing");
const { createAdminAuth } = require("./utils/admin-auth");
const { initializeDatabaseWithRetry } = require("./utils/database-initialization");
const { createPaymentSettings } = require("./utils/payment-settings");
const {
  preserveExistingProductPhotos,
  preserveExistingCatalogPhotos,
  preserveExistingBuybackPhotos
} = require("./utils/catalog-photo-preservation");
const { saveShopCatalog, validateShopCatalogIdentifiers, validateShopCatalogImages } = require("./utils/shop-catalog");
const PORT = process.env.PORT || 3000;
const { getMollieApiKey, getPayPalSettings } = createPaymentSettings({
  pool,
  getEnv: () => process.env,
  decryptSecret: decryptPayPalSecret
});
const deductPaidOrderInventory = createPaidOrderInventoryDeductor({ pool });
const {
  getSuperAdminUser,
  getAdminFromRequest,
  requirePermission,
  requireSiteOrPhoneUpdate
} = createAdminAuth({
  jwt,
  pool,
  getAdminUsername: () => String(process.env.ADMIN_USERNAME || ""),
  getJwtSecret: () => process.env.JWT_SECRET
});


app.use(compression({ threshold: 1024 }));
// Resend inbound webhook: preserve the exact raw body so Svix signatures can be verified.
app.post("/api/webhooks/resend/inbound", express.raw({ type: "application/json", limit: "2mb" }), async (req,res) => {
  try {
    const secret=String(process.env.RESEND_WEBHOOK_SECRET||"");
    if(!secret)return res.status(503).send("Webhook secret not configured");
    const raw=Buffer.isBuffer(req.body)?req.body:Buffer.from("");
    const id=String(req.headers["svix-id"]||""),timestamp=String(req.headers["svix-timestamp"]||""),signature=String(req.headers["svix-signature"]||"");
    if(!id||!timestamp||!signature||!/^\d+$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>300)return res.status(400).send("Invalid webhook headers");
    const secretBytes=Buffer.from(secret.replace(/^whsec_/,""),"base64");
    const signed=Buffer.concat([Buffer.from(id+"."+timestamp+"."),raw]);
    const expected=crypto.createHmac("sha256",secretBytes).update(signed).digest("base64");
    const valid=signature.split(" ").some(part=>{const [version,value]=part.split(",");if(version!=="v1"||!value)return false;const a=Buffer.from(value),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);});
    if(!valid)return res.status(401).send("Invalid signature");
    const event=JSON.parse(raw.toString("utf8"));
    if(event.type!=="email.received"||!event.data?.email_id)return res.status(200).send("Ignored");
    const apiKey=process.env.RESEND_API_KEY;if(!apiKey)return res.status(503).send("Resend API key not configured");
    const response=await fetch("https://api.resend.com/emails/receiving/"+encodeURIComponent(event.data.email_id),{headers:{Authorization:"Bearer "+apiKey}});
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

    await pool.query(
      "INSERT INTO admin_emails(resend_email_id,message_id,references_header,direction,from_address,to_addresses,subject,text_body,html_body,attachments,is_read,created_at) VALUES($1,$2,$3,'inbound',$4,$5::jsonb,$6,$7,$8,$9::jsonb,FALSE,COALESCE($10::timestamptz,NOW())) ON CONFLICT(resend_email_id) DO NOTHING",
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
    const from = process.env.RESEND_FROM_EMAIL;
    if (from) {
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: ["Appelavcd116@gmail.com"],
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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({ error: "Het geüploade bestand is te groot. Verklein de foto's en probeer opnieuw." });
  }
  next(err);
});
app.use(cookieParser());

// Never expose server code, deployment metadata, backups, or dotfiles through static hosting.
app.use((req, res, next) => {
  let pathname = String(req.path || "/");
  try { pathname = decodeURIComponent(pathname); } catch { return res.sendStatus(400); }
  const segments = pathname.replace(/\\/g, "/").split("/").filter(Boolean).map(x => x.toLowerCase());
  const blocked = new Set(["server.js", "package.json", "package-lock.json", "render.yaml", "admin-index.html"]);
  if (segments.some(segment =>
    segment.startsWith(".") ||
    blocked.has(segment) ||
    /\.(?:zip|sql|bak|backup|log|db|sqlite|env)$/i.test(segment)
  )) return res.sendStatus(404);
  next();
});
app.use(express.static(__dirname, { dotfiles: "deny", index: "index.html" }));

// Send a welcome email through Resend
async function sendCustomerVerificationEmail(customer, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [customer.email],
      subject: "Bevestig je HOMS TECH-account",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222;line-height:1.6">
          <h1 style="color:#0f2740">Bevestig je e-mailadres</h1>
          <p>Hallo ${escapeHtml(customer.name || "klant")},</p>
          <p>Bedankt dat je een account bij HOMS TECH aanmaakt. Vul deze code in op de accountpagina om je account te activeren:</p>
          <p style="font-size:32px;font-weight:800;letter-spacing:8px;background:#f1f5f9;padding:18px;text-align:center;border-radius:12px">${escapeHtml(code)}</p>
          <p>De code is 15 minuten geldig. Heb je dit account niet aangevraagd? Negeer deze e-mail dan.</p>
          <p><strong>Team HOMS TECH</strong></p>
          <p style="font-size:12px;color:#64748b">https://homs-tech.nl</p>
        </div>
      `
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend verification email error ${response.status}: ${JSON.stringify(data)}`);
  }
  console.log("Customer verification email sent:", data.id || "ok");
}

async function sendWelcomeEmail(customer) {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.log("RESEND_API_KEY is not configured; welcome email skipped.");
    return;
  }

  const from = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [customer.email],
      subject: "Welkom bij HOMS TECH",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222;line-height:1.6">
          <h1 style="margin-bottom:8px;color:#0f2740">Welkom bij HOMS TECH 👋</h1>
          <p>Hallo ${escapeHtml(customer.name)},</p>
          <p>Bedankt voor je registratie bij HOMS TECH!</p>
          <p>Je account is succesvol aangemaakt. Je kunt nu smartphones bekijken en je bestellingen volgen vanuit je account.</p>
          <p style="margin:24px 0"><a href="https://homs-tech.nl" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Bezoek HOMS TECH</a></p>
          <p>Wil je je wachtwoord wijzigen of ben je het vergeten? Ga naar de accountpagina en kies <strong>Wachtwoord vergeten</strong> om veilig een resetlink te ontvangen.</p>
          <p style="margin-top:28px"><strong>Team HOMS TECH</strong><br>Telefoonservice & smartphones</p>
          <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="font-size:12px;color:#64748b">Website: <a href="https://homs-tech.nl" style="color:#2563eb">https://homs-tech.nl</a></p>
        </div>
      `
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Resend error ${response.status}: ${JSON.stringify(data)}`);
  }

  console.log("Welcome email sent:", data.id || "ok");
}

// Create database tables and default settings
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_emails (
      id BIGSERIAL PRIMARY KEY,
      resend_email_id TEXT UNIQUE,
      message_id TEXT NOT NULL DEFAULT '',
      references_header TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
      from_address TEXT NOT NULL DEFAULT '',
      to_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
      subject TEXT NOT NULL DEFAULT '',
      text_body TEXT NOT NULL DEFAULT '',
      html_body TEXT NOT NULL DEFAULT '',
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_emails_created_idx ON admin_emails(created_at DESC);
    CREATE INDEX IF NOT EXISTS admin_emails_inbox_idx ON admin_emails(direction,is_read,created_at DESC);
  `);
  await pool.query(`ALTER TABLE admin_emails ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE admin_emails ADD COLUMN IF NOT EXISTS message_id TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE admin_emails ADD COLUMN IF NOT EXISTS references_header TEXT NOT NULL DEFAULT ''`);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_register (
      id BIGSERIAL PRIMARY KEY,
      device_type TEXT NOT NULL CHECK (device_type IN ('customer_repair','commercial')),
      identifier_type TEXT NOT NULL CHECK (identifier_type IN ('imei','serial','barcode')),
      identifier_value TEXT NOT NULL,
      model TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT 'Apple',
      status TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      repair_order_number TEXT NOT NULL DEFAULT '',
      purchase_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(identifier_type, identifier_value)
    );
    CREATE INDEX IF NOT EXISTS device_register_type_status_idx ON device_register(device_type,status,archived);
    CREATE TABLE IF NOT EXISTS device_register_operations (
      id BIGSERIAL PRIMARY KEY,
      device_id BIGINT NOT NULL REFERENCES device_register(id) ON DELETE CASCADE,
      operation_type TEXT NOT NULL CHECK (operation_type IN ('repair','refurbishment','purchase','sale','note')),
      status TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      parts JSONB NOT NULL DEFAULT '[]'::jsonb,
      additional_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS live_chat_conversations (
      id BIGSERIAL PRIMARY KEY,
      public_token TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL DEFAULT 'Bezoeker',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS live_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES live_chat_conversations(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('customer','admin')),
      message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS live_chat_messages_conversation_idx ON live_chat_messages(conversation_id,id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Existing accounts stay active. Public signups explicitly start unverified.
  await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verification_code_hash TEXT");
  await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ");
  await pool.query("ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_verification_attempts INTEGER NOT NULL DEFAULT 0");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_password_resets (
      id BIGSERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS customer_password_resets_customer_idx ON customer_password_resets (customer_id, created_at DESC)");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_orders (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      service_category TEXT NOT NULL DEFAULT '',
      service_name TEXT NOT NULL DEFAULT '',
      service_group TEXT DEFAULT '',
      price TEXT DEFAULT '',
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      username TEXT DEFAULT '',
      imei TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nieuw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS provider_reference TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS execution_note TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS result_data TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS execution_updated_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS appointment_date DATE`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS appointment_time TEXT`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_source_id TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_source_url TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS price_currency TEXT DEFAULT 'EUR'`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS service_instructions TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS required_fields TEXT DEFAULT '[]'`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_price TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_currency TEXT DEFAULT 'USD'`);
  await pool.query(`ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS extra_fields TEXT DEFAULT '{}'`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS service_orders_repair_appointment_unique
    ON service_orders (appointment_date, appointment_time)
    WHERE service_category = 'Reparatie'
      AND service_group = 'Aan huis'
      AND appointment_date IS NOT NULL
      AND appointment_time IS NOT NULL
      AND status <> 'Geannuleerd'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webshop_orders (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      street TEXT DEFAULT '',
      house_number TEXT DEFAULT '',
      postcode TEXT DEFAULT '',
      city TEXT DEFAULT '',
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Nieuw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      data JSONB NOT NULL DEFAULT '{"postnlEnabled":false,"dhlEnabled":false}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Payment fields for webshop checkout / PayPal.
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS checkout_token TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Unpaid'`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS paypal_order_id TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS mollie_payment_id TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS shipping_method TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS tracking_number TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS tracking_url TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS inventory_deducted_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE webshop_orders ADD COLUMN IF NOT EXISTS inventory_error TEXT NOT NULL DEFAULT ''`);

  const result = await pool.query(
    "SELECT id FROM site_settings WHERE id = 1"
  );

  if (result.rows.length === 0) {
    const defaultData = {
      siteName: "HOMS TECH",
      tagline: "Phone repair at your doorstep",
      phone: "",
      whatsapp: "",
      email: "",
      services: [
        "Screen Replacement",
        "Battery Replacement",
        "Charging Port Repair",
        "Camera Repair",
        "Software Repair"
      ],
      features: [
        "We come to your home",
        "Fast service",
        "Professional repair",
        "Warranty on repairs"
      ],
      devices: [
        {
          name: "iPhone 12",
          price: ""
        },
        {
          name: "iPhone 13",
          price: ""
        },
        {
          name: "iPhone 14",
          price: ""
        },
        {
          name: "iPhone 15",
          price: ""
        },
        {
          name: "iPhone 16",
          price: ""
        },
        {
          name: "iPhone 17",
          price: ""
        }
      ]
    };

    await pool.query(
      "INSERT INTO site_settings (id, data) VALUES (1, $1)",
      [JSON.stringify(defaultData)]
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS manual_invoices (
      id BIGSERIAL PRIMARY KEY,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_address TEXT NOT NULL DEFAULT '',
      kvk_number TEXT NOT NULL DEFAULT '',
      vat_id TEXT NOT NULL DEFAULT '',
      lines JSONB NOT NULL,
      subtotal NUMERIC(12,2) NOT NULL,
      vat_total NUMERIC(12,2) NOT NULL,
      total NUMERIC(12,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'Concept / test',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// Lightweight public catalog for the customer buyback page.
// Avoid downloading the full site settings document (which can contain large
// repair/product images) just to render the buyback model selector.
app.get("/api/buyback/catalog", async (req, res) => {
  try {
    const result = await queryWithConnectionRetry(
      "SELECT data->'buybackCatalog' AS catalog, data->'buybackPhones' AS phones FROM site_settings WHERE id = 1",
      [],
      4
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Buyback catalog not found" });
    }
    res.set("Cache-Control", "no-store");
    return res.json({
      buybackCatalog: Array.isArray(result.rows[0].catalog) ? result.rows[0].catalog : [],
      buybackPhones: Array.isArray(result.rows[0].phones) ? result.rows[0].phones : []
    });
  } catch (error) {
    console.error("[BUYBACK CATALOG] Load failed:", error);
    return res.status(500).json({ error: "Buyback catalog could not be loaded" });
  }
});

// Get website settings
app.get("/api/site", async (req, res) => {
  try {
    const view=String(req.query.view||"").trim().toLowerCase();
    if(view==="devices"){
      const result=await queryWithConnectionRetry("SELECT data->'phones' AS phones,data->'devices' AS devices,data->'phone' AS phone,data->'whatsapp' AS whatsapp,data->'businessName' AS business_name,data->'siteName' AS site_name,data->'tagline' AS tagline FROM site_settings WHERE id=1",[],4);
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];return res.json(sanitizeDevicesCatalogData({phones:row.phones,devices:row.devices,phone:row.phone,whatsapp:row.whatsapp,businessName:row.business_name,siteName:row.site_name,tagline:row.tagline}));
    }
    if(view==="product"){
      const result=await queryWithConnectionRetry(
        "SELECT data->'phones' AS phones,data->'usedPhones' AS used_phones,data->'phone' AS phone,data->'whatsapp' AS whatsapp,data->'businessName' AS business_name,data->'siteName' AS site_name,data->'tagline' AS tagline FROM site_settings WHERE id=1",
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];
      return res.json({
        phones:Array.isArray(row.phones)?row.phones:[],
        usedPhones:Array.isArray(row.used_phones)?row.used_phones:[],
        phone:row.phone||"",
        whatsapp:row.whatsapp||"",
        businessName:row.business_name||row.site_name||"HOMS TECH",
        siteName:row.site_name||"HOMS TECH",
        tagline:row.tagline||"Telefoonreparatie aan huis"
      });
    }
    if(view==="cart"){
      const result=await queryWithConnectionRetry("SELECT data->'shopProducts' AS shop_products FROM site_settings WHERE id=1",[],4);
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      return res.json({shopProducts:sanitizeCartStockData(result.rows[0].shop_products)});
    }
    const result = await queryWithConnectionRetry(
      "SELECT data FROM site_settings WHERE id = 1",
      [],
      4
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Settings not found"
      });
    }

    let canViewPrivate = false;
    try {
      const user = getAdminFromRequest(req);
      canViewPrivate = !!user && (
        user.role === "superadmin" ||
        user.username === String(process.env.ADMIN_USERNAME || "") ||
        user.permissions?.includes("*") ||
        user.permissions?.includes("site.save")
      );
    } catch {}
    const data = result.rows[0].data;
    // Private/admin responses must never be cached. Public responses can be revalidated
    // so repeat visits avoid transferring the full settings payload when unchanged.
    res.set("Cache-Control", canViewPrivate ? "no-store" : "public, max-age=0, must-revalidate");
    if (!canViewPrivate && req.query.view === "home") {
      return res.json(sanitizeHomepageSiteData(data));
    }
    res.json(canViewPrivate ? data : sanitizePublicSiteData(data));
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Server error"
    });
  }
});


/* Public HOMS TECH contact form. Messages are stored in the existing admin email inbox. */
const contactFormAttempts = new Map();
app.post("/api/contact", async (req,res) => {
  try {
    const ip=String(req.ip||req.headers["x-forwarded-for"]||"unknown").split(",")[0].trim();
    const now=Date.now();
    const recent=(contactFormAttempts.get(ip)||[]).filter(t=>now-t<60*60*1000);
    if(recent.length>=5)return res.status(429).json({error:"U heeft te veel berichten verstuurd. Probeer het later opnieuw."});
    // Honeypot: silently accept automated submissions without storing them.
    if(String(req.body?.website||"").trim())return res.json({success:true});
    const name=String(req.body?.name||"").trim().slice(0,120);
    const email=String(req.body?.email||"").trim().toLowerCase().slice(0,254);
    const phone=String(req.body?.phone||"").trim().slice(0,60);
    const topic=String(req.body?.topic||"Algemene vraag").trim().slice(0,120);
    const message=String(req.body?.message||"").trim().slice(0,8000);
    if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||message.length<8){
      return res.status(400).json({error:"Vul uw naam, een geldig e-mailadres en een bericht in."});
    }
    recent.push(now);contactFormAttempts.set(ip,recent);
    const subject=("Website contact: "+topic).slice(0,240);
    const body=["Nieuw contactbericht via HOMS TECH","Naam: "+name,"E-mail: "+email,"Telefoon: "+(phone||"-"),"Onderwerp: "+topic,"","Bericht:",message].join("\n");
    const id="contact-"+crypto.randomUUID();
    const notifyEmail=String(process.env.REPAIR_REQUEST_EMAIL||process.env.ORDER_NOTIFICATION_EMAIL||"").trim();
    await pool.query(
      "INSERT INTO admin_emails(resend_email_id,direction,from_address,to_addresses,subject,text_body,html_body,attachments,is_read) VALUES($1,'inbound',$2,$3::jsonb,$4,$5,$6,'[]'::jsonb,FALSE)",
      [id,email,JSON.stringify(notifyEmail?[notifyEmail]:[]),subject,body,"<pre style=\"white-space:pre-wrap;font-family:Arial,sans-serif\">"+escapeHtml(body)+"</pre>"]
    );
    if(process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL&&notifyEmail){
      fetch("https://api.resend.com/emails",{
        method:"POST",
        headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({from:process.env.RESEND_FROM_EMAIL,to:[notifyEmail],reply_to:email,subject:"Nieuwe HOMS TECH contactaanvraag",text:body})
      }).then(async response=>{if(!response.ok)console.error("Contact notification failed:",response.status,await response.text().catch(()=>""));})
        .catch(error=>console.error("Contact notification error:",error.message));
    }
    return res.status(201).json({success:true,message:"Uw bericht is ontvangen. We nemen zo snel mogelijk contact met u op."});
  }catch(error){
    console.error("Public contact form error:",error);
    return res.status(500).json({error:"Uw bericht kon niet worden verstuurd. Probeer het later opnieuw."});
  }
});

// Admin login + permissions
const ADMIN_PERMISSION_NAMES = {
  "general.view":"Algemeen bekijken","services.view":"Diensten bekijken",
  "phones.view":"Telefoons & prijzen bekijken","phones.update":"Telefoons & prijzen wijzigen","categories.view":"Apparaten & categorieën bekijken",
  "used.view":"Gebruikte telefoons bekijken","why.view":"Waarom HOMS TECH bekijken",
  "customers.view":"Klanten bekijken","orders.view":"Reparatieaanvragen bekijken",
  "orders.update":"Reparatieaanvraag-status wijzigen","orders.delete":"Reparatieaanvragen verwijderen",
  "webshop_orders.view":"Webshop bestellingen bekijken",
  "webshop_orders.update":"Webshop order-status wijzigen","webshop_orders.delete":"Webshop bestellingen verwijderen",
  "buyback_orders.view":"Inruil aanvragen bekijken","buyback_orders.update":"Inruil status wijzigen","buyback_orders.delete":"Inruil aanvragen verwijderen",
  "site.save":"Websitegegevens opslaan","search":"Admin zoeken","admins.manage":"Admins beheren"
};

app.post("/api/login", async (req,res)=>{
  try{
    const username=String(req.body?.username||"").trim();
    const password=String(req.body?.password||"");

    if(username===String(process.env.ADMIN_USERNAME||"") && password===String(process.env.ADMIN_PASSWORD||"")){
      const user=getSuperAdminUser(username);
      const token=jwt.sign(user,process.env.JWT_SECRET,{expiresIn:"7d"});
      res.cookie("token",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:7*24*60*60*1000});
      return res.json({success:true,user});
    }

    const q=await pool.query(`SELECT id,username,password_hash,role,permissions,active
      FROM admin_users WHERE LOWER(username)=LOWER($1) LIMIT 1`,[username]);
    if(!q.rows.length || !q.rows[0].active) return res.status(401).json({error:"Invalid username or password"});

    const a=q.rows[0];
    if(!await verifyPassword(password,a.password_hash))
      return res.status(401).json({error:"Invalid username or password"});

    const user={id:a.id,username:a.username,role:a.role||"admin",permissions:Array.isArray(a.permissions)?a.permissions:[]};
    const token=jwt.sign(user,process.env.JWT_SECRET,{expiresIn:"7d"});
    res.cookie("token",token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",maxAge:7*24*60*60*1000});
    res.json({success:true,user});
  }catch(e){
    console.error("Admin login error:",e);
    res.status(500).json({error:"Login mislukt"});
  }
});

app.get("/api/me",async (req,res)=>{
  try{
    const token=req.cookies?.token;
    if(!token){
      console.warn("Admin session check: token cookie missing");
      return res.status(401).json({authenticated:false,reason:"cookie_missing"});
    }
    let user;
    try{user=jwt.verify(token,process.env.JWT_SECRET);}
    catch(e){
      console.warn("Admin session check: token verification failed ("+String(e?.name||"Error")+")");
      return res.status(401).json({authenticated:false,reason:"token_invalid"});
    }
    if(user.username===String(process.env.ADMIN_USERNAME||"")){
      return res.json({authenticated:true,...getSuperAdminUser(user.username)});
    }
    const q=await pool.query(`SELECT id,username,role,permissions,active FROM admin_users WHERE id=$1 OR LOWER(username)=LOWER($2) LIMIT 1`,[user.id||0,user.username||""]);
    if(!q.rows.length || !q.rows[0].active){
      console.warn("Admin session check: admin account missing or inactive");
      return res.status(401).json({authenticated:false,reason:"admin_inactive"});
    }
    const a=q.rows[0];
    const normalized={id:a.id,username:a.username,role:a.role||"admin",permissions:Array.isArray(a.permissions)?a.permissions:[]};
    res.json({authenticated:true,...normalized});
  }catch(e){
    console.error("Admin session check failed:",String(e?.name||"Error"),String(e?.code||""));
    res.status(500).json({authenticated:false,reason:"session_check_error"});
  }
});

app.post("/api/logout",(req,res)=>{
  res.clearCookie("token");
  res.json({success:true});
});

const customerDeviceStatuses = new Set(["مفتوح","قيد العمل","مكتمل"]);
const commercialDeviceStatuses = new Set(["تم الشراء","قيد الفحص","قيد التجديد","جاهز للبيع","تم البيع"]);

app.get("/api/admin/device-register",requirePermission("device_register.view"),async(req,res)=>{
  try{
    const type=["customer_repair","commercial"].includes(req.query.type)?req.query.type:null;
    const archived=req.query.archived==="true";
    const q=deviceText(req.query.q,100);
    const result=await pool.query(`
      SELECT d.*,
        COALESCE((SELECT COUNT(*) FROM device_register_operations o WHERE o.device_id=d.id),0)::int AS operation_count,
        COALESCE((SELECT SUM((part.value->>'quantity')::numeric*(part.value->>'cost')::numeric)
          FROM device_register_operations o CROSS JOIN LATERAL jsonb_array_elements(o.parts) AS part(value) WHERE o.device_id=d.id),0)
          + COALESCE((SELECT SUM(additional_cost) FROM device_register_operations o WHERE o.device_id=d.id),0) AS recorded_cost
      FROM device_register d
      WHERE d.archived=$1 AND ($2::text IS NULL OR d.device_type=$2)
        AND ($3='' OR d.identifier_value ILIKE '%'||$3||'%' OR d.model ILIKE '%'||$3||'%' OR d.customer_name ILIKE '%'||$3||'%' OR d.repair_order_number ILIKE '%'||$3||'%')
      ORDER BY d.updated_at DESC,d.id DESC LIMIT 500
    `,[archived,type,q]);
    res.set("Cache-Control","no-store");res.json({devices:result.rows});
  }catch(e){console.error("Device register list error:",e);res.status(500).json({error:"Kon toestellen niet laden."});}
});
app.post("/api/admin/device-register",requirePermission("device_register.update"),async(req,res)=>{
  try{
    const b=req.body||{},type=deviceText(b.deviceType,30),identifierType=deviceText(b.identifierType,20);
    const identifierValue=deviceText(b.identifierValue,100),model=deviceText(b.model,120),brand=deviceText(b.brand,60)||"Apple";
    const status=deviceText(b.status,40),customerName=deviceText(b.customerName,160),customerPhone=deviceText(b.customerPhone,60),customerEmail=deviceText(b.customerEmail,180),repairOrderNumber=deviceText(b.repairOrderNumber,100);
    const purchaseCost=deviceMoney(b.purchaseCost),salePrice=deviceMoney(b.salePrice);
    if(!["customer_repair","commercial"].includes(type)||!["imei","serial","barcode"].includes(identifierType)||!identifierValue||!model||!Number.isFinite(purchaseCost)||!Number.isFinite(salePrice))
      return res.status(400).json({error:"Controleer het toesteltype, identificatienummer, model en bedragen."});
    const allowed=type==="customer_repair"?customerDeviceStatuses:commercialDeviceStatuses;
    if(!allowed.has(status))return res.status(400).json({error:"Ongeldige status voor dit toesteltype."});
    const result=await pool.query(`INSERT INTO device_register(device_type,identifier_type,identifier_value,model,brand,status,customer_name,customer_phone,customer_email,repair_order_number,purchase_cost,sale_price)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [type,identifierType,identifierValue,model,brand,status,customerName,customerPhone,customerEmail,repairOrderNumber,purchaseCost,salePrice]);
    res.status(201).json({device:result.rows[0]});
  }catch(e){if(e.code==="23505")return res.status(409).json({error:"Dit identificatienummer bestaat al in het register."});console.error("Device register create error:",e);res.status(500).json({error:"Toestel kon niet worden opgeslagen."});}
});
app.put("/api/admin/device-register/:id",requirePermission("device_register.update"),async(req,res)=>{
  try{
    const id=Number(req.params.id),b=req.body||{};
    if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Ongeldig toestel."});
    const status=deviceText(b.status,40),purchaseCost=deviceMoney(b.purchaseCost),salePrice=deviceMoney(b.salePrice);
    const model=deviceText(b.model,120),brand=deviceText(b.brand,60)||"Apple";
    const existing=await pool.query("SELECT device_type FROM device_register WHERE id=$1 AND archived=FALSE",[id]);
    if(!existing.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});
    const allowed=existing.rows[0].device_type==="commercial"?commercialDeviceStatuses:customerDeviceStatuses;
    if(!allowed.has(status)||!Number.isFinite(purchaseCost)||!Number.isFinite(salePrice))return res.status(400).json({error:"Controleer status en bedragen."});
    const result=await pool.query(`UPDATE device_register SET status=$2,customer_name=$3,customer_phone=$4,customer_email=$5,repair_order_number=$6,purchase_cost=$7,sale_price=$8,model=CASE WHEN $9='' THEN model ELSE $9 END,brand=CASE WHEN $10='' THEN brand ELSE $10 END,updated_at=NOW()
      WHERE id=$1 AND archived=FALSE RETURNING *`,[id,status,deviceText(b.customerName,160),deviceText(b.customerPhone,60),deviceText(b.customerEmail,180),deviceText(b.repairOrderNumber,100),purchaseCost,salePrice,model,brand]);
    if(!result.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});
    res.json({device:result.rows[0]});
  }catch(e){console.error("Device register update error:",e);res.status(500).json({error:"Toestel kon niet worden bijgewerkt."});}
});
app.get("/api/admin/device-register/:id/operations",requirePermission("device_register.view"),async(req,res)=>{
  try{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Ongeldig toestel."});
    const d=await pool.query("SELECT id FROM device_register WHERE id=$1",[id]);if(!d.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});
    const q=await pool.query("SELECT * FROM device_register_operations WHERE device_id=$1 ORDER BY created_at DESC,id DESC",[id]);res.json({operations:q.rows});
  }catch(e){console.error("Device history error:",e);res.status(500).json({error:"Historie kon niet worden geladen."});}
});
app.post("/api/admin/device-register/:id/operations",requirePermission("device_register.update"),async(req,res)=>{
  try{
    const id=Number(req.params.id),b=req.body||{},operationType=deviceText(b.operationType,30),description=deviceText(b.description,2000),status=deviceText(b.status,40);
    const additionalCost=deviceMoney(b.additionalCost),salePrice=deviceMoney(b.salePrice);
    if(!Number.isSafeInteger(id)||id<=0||!["repair","refurbishment","purchase","sale","note"].includes(operationType)||!Number.isFinite(additionalCost)||!Number.isFinite(salePrice))return res.status(400).json({error:"Controleer de handeling en bedragen."});
    const device=await pool.query("SELECT device_type FROM device_register WHERE id=$1 AND archived=FALSE",[id]);if(!device.rows.length)return res.status(404).json({error:"Actief toestel niet gevonden."});
    const parts=Array.isArray(b.parts)?b.parts.slice(0,100).map(p=>({name:deviceText(p?.name,160),quantity:Math.max(1,Math.min(999,Math.floor(Number(p?.quantity)||1))),cost:deviceMoney(p?.cost)})): [];
    if(parts.some(p=>!p.name||!Number.isFinite(p.cost)))return res.status(400).json({error:"Controleer de onderdelen en hun kosten."});
    const allowed=device.rows[0].device_type==="customer_repair"?customerDeviceStatuses:commercialDeviceStatuses;
    if(status&&!allowed.has(status))return res.status(400).json({error:"Ongeldige status."});
    const client=await pool.connect();try{await client.query("BEGIN");
      const inserted=await client.query("INSERT INTO device_register_operations(device_id,operation_type,status,description,parts,additional_cost,sale_price) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *",[id,operationType,status,description,JSON.stringify(parts),additionalCost,salePrice]);
      if(status)await client.query("UPDATE device_register SET status=$2,updated_at=NOW(),sale_price=CASE WHEN $2='تم البيع' AND $3>0 THEN $3 ELSE sale_price END WHERE id=$1",[id,status,salePrice]);
      else await client.query("UPDATE device_register SET updated_at=NOW() WHERE id=$1",[id]);
      await client.query("COMMIT");res.status(201).json({operation:inserted.rows[0]});
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }catch(e){console.error("Device operation create error:",e);res.status(500).json({error:"Handeling kon niet worden opgeslagen."});}
});
app.post("/api/admin/device-register/:id/archive",requirePermission("device_register.update"),async(req,res)=>{
  try{const id=Number(req.params.id),archived=Boolean(req.body?.archived);if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"Ongeldig toestel."});
    const q=await pool.query("UPDATE device_register SET archived=$2,updated_at=NOW() WHERE id=$1 RETURNING id,archived",[id,archived]);if(!q.rows.length)return res.status(404).json({error:"Toestel niet gevonden."});res.json({success:true,device:q.rows[0]});
  }catch(e){console.error("Device archive error:",e);res.status(500).json({error:"Archiveren/herstellen is mislukt."});}
});

app.get("/api/admin/users",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const q=await pool.query(`SELECT id,username,role,permissions,active,created_at FROM admin_users ORDER BY created_at ASC`);
    res.json({users:q.rows});
  }catch(e){console.error(e);res.status(500).json({error:"Admins konden niet worden geladen."});}
});

app.post("/api/admin/users",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const username=String(req.body?.username||"").trim();
    const password=String(req.body?.password||"");
    const permissions=Array.isArray(req.body?.permissions)?[...new Set(req.body.permissions.map(String))]:[];
    if(!username||!password) return res.status(400).json({error:"Gebruikersnaam en wachtwoord zijn verplicht."});
    if(username.toLowerCase()===String(process.env.ADMIN_USERNAME||"").trim().toLowerCase())
      return res.status(400).json({error:"Deze gebruikersnaam is gereserveerd voor de hoofdadmin."});
    if(password.length<8) return res.status(400).json({error:"Het wachtwoord moet minimaal 8 tekens bevatten."});
    const exists=await pool.query("SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1)",[username]);
    if(exists.rows.length) return res.status(409).json({error:"Deze admin-gebruikersnaam bestaat al."});
    const hash=await hashPassword(password);
    const q=await pool.query(`INSERT INTO admin_users(username,password_hash,role,permissions,active)
      VALUES($1,$2,'admin',$3::jsonb,TRUE)
      RETURNING id,username,role,permissions,active,created_at`,[username,hash,JSON.stringify(permissions)]);
    res.status(201).json({success:true,user:q.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:"Admin kon niet worden aangemaakt."});}
});

app.put("/api/admin/users/:id",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const id=Number(req.params.id), username=String(req.body?.username||"").trim();
    const password=String(req.body?.password||"");
    const permissions=Array.isArray(req.body?.permissions)?[...new Set(req.body.permissions.map(String))]:[];
    const active=req.body?.active!==false;
    if(!Number.isInteger(id)||id<1) return res.status(400).json({error:"Ongeldig admin-ID."});
    if(!username) return res.status(400).json({error:"Gebruikersnaam is verplicht."});
    if(username.toLowerCase()===String(process.env.ADMIN_USERNAME||"").trim().toLowerCase())
      return res.status(400).json({error:"De hoofdadmin wordt beheerd via Render Environment Variables."});
    const dup=await pool.query("SELECT id FROM admin_users WHERE LOWER(username)=LOWER($1) AND id<>$2",[username,id]);
    if(dup.rows.length) return res.status(409).json({error:"Deze gebruikersnaam bestaat al."});
    let q;
    if(password){
      if(password.length<8) return res.status(400).json({error:"Het wachtwoord moet minimaal 8 tekens bevatten."});
      const hash=await hashPassword(password);
      q=await pool.query(`UPDATE admin_users SET username=$1,password_hash=$2,permissions=$3::jsonb,active=$4
        WHERE id=$5 RETURNING id,username,role,permissions,active,created_at`,[username,hash,JSON.stringify(permissions),active,id]);
    }else{
      q=await pool.query(`UPDATE admin_users SET username=$1,permissions=$2::jsonb,active=$3
        WHERE id=$4 RETURNING id,username,role,permissions,active,created_at`,[username,JSON.stringify(permissions),active,id]);
    }
    if(!q.rows.length) return res.status(404).json({error:"Admin niet gevonden."});
    res.json({success:true,user:q.rows[0]});
  }catch(e){console.error(e);res.status(500).json({error:"Admin kon niet worden bijgewerkt."});}
});

app.delete("/api/admin/users/:id",requirePermission("admins.manage"),async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const q=await pool.query("DELETE FROM admin_users WHERE id=$1 RETURNING id",[id]);
    if(!q.rows.length) return res.status(404).json({error:"Admin niet gevonden."});
    res.json({success:true});
  }catch(e){console.error(e);res.status(500).json({error:"Admin kon niet worden verwijderd."});}
});

app.get("/api/admin/search",requirePermission("search"),async(req,res)=>{
  try{
    const q=String(req.query?.q||"").trim();
    if(q.length<2) return res.json({customers:[],orders:[],webshopOrders:[]});
    const like=`%${q}%`;
    const [customers,orders,webshopOrders]=await Promise.all([
      pool.query(`SELECT id,name,email,phone,address,created_at FROM customers
        WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR address ILIKE $1
        ORDER BY created_at DESC LIMIT 20`,[like]),
      pool.query(`SELECT id,service_name,service_category,name,email,phone,username,imei,status,created_at FROM service_orders
        WHERE LOWER(service_category) IN ('reparatie','repair') AND (CAST(id AS TEXT) ILIKE $1 OR service_name ILIKE $1 OR service_category ILIKE $1 OR name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR username ILIKE $1 OR imei ILIKE $1)
        ORDER BY created_at DESC LIMIT 20`,[like]),
      pool.query(`SELECT id,name,email,phone,city,postcode,status,total,created_at FROM webshop_orders
        WHERE CAST(id AS TEXT) ILIKE $1 OR name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR city ILIKE $1 OR postcode ILIKE $1
        ORDER BY created_at DESC LIMIT 20`,[like])
    ]);
    res.json({customers:customers.rows,orders:orders.rows,webshopOrders:webshopOrders.rows});
  }catch(e){console.error(e);res.status(500).json({error:"Zoeken mislukt."});}
});

// Customer self-registration: account remains inactive until email code is confirmed.
app.post("/api/customer/register", async (req, res) => {
  try {
    const { name, email, phone = "", address = "", password } = req.body || {};
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPhone = String(phone || "").trim();
    const cleanAddress = String(address || "").trim();
    if (!cleanName || !cleanEmail || !password) return res.status(400).json({ error: "Vul naam, e-mail en wachtwoord in." });
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    if (String(password).length < 8) return res.status(400).json({ error: "Het wachtwoord moet minimaal 8 tekens bevatten." });
    const existing = await pool.query("SELECT id, email_verified FROM customers WHERE email = $1", [cleanEmail]);
    if (existing.rows.length > 0) {
      if (!existing.rows[0].email_verified) return res.status(409).json({ error: "Voor dit e-mailadres is al een account aangemaakt maar nog niet bevestigd. Vraag een nieuwe code aan." });
      return res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." });
    }

    const passwordHash = await hashPassword(String(password));
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const client = await pool.connect();
    let customer;
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO customers (name,email,phone,address,password_hash,email_verified,email_verification_code_hash,email_verification_expires_at,email_verification_attempts)
         VALUES ($1,$2,$3,$4,$5,FALSE,$6,NOW() + INTERVAL '15 minutes',0)
         RETURNING id,name,email,phone,address`,
        [cleanName, cleanEmail, cleanPhone, cleanAddress, passwordHash, codeHash]
      );
      customer = result.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      await sendCustomerVerificationEmail(customer, code);
    } catch (emailError) {
      console.error("Customer verification email failed:", emailError.message);
      await pool.query("DELETE FROM customers WHERE id = $1 AND email_verified = FALSE", [customer.id]);
      return res.status(503).json({ error: "De bevestigingsmail kon niet worden verstuurd. Controleer de e-mailinstellingen en probeer het opnieuw." });
    }

    res.status(201).json({ success: true, verificationRequired: true, email: customer.email, message: "We hebben een bevestigingscode naar je e-mailadres gestuurd." });
  } catch (error) {
    if (error.code === "23505") return res.status(409).json({ error: "Er bestaat al een account met dit e-mailadres." });
    console.error("Customer registration error:", error);
    res.status(500).json({ error: "Account aanmaken mislukt." });
  }
});

// Confirm public signup with the emailed six-digit code.
app.post("/api/customer/verify-email", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Vul je e-mailadres en de code van 6 cijfers in." });
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const result = await pool.query(
      `UPDATE customers
       SET email_verified = TRUE, email_verification_code_hash = NULL,
           email_verification_expires_at = NULL, email_verification_attempts = 0
       WHERE email = $1 AND email_verified = FALSE
         AND email_verification_code_hash = $2
         AND email_verification_expires_at > NOW()
         AND email_verification_attempts < 5
       RETURNING id,name,email,phone,address`,
      [email, codeHash]
    );
    if (!result.rows.length) {
      await pool.query(
        "UPDATE customers SET email_verification_attempts = email_verification_attempts + 1 WHERE email = $1 AND email_verified = FALSE AND email_verification_expires_at > NOW()",
        [email]
      ).catch(() => {});
      return res.status(400).json({ error: "De code is onjuist of verlopen. Vraag een nieuwe code aan." });
    }
    const customer = result.rows[0];
    sendWelcomeEmail(customer).catch(error => console.error("Verified customer welcome email failed:", error.message));
    const customerToken = jwt.sign({ customerId: customer.id, email: customer.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.cookie("customerToken", customerToken, {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "lax", maxAge: 30 * 24 * 60 * 60 * 1000
    });
    res.json({ success: true, customer, message: "Je e-mailadres is bevestigd en je account is nu actief." });
  } catch (error) {
    console.error("Customer email verification error:", error);
    res.status(500).json({ error: "E-mailadres bevestigen is mislukt. Probeer het opnieuw." });
  }
});

// Send a fresh code to an existing unverified signup.
app.post("/api/customer/resend-verification", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || email.length > 254) return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    const result = await pool.query(
      "SELECT id,name,email,email_verified,email_verification_expires_at FROM customers WHERE email = $1",
      [email]
    );
    if (!result.rows.length || result.rows[0].email_verified) return res.json({ success: true, message: "Als er een onbevestigd account bestaat, wordt een nieuwe code verstuurd." });
    const customer = result.rows[0];
    if (customer.email_verification_expires_at && new Date(customer.email_verification_expires_at).getTime() > Date.now()) {
      return res.status(429).json({ error: "De huidige code is nog geldig. Controleer je e-mail of vraag een nieuwe code aan zodra deze is verlopen." });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    await pool.query(
      "UPDATE customers SET email_verification_code_hash=$1,email_verification_expires_at=NOW()+INTERVAL '15 minutes',email_verification_attempts=0 WHERE id=$2 AND email_verified=FALSE",
      [codeHash, customer.id]
    );
    try {
      await sendCustomerVerificationEmail(customer, code);
    } catch (emailError) {
      console.error("Resend verification email failed:", emailError.message);
      return res.status(503).json({ error: "De nieuwe code kon niet worden verstuurd. Probeer het later opnieuw." });
    }
    res.json({ success: true, message: "We hebben een nieuwe code naar je e-mailadres gestuurd." });
  } catch (error) {
    console.error("Resend customer verification error:", error);
    res.status(500).json({ error: "Een nieuwe code aanvragen is mislukt." });
  }
});

// Request a password reset. Always return the same response to avoid exposing registered emails.
app.post("/api/customer/forgot-password", async (req, res) => {
  const genericMessage = "Als dit e-mailadres bij ons bekend is, ontvang je een e-mail met een link om je wachtwoord opnieuw in te stellen.";
  try {
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    if (!email || email.length > 254) return res.status(200).json({ success: true, message: genericMessage });

    const result = await pool.query("SELECT id, name, email FROM customers WHERE email = $1", [email]);
    if (result.rows.length && process.env.RESEND_API_KEY) {
      const customer = result.rows[0];
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      await pool.query("UPDATE customer_password_resets SET used_at = NOW() WHERE customer_id = $1 AND used_at IS NULL", [customer.id]);
      await pool.query(
        "INSERT INTO customer_password_resets (customer_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
        [customer.id, tokenHash]
      );
      const from = process.env.RESEND_FROM_EMAIL || "noreply@homs-tech.nl";
      const resetUrl = "https://homs-tech.nl/account.html?reset=" + encodeURIComponent(rawToken);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [customer.email],
          subject: "Wachtwoord opnieuw instellen - HOMS TECH",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#222;line-height:1.6">
              <h1 style="color:#0f2740">Wachtwoord opnieuw instellen</h1>
              <p>Hallo ${escapeHtml(customer.name)},</p>
              <p>Je hebt gevraagd om je HOMS TECH-wachtwoord opnieuw in te stellen.</p>
              <p><a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Nieuw wachtwoord instellen</a></p>
              <p>Deze link is één uur geldig en kan maar één keer worden gebruikt. Heb je dit niet aangevraagd? Negeer deze e-mail dan.</p>
              <p style="margin-top:28px"><strong>Team HOMS TECH</strong></p>
              <p style="font-size:12px;color:#64748b">Website: <a href="https://homs-tech.nl">https://homs-tech.nl</a></p>
            </div>
          `
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        console.error("Password reset email failed:", response.status, JSON.stringify(data));
      }
    }
    return res.json({ success: true, message: genericMessage });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(200).json({ success: true, message: genericMessage });
  }
});

// Reset password using a single-use token that expires after one hour.
app.post("/api/customer/reset-password", async (req, res) => {
  try {
    const token = String((req.body || {}).token || "").trim();
    const password = String((req.body || {}).password || "");
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Deze resetlink is ongeldig of verlopen." });
    if (password.length < 8) return res.status(400).json({ error: "Het wachtwoord moet minimaal 8 tekens bevatten." });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const result = await pool.query(
      "SELECT id, customer_id FROM customer_password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()",
      [tokenHash]
    );
    if (!result.rows.length) return res.status(400).json({ error: "Deze resetlink is ongeldig of verlopen." });

    const reset = result.rows[0];
    const passwordHash = await hashPassword(password);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT id FROM customer_password_resets WHERE id = $1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE",
        [reset.id]
      );
      if (!locked.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Deze resetlink is ongeldig of verlopen." });
      }
      await client.query("UPDATE customers SET password_hash = $1 WHERE id = $2", [passwordHash, reset.customer_id]);
      await client.query("UPDATE customer_password_resets SET used_at = NOW() WHERE customer_id = $1 AND used_at IS NULL", [reset.customer_id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json({ success: true, message: "Je wachtwoord is gewijzigd. Je kunt nu inloggen." });
  } catch (error) {
    console.error("Reset password error:", error.message);
    res.status(500).json({ error: "Wachtwoord wijzigen is niet gelukt. Probeer het opnieuw." });
  }
});

// Customer login
app.post("/api/customer/login", async (req, res) => {
  try {
    const {
      email,
      password
    } = req.body || {};

    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanEmail || !password) {
      return res.status(400).json({
        error: "Vul e-mail en wachtwoord in."
      });
    }

    const result = await pool.query(
      `SELECT id, name, email, phone, address, password_hash, email_verified
       FROM customers
       WHERE email = $1`,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Ongeldig e-mailadres of wachtwoord."
      });
    }

    const customer = result.rows[0];

    if (!customer.email_verified) {
      return res.status(403).json({ error: "Bevestig eerst je e-mailadres met de code die we hebben gestuurd." });
    }

    const valid = await verifyPassword(
      String(password),
      customer.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Ongeldig e-mailadres of wachtwoord."
      });
    }

    delete customer.password_hash;

    const customerToken = jwt.sign(
      {
        customerId: customer.id,
        email: customer.email
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

    res.cookie("customerToken", customerToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      customer
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Inloggen mislukt."
    });
  }
});

// Check customer login
app.get("/api/customer/me", async (req, res) => {
  try {
    const token = req.cookies.customerToken;

    if (!token) {
      return res.status(401).json({
        authenticated: false
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const result = await pool.query(
      `SELECT id, name, email, phone, address
       FROM customers
       WHERE id = $1`,
      [decoded.customerId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        authenticated: false
      });
    }

    res.json({
      authenticated: true,
      customer: result.rows[0]
    });
  } catch (error) {
    res.status(401).json({
      authenticated: false
    });
  }
});

// Customer logout
app.post("/api/customer/logout", (req, res) => {
  res.clearCookie("customerToken");

  res.json({
    success: true
  });
});

// ---------------- REPAIR / SERVICE ORDERS ----------------

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
        const decoded = jwt.verify(req.cookies.customerToken, process.env.JWT_SECRET);
        customerId = decoded.customerId || null;
      }
    } catch {}

    const result = await pool.query(
      `INSERT INTO service_orders
       (customer_id, service_category, service_name, service_group, price, name, email, phone, username, imei, notes, service_source_id, service_source_url, price_currency, appointment_date, appointment_time, service_instructions, required_fields, source_price, source_currency, extra_fields)
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
      const notifyEmail = process.env.REPAIR_REQUEST_EMAIL || process.env.ORDER_NOTIFICATION_EMAIL;
      if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL && notifyEmail) {
        try {
          const appointment = isHomeRepair
            ? `<p><b>Afspraak:</b> ${escapeHtml(clean.appointmentDate)} · ${escapeHtml(clean.appointmentTime)}</p>`
            : "";
          const mailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: process.env.RESEND_FROM_EMAIL,
              to: [notifyEmail],
              subject: `Nieuwe HOMS TECH reparatiebestelling #${result.rows[0].id}`,
              html: `<div style="font-family:Arial,sans-serif;color:#203449"><h2>Nieuwe reparatiebestelling #${result.rows[0].id}</h2><p><b>Toestel/service:</b> ${escapeHtml(clean.serviceName)}</p><p><b>Klant:</b> ${escapeHtml(clean.name)}</p><p><b>E-mail:</b> ${escapeHtml(clean.email)}</p><p><b>Telefoon:</b> ${escapeHtml(clean.phone)}</p><p><b>Prijs:</b> ${escapeHtml(clean.price || "Op aanvraag")} ${escapeHtml(clean.priceCurrency || "EUR")}</p>${appointment}<p><b>Opmerking:</b><br>${escapeHtml(clean.notes || "-").replace(/\\n/g, "<br>")}</p><p>Bekijk de aanvraag in de HOMS TECH-admin.</p></div>`
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

    if (clean.serviceCategory.toLowerCase() === "reparatie" && process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const customerResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [clean.email],
            subject: `HOMS TECH — ontvangstbevestiging reparatie #${result.rows[0].id}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#203449"><h2>Bedankt voor uw reparatieaanvraag</h2><p>Beste ${escapeHtml(clean.name)},</p><p>We hebben uw aanvraag voor <b>${escapeHtml(clean.serviceName)}</b> goed ontvangen.</p><p>We bekijken uw aanvraag en nemen zo snel mogelijk contact met u op.</p><p>De definitieve reparatieprijs is pas bevestigd nadat we uw aanvraag hebben beoordeeld.</p><p>Met vriendelijke groet,<br><b>HOMS TECH</b></p></div>`
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

// Inventory deduction is handled by the isolated transaction module.

// ---------------- WEBSHOP ORDERS ----------------

app.post("/api/webshop/orders", async (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const street = String(body.street || "").trim();
    const houseNumber = String(body.houseNumber || "").trim();
    const postcode = String(body.postcode || "").trim();
    const city = String(body.city || "").trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const paymentMethod = String(body.paymentMethod || "Mollie").trim();
    if (!["Mollie", "PayPal", "CashOnDelivery"].includes(paymentMethod)) return res.status(400).json({ error: "Kies een geldige betaalmethode." });
    if (paymentMethod === "CashOnDelivery") {
      const codSettings = await pool.query("SELECT data FROM order_settings WHERE id=1");
      if (codSettings.rows[0]?.data?.cashOnDeliveryEnabled !== true) return res.status(400).json({ error: "Betalen bij ontvangst is momenteel niet beschikbaar." });
    }

    if (!name || !email || !phone || !street || !houseNumber || !postcode || !city || !items.length) {
      return res.status(400).json({ error: "Vul alle verplichte gegevens in en controleer uw winkelwagen." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
    }

    let customerId = null;
    try {
      if (req.cookies.customerToken) {
        const decoded = jwt.verify(req.cookies.customerToken, process.env.JWT_SECRET);
        customerId = decoded.customerId || null;
      }
    } catch {}

    if (items.length > 50) return res.status(400).json({ error: "Te veel producten in één bestelling." });
    const catalogResult = await pool.query("SELECT data FROM site_settings WHERE id = 1");
    const catalogData = catalogResult.rows[0]?.data || {};
    const safeItems = [];
    for (const item of items) {
      const priced = priceProductFromCatalog(catalogData, item);
      if (priced.error) return res.status(400).json({ error: priced.error });
      safeItems.push(priced.item);
    }
    const total = safeItems.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
    if (!Number.isFinite(total) || total <= 0 || total > 100000) {
      return res.status(400).json({ error: "Het totaalbedrag van uw bestelling is ongeldig." });
    }
    const checkoutToken = crypto.randomBytes(32).toString("hex");
    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");

    const result = await pool.query(
      `INSERT INTO webshop_orders
       (customer_id, name, email, phone, street, house_number, postcode, city, items, total, checkout_token, payment_method, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, status, payment_method, payment_status, paypal_order_id, mollie_payment_id, created_at`,
      [
        customerId, name, email, phone, street, houseNumber, postcode, city,
        JSON.stringify(safeItems), total.toFixed(2), checkoutTokenHash, paymentMethod, "Unpaid"
      ]
    );

    // Send the customer an order confirmation to the email address used at checkout.
    if (process.env.RESEND_API_KEY) {
      try {
        const order = result.rows[0];
        const orderFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
        const itemLines = safeItems.map(item => `<li>${escapeHtml(String(item.name || item.title || "Product"))} × ${Number(item.qty || 1)} — €${(Number(item.unitPrice || 0) * Number(item.qty || 1)).toFixed(2)}</li>`).join("");
        const customerResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: orderFromEmail,
            to: [email],
            subject: `HOMS TECH — bevestiging van bestelling #${order.id}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:24px;color:#203449;line-height:1.6"><h1 style="color:#0f2740">Bedankt voor je bestelling!</h1><p>Hallo ${escapeHtml(name)},</p><p>We hebben je bestelling bij HOMS TECH ontvangen. Hieronder vind je het overzicht.</p><p><strong>Bestelnummer:</strong> #${escapeHtml(String(order.id))}</p><h3>Bestelde producten</h3><ul>${itemLines}</ul><p style="font-size:18px"><strong>Totaal: €${total.toFixed(2)}</strong></p><p><strong>Betaalmethode:</strong> ${escapeHtml(paymentMethod)}</p><p><strong>Betaalstatus:</strong> ${escapeHtml(String(order.payment_status || "Unpaid"))}</p><p><strong>Verzendadres:</strong><br>${escapeHtml(street)} ${escapeHtml(houseNumber)}<br>${escapeHtml(postcode)} ${escapeHtml(city)}</p><p>Bewaar deze e-mail als bevestiging van je bestelling. We sturen een update als de status verandert.</p><p>Met vriendelijke groet,<br><strong>Team HOMS TECH</strong></p><p style="font-size:12px;color:#64748b">https://homs-tech.nl</p></div>`
          })
        });
        if (!customerResponse.ok) console.error("Webshop customer confirmation failed:", customerResponse.status, await customerResponse.text().catch(() => ""));
        else console.log("Webshop customer confirmation sent:", (await customerResponse.json().catch(() => ({}))).id || "ok");
      } catch (mailError) { console.error("Webshop customer confirmation error:", mailError.message); }
    }

    // Notify the site owner when a webshop order is created.
    const notifyEmail = process.env.ORDER_NOTIFICATION_EMAIL || process.env.REPAIR_REQUEST_EMAIL;
    if (process.env.RESEND_API_KEY && notifyEmail) {
      try {
        const order = result.rows[0];
        const orderFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
        const itemLines = safeItems.map(item => `<li>${escapeHtml(String(item.name || item.title || "Product"))} × ${Number(item.qty || 1)} — €${(Number(item.unitPrice || 0) * Number(item.qty || 1)).toFixed(2)}</li>`).join("");
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: orderFromEmail,
            to: [notifyEmail],
            subject: `Nieuwe HOMS TECH webshopbestelling #${order.id}`,
            html: `<div style="font-family:Arial,sans-serif;color:#203449"><h2>Nieuwe webshopbestelling #${order.id}</h2><p><b>Klant:</b> ${escapeHtml(name)}</p><p><b>E-mail:</b> ${escapeHtml(email)}</p><p><b>Telefoon:</b> ${escapeHtml(phone)}</p><p><b>Adres:</b> ${escapeHtml(street)} ${escapeHtml(houseNumber)}, ${escapeHtml(postcode)} ${escapeHtml(city)}</p><p><b>Producten:</b></p><ul>${itemLines}</ul><p><b>Totaal:</b> €${total.toFixed(2)}</p><p><b>Betaalmethode:</b> ${escapeHtml(paymentMethod)}</p><p><b>Betaalstatus:</b> ${escapeHtml(String(order.payment_status || "Unpaid"))}</p></div>`
          })
        });
        if (!response.ok) console.error("Webshop order notification failed:", response.status, await response.text().catch(() => ""));
        else console.log("Webshop order notification sent:", (await response.json().catch(() => ({}))).id || "ok");
      } catch (mailError) { console.error("Webshop order notification error:", mailError.message); }
    } else {
      console.error("Webshop order emails skipped: RESEND_API_KEY or order notification email is missing.");
    }

    res.status(201).json({ success: true, order: { ...result.rows[0], checkout_token: checkoutToken } });
  } catch (error) {
    console.error("Create webshop order error:", error);
    res.status(500).json({ error: "Webshop bestelling kon niet worden opgeslagen." });
  }
});

// ---------------- MOLLIE PAYMENTS ----------------
async function mollieRequest(endpoint, options = {}) {
  const apiKey = await getMollieApiKey();
  if (!apiKey) throw new Error("Mollie is nog niet geconfigureerd. Voeg MOLLIE_API_KEY toe aan de serveromgeving.");
  const response = await fetch("https://api.mollie.com/v2" + endpoint, {
    ...options,
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Mollie kon de betaling niet verwerken.");
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

app.get("/api/mollie/config", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { res.json({ enabled: !!(await getMollieApiKey()), provider: "Mollie" }); }
  catch (error) { res.json({ enabled: false, provider: "Mollie" }); }
});

app.post("/api/mollie/create-payment", async (req, res) => {
  try {
    const localOrderId = Number(req.body && req.body.orderId);
    const checkoutToken = String(req.body && req.body.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    }
    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query(
      "SELECT id, name, email, total, payment_status, payment_method, mollie_payment_id FROM webshop_orders WHERE id=$1 AND checkout_token=$2",
      [localOrderId, checkoutTokenHash]
    );
    if (!local.rows.length) return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    const order = local.rows[0];
    if (order.payment_status === "Paid") return res.status(409).json({ error: "Deze bestelling is al betaald." });
    if (order.mollie_payment_id) {
      try {
        const existing = await mollieRequest("/payments/" + encodeURIComponent(order.mollie_payment_id));
        if (molliePaymentMatchesOrder(existing, order) && String(existing.status || "").toLowerCase() === "paid") {
          await pool.query("UPDATE webshop_orders SET payment_status='Paid', payment_method='Mollie' WHERE id=$1 AND mollie_payment_id=$2", [localOrderId, order.mollie_payment_id]);
          await deductPaidOrderInventory(localOrderId);
          return res.status(409).json({ error: "Deze bestelling is al betaald." });
        }
        if (molliePaymentMatchesOrder(existing, order) &&
            !["paid", "canceled", "expired", "failed"].includes(String(existing.status || "").toLowerCase()) &&
            existing._links && existing._links.checkout && existing._links.checkout.href) {
          return res.json({ success: true, checkoutUrl: existing._links.checkout.href, paymentId: existing.id });
        }
      } catch (error) { if (error.statusCode !== 404) throw error; }
    }
    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) return res.status(400).json({ error: "Het orderbedrag is ongeldig." });
    const baseUrl = String(process.env.PUBLIC_BASE_URL || "https://homs-tech.nl").trim().replace(/\/+$/, "");
    const payment = await mollieRequest("/payments", {
      method: "POST",
      body: JSON.stringify({
        amount: { currency: "EUR", value: total.toFixed(2) },
        description: "HOMS TECH bestelling #" + localOrderId,
        redirectUrl: baseUrl + "/checkout.html?mollie=return&orderId=" + localOrderId,
        cancelUrl: baseUrl + "/checkout.html?mollie=cancel&orderId=" + localOrderId,
        webhookUrl: baseUrl + "/api/mollie/webhook",
        metadata: { orderId: String(localOrderId) }
      })
    });
    if (!payment.id || !payment._links || !payment._links.checkout || !payment._links.checkout.href ||
        !molliePaymentMatchesOrder(payment, order)) {
      console.error("Mollie response did not match order", { orderId: localOrderId, paymentId: payment.id || null });
      return res.status(502).json({ error: "Mollie gaf geen geldige betaalpagina terug." });
    }
    await pool.query("UPDATE webshop_orders SET mollie_payment_id=$1, payment_method='Mollie', payment_status='Pending' WHERE id=$2 AND checkout_token=$3 AND payment_status <> 'Paid'", [String(payment.id), localOrderId, checkoutTokenHash]);
    res.json({ success: true, checkoutUrl: payment._links.checkout.href, paymentId: payment.id });
  } catch (error) {
    console.error("Mollie create payment error:", error.statusCode || error.message);
    const status = error.statusCode === 401 || error.statusCode === 403 ? 503 : 500;
    res.status(status).json({ error: error.message || "Mollie betaling kon niet worden gestart." });
  }
});

app.post("/api/mollie/webhook", async (req, res) => {
  try {
    const paymentId = String(req.body && req.body.id || "").trim();
    if (!/^tr_[A-Za-z0-9]+$/.test(paymentId)) return res.sendStatus(400);
    const payment = await mollieRequest("/payments/" + encodeURIComponent(paymentId));
    const orderId = Number(payment && payment.metadata && payment.metadata.orderId);
    if (!Number.isInteger(orderId) || orderId < 1) return res.sendStatus(200);
    const found = await pool.query("SELECT id, total, mollie_payment_id, payment_status FROM webshop_orders WHERE id=$1", [orderId]);
    if (!found.rows.length) return res.sendStatus(200);
    const order = found.rows[0];
    if (String(order.mollie_payment_id || "") !== paymentId || !molliePaymentMatchesOrder(payment, order)) {
      console.error("Mollie webhook order mismatch", { orderId, paymentId });
      return res.sendStatus(200);
    }
    const localStatus = mollieStatusToLocal(payment.status);
    await pool.query("UPDATE webshop_orders SET payment_status=CASE WHEN payment_status='Paid' THEN 'Paid' ELSE $1 END, payment_method='Mollie' WHERE id=$2 AND mollie_payment_id=$3", [localStatus, orderId, paymentId]);
    if (localStatus === 'Paid') await deductPaidOrderInventory(orderId);
    res.sendStatus(200);
  } catch (error) {
    console.error("Mollie webhook error:", error.statusCode || error.message);
    res.sendStatus(500);
  }
});

app.post("/api/mollie/verify-payment", async (req, res) => {
  try {
    const localOrderId = Number(req.body && req.body.orderId);
    const checkoutToken = String(req.body && req.body.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query("SELECT id, total, payment_status, payment_method, mollie_payment_id FROM webshop_orders WHERE id=$1 AND checkout_token=$2", [localOrderId, checkoutTokenHash]);
    if (!local.rows.length) return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    const order = local.rows[0];
    if (order.payment_status === "Paid") return res.json({ success: true, paid: true, status: "Paid", orderId: localOrderId });
    if (!order.mollie_payment_id || order.payment_method !== "Mollie") return res.status(409).json({ error: "Er is geen Mollie-betaling gekoppeld aan deze bestelling." });
    const payment = await mollieRequest("/payments/" + encodeURIComponent(order.mollie_payment_id));
    if (!molliePaymentMatchesOrder(payment, order) || payment.id !== order.mollie_payment_id) return res.status(409).json({ error: "De betaling komt niet overeen met deze bestelling." });
    const status = mollieStatusToLocal(payment.status);
    await pool.query("UPDATE webshop_orders SET payment_status=CASE WHEN payment_status='Paid' THEN 'Paid' ELSE $1 END WHERE id=$2 AND mollie_payment_id=$3", [status, localOrderId, order.mollie_payment_id]);
    if (status === 'Paid') await deductPaidOrderInventory(localOrderId);
    const paid = String(payment.status || "").toLowerCase() === "paid";
    res.json({ success: true, paid, status, orderId: localOrderId });
  } catch (error) {
    console.error("Mollie verify payment error:", error.statusCode || error.message);
    res.status(500).json({ error: "De betaalstatus kon niet worden gecontroleerd. Probeer het opnieuw." });
  }
});

async function getPayPalAccessToken(settings = null) {
  const config = settings || await getPayPalSettings();
  const clientId = String(config.clientId || "").trim();
  const clientSecret = String(config.clientSecret || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("Vul de PayPal Client ID en Client Secret in via Admin > Orderinstellingen.");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(`${getPayPalBaseUrl(config.mode)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`PayPal authenticatie mislukt (${response.status}). Controleer de Client ID, Client Secret en gekozen modus.`);
  }
  return data.access_token;
}

// Public checkout receives only the public client ID and never receives the secret.
app.get("/api/paypal/config", async (req, res) => {
  try {
    const settings = await getPayPalSettings();
    if (!settings.enabled || !settings.clientId || !settings.clientSecret) {
      return res.status(503).json({ enabled: false, error: "PayPal is nog niet geconfigureerd of uitgeschakeld." });
    }
    res.json({ enabled: true, clientId: settings.clientId, mode: settings.mode });
  } catch (error) {
    console.error("PayPal config error:", error.message);
    res.status(503).json({ enabled: false, error: "PayPal is momenteel niet beschikbaar." });
  }
});

app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const localOrderId = Number(req.body?.orderId);
    const checkoutToken = String(req.body?.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    }

    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query(
      `SELECT id, name, email, total, payment_status
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];
    if (order.payment_status === "Paid") {
      return res.status(409).json({ error: "Deze bestelling is al betaald." });
    }

    const total = Number(order.total);
    if (!Number.isFinite(total) || total <= 0) {
      return res.status(400).json({ error: "Het orderbedrag is ongeldig." });
    }

    const paypalSettings = await getPayPalSettings();
    if (!paypalSettings.enabled) return res.status(503).json({ error: "PayPal is momenteel uitgeschakeld." });
    const accessToken = await getPayPalAccessToken(paypalSettings);

    const response = await fetch(`${getPayPalBaseUrl(paypalSettings.mode)}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `homs-tech-${localOrderId}-${Date.now()}`
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: `HOMS-${localOrderId}`,
          description: `HOMS TECH bestelling #${localOrderId}`,
          custom_id: String(localOrderId),
          amount: {
            currency_code: "EUR",
            value: total.toFixed(2)
          }
        }],
        application_context: {
          brand_name: "HOMS TECH",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING"
        }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      console.error("PayPal create order response:", response.status, data);
      return res.status(502).json({ error: "PayPal kon de betaling niet starten." });
    }

    await pool.query(
      `UPDATE webshop_orders
       SET paypal_order_id = $1, payment_method = 'PayPal', payment_status = 'Pending'
       WHERE id = $2 AND checkout_token = $3`,
      [String(data.id), localOrderId, checkoutTokenHash]
    );

    res.json({ success: true, id: data.id, orderId: localOrderId });
  } catch (error) {
    console.error("PayPal create order error:", error);
    res.status(500).json({ error: error.message || "PayPal betaling kon niet worden gestart." });
  }
});

app.post("/api/paypal/capture-order", async (req, res) => {
  try {
    const localOrderId = Number(req.body?.orderId);
    const paypalOrderId = String(req.body?.paypalOrderId || "").trim();
    const checkoutToken = String(req.body?.checkoutToken || "").trim();

    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !paypalOrderId || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige PayPal betaalgegevens." });
    }

    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    const local = await pool.query(
      `SELECT id, total, paypal_order_id, payment_status
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];

    if (String(order.paypal_order_id || "") !== paypalOrderId) {
      return res.status(400).json({ error: "PayPal order komt niet overeen met de webshop bestelling." });
    }

    if (order.payment_status === "Paid") {
      return res.json({ success: true, paid: true, orderId: localOrderId });
    }

    const paypalSettings = await getPayPalSettings();
    if (!paypalSettings.enabled) return res.status(503).json({ error: "PayPal is momenteel uitgeschakeld." });
    const accessToken = await getPayPalAccessToken(paypalSettings);

    const response = await fetch(
      `${getPayPalBaseUrl(paypalSettings.mode)}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: "{}"
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("PayPal capture response:", response.status, data);
      return res.status(502).json({ error: "PayPal kon de betaling niet bevestigen." });
    }

    const captureStatus = String(data.status || "").toUpperCase();
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    const captureState = String(capture?.status || "").toUpperCase();

    const captureAmount = moneyNumber(capture?.amount?.value);
    const captureCurrency = String(capture?.amount?.currency_code || "").toUpperCase();
    const expectedAmount = moneyNumber(order.total);
    if (
      data.id !== paypalOrderId ||
      captureStatus !== "COMPLETED" ||
      captureState !== "COMPLETED" ||
      captureCurrency !== "EUR" ||
      !Number.isFinite(captureAmount) ||
      !Number.isFinite(expectedAmount) ||
      Math.abs(captureAmount - expectedAmount) > 0.005
    ) {
      await pool.query(
        `UPDATE webshop_orders SET payment_status = $1 WHERE id = $2`,
        ["Failed", localOrderId]
      );
      return res.status(402).json({ error: "PayPal betaling is niet voltooid.", paypalStatus: captureStatus });
    }

    await pool.query(
      `UPDATE webshop_orders
       SET payment_status = 'Paid', payment_method = 'PayPal'
       WHERE id = $1`,
      [localOrderId]
    );
    await deductPaidOrderInventory(localOrderId);

    res.json({
      success: true,
      paid: true,
      orderId: localOrderId,
      paypalOrderId,
      captureId: capture?.id || null
    });
  } catch (error) {
    console.error("PayPal capture error:", error);
    res.status(500).json({ error: error.message || "PayPal betaling kon niet worden bevestigd." });
  }
});

app.post("/api/paypal/cancel-order", async (req, res) => {
  try {
    const localOrderId = Number(req.body?.orderId);
    const checkoutToken = String(req.body?.checkoutToken || "").trim();
    if (!Number.isInteger(localOrderId) || localOrderId < 1 || !/^[a-f0-9]{64}$/.test(checkoutToken)) {
      return res.status(400).json({ error: "Ongeldige checkoutgegevens." });
    }

    const checkoutTokenHash = crypto.createHash("sha256").update(checkoutToken).digest("hex");
    await pool.query(
      `UPDATE webshop_orders
       SET payment_status = CASE WHEN payment_status <> 'Paid' THEN 'Cancelled' ELSE payment_status END
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("PayPal cancel error:", error);
    res.status(500).json({ error: "Betaling kon niet worden bijgewerkt." });
  }
});

app.get("/api/payment-methods/config", async (req,res) => {
  try {
    const result = await pool.query("SELECT data FROM order_settings WHERE id=1");
    res.json({cashOnDeliveryEnabled: result.rows[0]?.data?.cashOnDeliveryEnabled === true});
  } catch (error) {
    console.error("Payment methods config error:", error);
    res.status(500).json({cashOnDeliveryEnabled:false});
  }
});

app.get("/api/admin/order-settings", requirePermission("site.save"), async (req,res) => {
  try{
    await pool.query("INSERT INTO order_settings (id,data) VALUES (1,$1::jsonb) ON CONFLICT (id) DO NOTHING", [JSON.stringify({postnlEnabled:false,dhlEnabled:false})]);
    const result=await pool.query("SELECT data FROM order_settings WHERE id=1");
    const settings=result.rows[0]?.data || {postnlEnabled:false,dhlEnabled:false};
    const paypal = settings.paypal || {};
    const envConfigured = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
    res.json({
      settings:{postnlEnabled:!!settings.postnlEnabled,dhlEnabled:!!settings.dhlEnabled,cashOnDeliveryEnabled:!!settings.cashOnDeliveryEnabled},
      paypal:{enabled:typeof paypal.enabled==="boolean"?paypal.enabled:envConfigured,mode:String(paypal.mode||process.env.PAYPAL_MODE||"sandbox").toLowerCase()==="live"?"live":"sandbox",clientId:String(paypal.clientId||process.env.PAYPAL_CLIENT_ID||""),merchantId:String(paypal.merchantId||""),configured:!!(paypal.clientSecretEncrypted||process.env.PAYPAL_CLIENT_SECRET)},
      mollie:{configured:!!(result.rows[0]?.data?.mollie?.apiKeyEncrypted||process.env.MOLLIE_API_KEY)},
      api:{postnl:!!process.env.POSTNL_API_KEY,dhl:!!process.env.DHL_API_KEY}
    });
  }catch(error){
    console.error("Order settings load error:",error.message);
    res.status(500).json({error:"Orderinstellingen konden niet worden geladen."});
  }
});

app.put("/api/admin/order-settings", requirePermission("site.save"), async (req,res) => {
  try{
    const postnlEnabled=req.body?.postnlEnabled===true;
    const dhlEnabled=req.body?.dhlEnabled===true;
    const cashOnDeliveryEnabled=req.body?.cashOnDeliveryEnabled===true;
    if(postnlEnabled && !process.env.POSTNL_API_KEY){
      return res.status(400).json({error:"Voeg eerst POSTNL_API_KEY toe bij Render Environment Variables."});
    }
    if(dhlEnabled && !process.env.DHL_API_KEY){
      return res.status(400).json({error:"Voeg eerst DHL_API_KEY toe bij Render Environment Variables."});
    }
    const currentResult=await pool.query("SELECT data FROM order_settings WHERE id=1");
    const current=currentResult.rows[0]?.data || {};
    const oldPaypal=current.paypal || {};
    const clientId=String(req.body?.paypalClientId ?? oldPaypal.clientId ?? process.env.PAYPAL_CLIENT_ID ?? "").trim();
    const mode=String(req.body?.paypalMode || oldPaypal.mode || process.env.PAYPAL_MODE || "sandbox").toLowerCase()==="live"?"live":"sandbox";
    const merchantId=String(req.body?.paypalMerchantId ?? oldPaypal.merchantId ?? "").trim().slice(0,160);
    const paypalEnabled=req.body?.paypalEnabled===true;
    const newSecret=String(req.body?.paypalClientSecret || "").trim();
    let clientSecretEncrypted=oldPaypal.clientSecretEncrypted || null;
    if(newSecret){
      clientSecretEncrypted=encryptPayPalSecret(newSecret);
    }
    const hasServerSecret=!!clientSecretEncrypted || !!process.env.PAYPAL_CLIENT_SECRET;
    if(paypalEnabled && (!clientId || !hasServerSecret)){
      return res.status(400).json({error:"Vul zowel de PayPal Client ID als Client Secret in voordat je PayPal inschakelt."});
    }
    const paypal={enabled:paypalEnabled,mode,clientId,merchantId,clientSecretEncrypted};
    const oldMollie=current.mollie || {};
    const newMollieKey=String(req.body?.mollieApiKey || "").trim();
    const mollieApiKeyEncrypted=newMollieKey ? encryptPayPalSecret(newMollieKey) : (oldMollie.apiKeyEncrypted || null);
    const settings={...current,postnlEnabled,dhlEnabled,cashOnDeliveryEnabled,paypal,mollie:{apiKeyEncrypted:mollieApiKeyEncrypted}};
    await pool.query(
      "INSERT INTO order_settings (id,data,updated_at) VALUES (1,$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()",
      [JSON.stringify(settings)]
    );
    res.json({success:true,settings:{postnlEnabled,dhlEnabled,cashOnDeliveryEnabled},paypal:{enabled:paypalEnabled,mode,clientId,merchantId,configured:hasServerSecret},mollie:{configured:!!(mollieApiKeyEncrypted||process.env.MOLLIE_API_KEY)},api:{postnl:!!process.env.POSTNL_API_KEY,dhl:!!process.env.DHL_API_KEY}});
  }catch(error){
    console.error("Order settings save error:",error.message);
    res.status(500).json({error:error.message.includes("JWT_SECRET")?error.message:"Orderinstellingen konden niet worden opgeslagen."});
  }
});

// Admin webshop order endpoints live in their own route module.
registerAdminWebshopOrderRoutes(app, { pool, requirePermission, deductPaidOrderInventory });

// Public repair quote requests from the Prices page. Photos are limited and stored with the request.
app.post("/api/repair-requests", async (req, res) => {
  try {
    const b = req.body || {};

    // 1. Honeypot check (anti-bot)
    if (b.website) {
      return res.status(201).json({ success: true, requestNo: Math.floor(10000 + Math.random() * 90000) });
    }

    // 2. Rate limiting check (per IP)
    const clientIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
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

    // 4. Link customer_id if user is authenticated or customer exists by email
    let customerId = null;
    if (req.cookies?.customer_token) {
      try {
        const decoded = jwt.verify(req.cookies.customer_token, process.env.JWT_SECRET || "customer-secret-key");
        if (decoded?.customerId) customerId = decoded.customerId;
      } catch {}
    }
    if (!customerId && email) {
      try {
        const custCheck = await pool.query("SELECT id FROM customers WHERE LOWER(email) = LOWER($1) LIMIT 1", [email]);
        if (custCheck.rows.length) customerId = custCheck.rows[0].id;
      } catch {}
    }

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
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const customerResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [email],
            subject: `HOMS TECH — ontvangstbevestiging reparatieaanvraag #${request.id}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#203449"><h2>Bedankt voor uw reparatieaanvraag</h2><p>Beste ${escapeHtml(name)},</p><p>We hebben uw reparatieaanvraag voor <b>${escapeHtml(brand)} ${escapeHtml(model)}</b> goed ontvangen.</p><p>Ons team bekijkt uw aanvraag en neemt zo snel mogelijk contact met u op over de reparatiemogelijkheden en de prijs.</p><p>Dit bericht is een automatische ontvangstbevestiging; er is nog geen reparatieprijs bevestigd.</p><p>Met vriendelijke groet,<br><b>HOMS TECH</b></p></div>`
          })
        });
        if (!customerResponse.ok) console.error("Repair customer confirmation failed:", customerResponse.status, await customerResponse.text().catch(() => ""));
        else console.log("Repair customer confirmation sent:", request.id);
      } catch (mailError) { console.error("Repair customer confirmation error:", mailError); }
    } else {
      console.error("Repair customer confirmation skipped: missing RESEND_API_KEY or RESEND_FROM_EMAIL");
    }

    // 7. Notify the site owner about repair requests.
    const repairNotifyEmail = process.env.REPAIR_REQUEST_EMAIL || process.env.ORDER_NOTIFICATION_EMAIL;
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL && repairNotifyEmail) {
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL,
            to: [repairNotifyEmail],
            subject: `Nieuwe HOMS TECH reparatieaanvraag #${request.id}`,
            html: `<div style="font-family:Arial,sans-serif;color:#203449"><h2>Nieuwe reparatieaanvraag #${request.id}</h2><p><b>Toestel:</b> ${escapeHtml(brand)} ${escapeHtml(model)}</p><p><b>Probleem:</b><br>${escapeHtml(issue).replace(/\\n/g,"<br>")}</p><p><b>Klant:</b> ${escapeHtml(name)}</p><p><b>E-mail:</b> ${escapeHtml(email)}</p><p><b>Telefoon:</b> ${escapeHtml(phone || "-")}</p><p>Bekijk de aanvraag in de HOMS TECH-admin. Foto's zijn opgeslagen bij de aanvraag.</p></div>`
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

// Admin order endpoints are registered from a dedicated router module.
registerAdminOrderRoutes(app, { pool, requirePermission });
// Dedicated photo endpoint to serve images on-demand with caching
// Authentication middleware
function requireCustomerAuth(req, res, next) {
  try {
    const token = req.cookies.customerToken;

    if (!token) {
      return res.status(401).json({
        error: "Niet ingelogd"
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.customerId = decoded.customerId;
    next();
  } catch (error) {
    res.status(401).json({
      error: "Niet ingelogd"
    });
  }
}

// Update website settings

app.put("/api/site", requireSiteOrPhoneUpdate, async (req, res) => {
  try {
    const section = String(req.headers["x-homs-admin-section"] || "").trim().toLowerCase();

    // A single-product edit updates exactly one array element. It never rewrites
    // the full phone catalog or unrelated site settings.
    const isSinglePhonePatch = section === "phones" &&
      req.body && req.body.phoneItem && typeof req.body.phoneItem === "object" &&
      !Array.isArray(req.body.phoneItem) &&
      Number.isInteger(Number(req.body.phoneIndex)) &&
      req.body.phoneIdentity && typeof req.body.phoneIdentity === "object" &&
      Object.keys(req.body).length === 3;

    if (isSinglePhonePatch) {
      const phoneIndex = Number(req.body.phoneIndex);
      const incomingPhone = req.body.phoneItem;
      const current = await queryWithConnectionRetry(
        "SELECT data->'phones' AS phones FROM site_settings WHERE id = 1",
        [], 4
      );
      const phones = Array.isArray(current.rows[0]?.phones) ? current.rows[0].phones.slice() : [];
      if (phoneIndex < 0 || phoneIndex > phones.length) {
        return res.status(409).json({ error: "De productlijst is gewijzigd. Vernieuw de pagina en probeer opnieuw." });
      }
      if (phoneIndex === phones.length) {
        phones.push(incomingPhone);
      } else {
        const existingPhone = phones[phoneIndex];
        const sameId = incomingPhone.id != null && existingPhone?.id != null &&
          String(incomingPhone.id) === String(existingPhone.id);
        const expected = req.body.phoneIdentity || {};
        const sameLegacyIdentity = incomingPhone.id == null && existingPhone?.id == null &&
          String(expected.name || "").trim() === String(existingPhone?.name || "").trim() &&
          String(expected.brand || "").trim() === String(existingPhone?.brand || "").trim();
        if (!sameId && !sameLegacyIdentity) {
          return res.status(409).json({ error: "Dit product is ondertussen gewijzigd of verplaatst. Vernieuw de pagina om overschrijven te voorkomen." });
        }
        // Match by the already-validated array slot, not by editable name/brand.
        // This preserves old photos even when the admin changes the product name.
        preserveExistingProductPhotos(existingPhone, incomingPhone);
        phones[phoneIndex] = incomingPhone;
      }
      const saved = await queryWithConnectionRetry(
        "UPDATE site_settings SET data = jsonb_set(data, '{phones}', $1::jsonb, true) WHERE id = 1 RETURNING data->'phones' AS phones",
        [JSON.stringify(phones)], 4
      );
      const savedPhones = Array.isArray(saved.rows[0]?.phones) ? saved.rows[0].phones : phones;
      return res.json({ success: true, phoneIndex, phone: savedPhones[phoneIndex] });
    }

    // The phone editor now sends only the phone catalog, not the entire 18+ MB
    // settings document (which also contains large repair-page images).
    // Read and update just this JSON key to reduce request/response memory use.
    const isPhoneCatalogPatch = section === "phones" &&
      req.body && Array.isArray(req.body.phones) &&
      Object.keys(req.body).length === 1;

    if (isPhoneCatalogPatch) {
    const current = await queryWithConnectionRetry(
        "SELECT data->'phones' AS phones FROM site_settings WHERE id = 1",
        [],
        4
      );
      const existing = { phones: current.rows[0]?.phones || [] };
      const incoming = preserveExistingCatalogPhotos(existing, { phones: req.body.phones });

      await queryWithConnectionRetry(
        "UPDATE site_settings SET data = jsonb_set(data, '{phones}', $1::jsonb, true) WHERE id = 1 RETURNING data->'phones' AS phones",
        [JSON.stringify(incoming.phones)],
        4
      );

      return res.json({ success: true, phones: incoming.phones });
    }

    // Save only the buyback catalog keys, not the full site settings document.
    // Preserve existing images by stable IDs if an editor payload omits them.
    const isBuybackCatalogPatch = section === "buyback" &&
    req.body && Array.isArray(req.body.buybackCatalog) &&
    Array.isArray(req.body.buybackPhones) &&
    Object.keys(req.body).length === 2;

    if (isBuybackCatalogPatch) {
    const currentBuyback = await queryWithConnectionRetry(
      "SELECT data->'buybackCatalog' AS catalog, data->'buybackPhones' AS phones FROM site_settings WHERE id = 1",
      [],
      4
    );
    const incomingBuyback = preserveExistingBuybackPhotos({
      buybackCatalog: currentBuyback.rows[0]?.catalog || [],
      buybackPhones: currentBuyback.rows[0]?.phones || []
    }, {
      buybackCatalog: req.body.buybackCatalog,
      buybackPhones: req.body.buybackPhones
    });

    const savedBuyback = await queryWithConnectionRetry(
      "UPDATE site_settings SET data = jsonb_set(jsonb_set(data, '{buybackCatalog}', $1::jsonb, true), '{buybackPhones}', $2::jsonb, true) WHERE id = 1 RETURNING data->'buybackCatalog' AS catalog, data->'buybackPhones' AS phones",
      [JSON.stringify(incomingBuyback.buybackCatalog), JSON.stringify(incomingBuyback.buybackPhones)],
      4
    );
    if (!savedBuyback.rows.length) throw new Error("Site settings record is missing.");
    return res.json({
      success: true,
      buybackCatalog: savedBuyback.rows[0].catalog || [],
      buybackPhones: savedBuyback.rows[0].phones || []
    });
    }

    const isShopCatalogPatch = section === "shop" &&
      req.body && Array.isArray(req.body.shopProducts) &&
      Array.isArray(req.body.expectedShopProducts) &&
      Object.keys(req.body).length === 2;

    if (isShopCatalogPatch) {
      const identifierError = validateShopCatalogIdentifiers(req.body.shopProducts);
      if (identifierError) return res.status(400).json({ error: identifierError });
      const imageError = validateShopCatalogImages(req.body.shopProducts);
      if (imageError) return res.status(400).json({ error: imageError });
      const shopProducts = await saveShopCatalog(
        queryWithConnectionRetry,
        req.body.shopProducts,
        req.body.expectedShopProducts
      );
      if (shopProducts === null) {
        return res.status(409).json({
          error: "De Shop-catalogus is ondertussen door iemand anders gewijzigd. Vernieuw de pagina en controleer de nieuwste gegevens voordat je opnieuw opslaat."
        });
      }
      return res.json({ success: true, shopProducts });
    }

    const current = await queryWithConnectionRetry(
      "SELECT data FROM site_settings WHERE id = 1",
      [],
      4
    );
    const existing = current.rows[0]?.data || {};
    const incoming = preserveExistingCatalogPhotos(existing, req.body || {});

    if (section === "phones" && req.admin.permissions &&
        req.admin.permissions.includes("phones.update") &&
        !req.admin.permissions.includes("site.save") &&
        req.admin.role !== "superadmin" &&
        !req.admin.permissions.includes("*")) {
      const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
      for (const key of keys) {
        if (key === "phones") continue;
        if (JSON.stringify(existing[key]) !== JSON.stringify(incoming[key])) {
          return res.status(403).json({ error: "Deze admin mag alleen Telefoons & prijzen wijzigen." });
        }
      }
    }

    await queryWithConnectionRetry(
      "UPDATE site_settings SET data = $1 WHERE id = 1",
      [JSON.stringify(incoming)],
      4
    );

    res.json({ success: true, data: incoming });
  } catch (error) {
    console.error("Save site settings failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not save settings" });
    }
  }
});

// Admin - get registered customers
app.get("/api/admin/customers", requirePermission("customers.view"), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        email,
        phone,
        address,
        created_at
      FROM customers
      ORDER BY created_at DESC
    `);

    res.json({
      customers: result.rows
    });
  } catch (error) {
    console.error("Admin customers error:", error);

    res.status(500).json({
      error: "Kan klanten niet laden."
    });
  }
});

// Admin customer management (protected by customer-management permission)
app.post("/api/admin/customers", requirePermission("customers.view"), async (req, res) => {
  try {
    const name=String(req.body?.name||"").trim();
    const email=String(req.body?.email||"").trim().toLowerCase();
    const phone=String(req.body?.phone||"").trim();
    const address=String(req.body?.address||"").trim();
    const password=String(req.body?.password||"");
    if(!name||!email||password.length<8) return res.status(400).json({error:"Vul naam, e-mail en een wachtwoord van minimaal 8 tekens in."});
    const passwordHash=await hashPassword(password);
    const result=await pool.query(
      "INSERT INTO customers (name,email,phone,address,password_hash,email_verified,email_verification_code_hash,email_verification_expires_at,email_verification_attempts) VALUES ($1,$2,$3,$4,$5,TRUE,NULL,NULL,0) RETURNING id,name,email,phone,address,created_at",
      [name,email,phone,address,passwordHash]
    );
    sendWelcomeEmail(result.rows[0]).catch(e=>console.error("Admin-created customer welcome email failed:",e.message));
    res.status(201).json({success:true,customer:result.rows[0]});
  } catch(e) {
    if(e.code==="23505") return res.status(409).json({error:"Er bestaat al een account met dit e-mailadres."});
    console.error("Admin create customer error:",e);
    res.status(500).json({error:"Klant aanmaken is mislukt."});
  }
});

app.put("/api/admin/customers/:id", requirePermission("customers.view"), async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const name=String(req.body?.name||"").trim();
    const email=String(req.body?.email||"").trim().toLowerCase();
    const phone=String(req.body?.phone||"").trim();
    const address=String(req.body?.address||"").trim();
    if(!Number.isInteger(id)||id<1||!name||!email) return res.status(400).json({error:"Naam en e-mail zijn verplicht."});
    const result=await pool.query(
      "UPDATE customers SET name=$1,email=$2,phone=$3,address=$4 WHERE id=$5 RETURNING id,name,email,phone,address,created_at",
      [name,email,phone,address,id]
    );
    if(!result.rows.length)return res.status(404).json({error:"Klant niet gevonden."});
    res.json({success:true,customer:result.rows[0]});
  } catch(e) {
    if(e.code==="23505") return res.status(409).json({error:"Dit e-mailadres is al in gebruik."});
    console.error("Admin update customer error:",e);
    res.status(500).json({error:"Klant wijzigen is mislukt."});
  }
});

app.put("/api/admin/customers/:id/password", requirePermission("customers.view"), async (req,res)=>{
  try {
    const id=Number(req.params.id);
    const password=String(req.body?.password||"");
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig klantnummer."});
    if(password.length<8)return res.status(400).json({error:"Het wachtwoord moet minimaal 8 tekens bevatten."});
    const hash=await hashPassword(password);
    const result=await pool.query("UPDATE customers SET password_hash=$1 WHERE id=$2 RETURNING id",[hash,id]);
    if(!result.rows.length)return res.status(404).json({error:"Klant niet gevonden."});
    await pool.query("UPDATE customer_password_resets SET used_at=NOW() WHERE customer_id=$1 AND used_at IS NULL",[id]);
    res.json({success:true,message:"Wachtwoord is gewijzigd."});
  } catch(e) {
    console.error("Admin reset customer password error:",e);
    res.status(500).json({error:"Wachtwoord wijzigen is mislukt."});
  }
});

app.delete("/api/admin/customers/:id", requirePermission("customers.view"), async (req,res)=>{
  try {
    const id=Number(req.params.id);
    if(!Number.isInteger(id)||id<1)return res.status(400).json({error:"Ongeldig klantnummer."});
    const result=await pool.query("DELETE FROM customers WHERE id=$1 RETURNING id",[id]);
    if(!result.rows.length)return res.status(404).json({error:"Klant niet gevonden."});
    res.json({success:true});
  } catch(e) {
    console.error("Admin delete customer error:",e);
    res.status(500).json({error:"Klant verwijderen is mislukt."});
  }
});

// Admin page — always serve the latest editor UI, never a cached copy.
app.get("/admin", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(
    path.join(__dirname, "admin", "index.html")
  );
});

app.get("/admin/", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.sendFile(
    path.join(__dirname, "admin", "index.html")
  );
});

// Start server
initializeDatabaseWithRetry(initDatabase, wait)
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        `HOMS TECH running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error(
      "Database initialization failed after retries:",
      error
    );
    process.exit(1);
  });

// =====================================================
// BUYBACK / UW TOESTEL VERKOPEN ORDERS
// =====================================================
async function ensureBuybackOrdersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS buyback_orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      device TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      storage TEXT DEFAULT '',
      condition TEXT DEFAULT '',
      face_id TEXT DEFAULT '',
      battery TEXT DEFAULT '',
      screen TEXT DEFAULT '',
      offered_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      iban TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nieuw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Keep this compatible with an already-existing buyback_orders table.
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS order_no TEXT`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS model TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS iban TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS final_offer NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS final_offer_sent_at TIMESTAMPTZ`);
  await pool.query(`UPDATE buyback_orders SET order_no = 'BT-LEGACY-' || id WHERE order_no IS NULL`);
  await pool.query(`ALTER TABLE buyback_orders ALTER COLUMN order_no SET NOT NULL`);
}

// Buyback quote calculator. The admin supplies only the four condition base prices.
// The server applies the shared evaluation rules to the selected answers.
const BUYBACK_PROTOCOLS = Object.freeze({
  // Protocol 1 keeps the existing HOMS TECH calculation.
  '1': Object.freeze({functionsNotWorkingMultiplier:0.70,batteryUnder85Multiplier:0.90}),
  // Protocol 2 matches the new flow shown by the user:
  // functions = no -> 33.3333333333% discount, battery <85% -> 10%.
  '2': Object.freeze({functionsNotWorkingMultiplier:1-(33.3333333333/100),batteryUnder85Multiplier:0.90})
});

app.post("/api/buyback/calculate", async (req, res) => {
  try {
    const b = req.body || {};
    const protocol = String(b.protocol || "2") === "1" ? "1" : "2";
    const rules = BUYBACK_PROTOCOLS[protocol];

    let price = Number(b.conditionBasePrice);
    const storageDelta = Number(b.storageDelta || 0);
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "Ongeldige basis-inkoopprijs." });
    }
    if (!Number.isFinite(storageDelta)) {
      return res.status(400).json({ error: "Ongeldige opslagprijsaanpassing." });
    }

    // The server starts from the condition price entered by Admin.
    // Storage adjustment is applied before the condition/function rules.
    price = Math.max(0, price + storageDelta);

    const condition = String(b.condition || "").trim();
    const battery = String(b.battery || "").trim();
    const functions = String(b.functions || "").trim();
    const functionsNoLabel = String(b.functionsNoLabel || "Nee").trim();
    const batteryNoLabel = String(b.batteryNoLabel || "Nee").trim();

    // Admin can change the discount values per phone/protocol.
    const functionsDiscount = Math.max(0, Math.min(100,
      Number.isFinite(Number(b.functionsDiscount)) ? Number(b.functionsDiscount) :
      (1-rules.functionsNotWorkingMultiplier)*100
    ));
    const batteryDiscount = Math.max(0, Math.min(100,
      Number.isFinite(Number(b.batteryDiscount)) ? Number(b.batteryDiscount) :
      (1-rules.batteryUnder85Multiplier)*100
    ));

    const fnMultiplier = Math.max(0, 1 - functionsDiscount/100);
    const batMultiplier = Math.max(0, 1 - batteryDiscount/100);

    // Kapot is a direct purchase price: no further questions affect it.
    if (/kapot/i.test(condition)) {
      return res.json({
        success:true,
        price:Number(price.toFixed(2)),
        basePrice:Number(price.toFixed(2)),
        storageDelta:Number(storageDelta.toFixed(2)),
        adjustments:[],
        protocol,
        broken:true,
        rules:{functionsNotWorkingMultiplier:fnMultiplier,batteryUnder85Multiplier:batMultiplier}
      });
    }

    const adjustments = [];

    const functionsNo =
      protocol === "2"
        ? functions === functionsNoLabel
        : /nee|no|niet/i.test(functions);

    if (functionsNo) {
      const before = price;
      price *= fnMultiplier;
      adjustments.push({
        rule:"functions_not_working",
        discountPercent:functionsDiscount,
        multiplier:fnMultiplier,
        before:Number(before.toFixed(2)),
        after:Number(price.toFixed(2))
      });
    }

    const batteryNo =
      protocol === "2"
        ? battery === batteryNoLabel
        : /onder\s*85|<\s*85|nee|no|niet/i.test(battery);

    if (batteryNo) {
      const before = price;
      price *= batMultiplier;
      adjustments.push({
        rule:"battery_under_85",
        discountPercent:batteryDiscount,
        multiplier:batMultiplier,
        before:Number(before.toFixed(2)),
        after:Number(price.toFixed(2))
      });
    }

    price = Math.max(0, Number(price.toFixed(2)));

    res.json({
      success:true,
      price,
      basePrice:Number(Number(b.conditionBasePrice).toFixed(2)),
      storageDelta:Number(storageDelta.toFixed(2)),
      adjustments,
      protocol,
      rules:{
        functionsNotWorkingMultiplier:fnMultiplier,
        batteryUnder85Multiplier:batMultiplier,
        functionsDiscount,
        batteryDiscount
      },
      broken:false
    });
  } catch (error) {
    console.error("Buyback calculate error:", error);
    res.status(500).json({ error:"Prijs kon niet worden berekend." });
  }
});

app.post("/api/buyback/orders", async (req, res) => {
  try {
    await ensureBuybackOrdersTable();
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const email = String(b.email || "").trim().toLowerCase();

    if (!name || !email || !String(b.device || "").trim()) {
      return res.status(400).json({ error: "Naam, e-mailadres en toestel zijn verplicht." });
    }

    let offeredPrice;
    try {
      offeredPrice = validateBuybackOfferedPrice(b.offeredPrice);
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
    }

    const orderNo = `BT-${Date.now()}`;

    const answers = b.answers && typeof b.answers === "object" && !Array.isArray(b.answers) ? b.answers : {};
    const result = await pool.query(`
      INSERT INTO buyback_orders
      (order_no,name,email,phone,address,device,brand,model,storage,condition,face_id,battery,screen,offered_price,iban,payment_method,answers,status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,'Nieuw')
      RETURNING id,order_no,status,created_at
    `, [
      orderNo,
      name, email,
      String(b.phone || "").trim(),
      String(b.address || "").trim(),
      String(b.device || "").trim(),
      String(b.brand || "").trim(),
      String(b.model || b.device || "").trim(),
      String(b.storage || "").trim(),
      String(b.condition || "").trim(),
      String(b.faceId || "").trim(),
      String(b.battery || "").trim(),
      String(b.screen || "").trim(),
      offeredPrice,
      String(b.iban || "").trim(),
      String(b.paymentMethod || "").trim(),
      JSON.stringify(answers)
    ]);

    const order = result.rows[0];
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const ownerEmail = "Appelavcd116@gmail.com";
    if (apiKey && from) {
      const safeDevice = escapeHtml(b.device || "iPhone");
      const safeName = escapeHtml(name);
      const safeOrder = escapeHtml(order.order_no);
      const customerEmail = {
        from, to:[email], subject:"We hebben uw verkoopaanvraag ontvangen – HOMS TECH",
        html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#1f2937;line-height:1.6"><h2 style="color:#0f2740">Bedankt voor uw aanvraag!</h2><p>Beste ${safeName},</p><p>We hebben uw aanvraag om uw <strong>${safeDevice}</strong> te verkopen goed ontvangen.</p><p>Uw aanvraagnummer is <strong>${safeOrder}</strong>.</p><p>We bekijken de door u ingevulde gegevens en controleren het toestel. Daarna ontvangt u van ons een persoonlijk definitief prijsvoorstel. De getoonde geschatte prijs is nog geen definitief aanbod.</p><p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p></div>`
      };
      const ownerNotice = {
        from, to:[ownerEmail], subject:"Nieuwe iPhone-verkoopaanvraag "+order.order_no,
        html:`<div style="font-family:Arial,sans-serif;max-width:650px;margin:auto;padding:24px;color:#1f2937;line-height:1.6"><h2>Nieuwe verkoopaanvraag ontvangen</h2><p><strong>Nummer:</strong> ${safeOrder}<br><strong>Toestel:</strong> ${safeDevice}<br><strong>Klant:</strong> ${safeName}<br><strong>E-mail:</strong> ${escapeHtml(email)}<br><strong>Telefoon:</strong> ${escapeHtml(b.phone||"-")}<br><strong>Geschatte prijs:</strong> € ${offeredPrice.toFixed(2)}</p><p>Open de HOMS TECH-adminpagina → Verkoopaanvragen om alle antwoorden te bekijken en een definitief aanbod te sturen.</p></div>`
      };
      const sendMail = async mail => {
        const response = await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(mail)});
        const data = await response.json().catch(()=>({}));
        if(!response.ok) throw new Error("Resend "+response.status+": "+JSON.stringify(data));
      };
      const mailResults = await Promise.allSettled([sendMail(customerEmail),sendMail(ownerNotice)]);
      mailResults.forEach((r,i)=>{if(r.status==="rejected")console.error(i===0?"Buyback customer confirmation email failed:":"Buyback owner notification email failed:",r.reason?.message||r.reason);});
    } else {
      console.error("Buyback emails skipped: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.");
    }

    res.status(201).json({ success: true, order });
  } catch (error) {
    console.error("BUYBACK ORDER ERROR:", error);
    res.status(500).json({ error: "Verkoopaanvraag kon niet worden opgeslagen." });
  }
});

app.get("/api/admin/buyback-orders", requirePermission("buyback_orders.view"), async (req, res) => {
  try {
    await ensureBuybackOrdersTable();
    const result = await pool.query(`
      SELECT id,order_no,name,email,phone,address,device,brand,model,storage,condition,
             face_id,battery,screen,offered_price,iban,payment_method,answers,final_offer,final_offer_sent_at,status,created_at
      FROM buyback_orders
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
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) return res.status(503).json({ error: "E-mail is niet ingesteld. Controleer RESEND_API_KEY en RESEND_FROM_EMAIL." });
    const response = await fetch("https://api.resend.com/emails", {
      method:"POST", headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},
      body:JSON.stringify({
        from, to:[order.email], subject:"Uw definitieve prijsvoorstel van HOMS TECH – "+order.order_no,
        reply_to:"mail@inbound.homs-tech.nl",
        html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;color:#1f2937;line-height:1.6"><h2 style="color:#0f2740">Uw prijsvoorstel is klaar</h2><p>Beste ${escapeHtml(order.name)},</p><p>Na beoordeling van uw ${escapeHtml(order.device)} bieden wij u definitief:</p><p style="font-size:30px;font-weight:800;color:#2563eb">€ ${offer.toFixed(2)}</p><p>Dit aanbod is gebaseerd op de door u verstrekte informatie en onze beoordeling. Wilt u akkoord gaan? Beantwoord dan deze e-mail of neem contact met ons op.</p><p>Met vriendelijke groet,<br><strong>HOMS TECH</strong></p></div>`
      })
    });
    const mailData = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error("Resend "+response.status+": "+JSON.stringify(mailData));
    const updated = await pool.query("UPDATE buyback_orders SET final_offer=$1,final_offer_sent_at=NOW(),status='Aanbod verzonden' WHERE id=$2 RETURNING id,status,final_offer,final_offer_sent_at",[offer,req.params.id]);
    res.json({success:true,order:updated.rows[0]});
  } catch (error) {
    console.error("BUYBACK OFFER EMAIL ERROR:",error);
    res.status(500).json({error:"Het prijsvoorstel kon niet worden verstuurd. "+String(error.message||"")});
  }
});

app.put("/api/admin/buyback-orders/:id/status", requirePermission("buyback_orders.update"), async (req, res) => {
  try {
    const allowed = ["Nieuw","In behandeling","Aanbod verzonden","Goedgekeurd","Afgewezen","Voltooid"];
    const status = String(req.body?.status || "").trim();
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Ongeldige status." });
    }

    const result = await pool.query(`
      UPDATE buyback_orders
      SET status=$1
      WHERE id=$2
      RETURNING id,status
    `, [status, req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Verkoopaanvraag niet gevonden." });
    }
    res.json({ success: true, order: result.rows[0] });
  } catch (error) {
    console.error("BUYBACK STATUS ERROR:", error);
    res.status(500).json({ error: "Status kon niet worden gewijzigd." });
  }
});

app.delete("/api/admin/buyback-orders/:id", requirePermission("buyback_orders.delete"), async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM buyback_orders WHERE id=$1 RETURNING id
    `, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Verkoopaanvraag niet gevonden." });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("BUYBACK DELETE ERROR:", error);
    res.status(500).json({ error: "Verkoopaanvraag kon niet worden verwijderd." });
  }
});


app.post("/api/chat/conversations", async (req, res) => {
  try {
    if (!allowLiveChat(req.ip || "unknown")) {
      return res.status(429).json({ error: "Probeer het later opnieuw." });
    }

    const message = String(req.body?.message || "").trim().slice(0, 2000);
    if (!message) {
      return res.status(400).json({ error: "Typ eerst een bericht." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const conversation = await pool.query(
      "INSERT INTO live_chat_conversations(public_token) VALUES($1) RETURNING id,public_token",
      [token]
    );
    const conversationId = conversation.rows[0].id;

    const customerMessage = await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'customer',$2) RETURNING id,sender,message,created_at",
      [conversationId, message]
    );
    const automaticReply = await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'admin',$2) RETURNING id,sender,message,created_at",
      [conversationId, liveChatAutomaticReply(message)]
    );

    await pool.query(
      "UPDATE live_chat_conversations SET updated_at=NOW() WHERE id=$1",
      [conversationId]
    );

    res.status(201).json({
      token: conversation.rows[0].public_token,
      messages: [...customerMessage.rows, ...automaticReply.rows]
    });
  } catch (error) {
    console.error("Live chat create:", error);
    res.status(500).json({ error: "Chat is tijdelijk niet beschikbaar." });
  }
});
app.post("/api/chat/conversations/:token/messages", async (req, res) => {
  try {
    if (!allowLiveChat(req.ip || "unknown")) {
      return res.status(429).json({ error: "Probeer het later opnieuw." });
    }

    const token = String(req.params.token || "");
    const message = String(req.body?.message || "").trim().slice(0, 2000);

    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }
    if (!message) {
      return res.status(400).json({ error: "Typ eerst een bericht." });
    }

    const conversation = await pool.query(
      "SELECT id,status FROM live_chat_conversations WHERE public_token=$1",
      [token]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }
    if (conversation.rows[0].status === "closed") {
      return res.status(409).json({ error: "Dit gesprek is gesloten." });
    }

    const conversationId = conversation.rows[0].id;
    await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'customer',$2)",
      [conversationId, message]
    );
    await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'admin',$2)",
      [conversationId, liveChatAutomaticReply(message)]
    );
    await pool.query(
      "UPDATE live_chat_conversations SET updated_at=NOW() WHERE id=$1",
      [conversationId]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Live chat message:", error);
    res.status(500).json({ error: "Bericht versturen is mislukt." });
  }
});
app.get("/api/chat/conversations/:token/messages", async (req, res) => {
  try {
    const token = String(req.params.token || "");
    if (!/^[a-f0-9]{64}$/.test(token)) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    const conversation = await pool.query(
      "SELECT id,status FROM live_chat_conversations WHERE public_token=$1",
      [token]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    const messages = await pool.query(
      "SELECT id,sender,message,created_at FROM live_chat_messages WHERE conversation_id=$1 ORDER BY id LIMIT 300",
      [conversation.rows[0].id]
    );

    res.json({
      status: conversation.rows[0].status,
      messages: messages.rows
    });
  } catch (error) {
    console.error("Live chat read:", error);
    res.status(500).json({ error: "Berichten laden is mislukt." });
  }
});
app.get("/api/admin/live-chat", requirePermission("orders.view"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT c.id,c.status,c.created_at,c.updated_at,(SELECT message FROM live_chat_messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,(SELECT COUNT(*)::int FROM live_chat_messages m WHERE m.conversation_id=c.id AND m.sender='customer' AND m.read_at IS NULL) AS unread FROM live_chat_conversations c ORDER BY c.updated_at DESC LIMIT 200"
    );
    res.json({ conversations: result.rows });
  } catch (error) {
    console.error("Admin live chat list:", error);
    res.status(500).json({ error: "Gesprekken laden is mislukt." });
  }
});
app.get("/api/admin/live-chat/:id/messages", requirePermission("orders.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig gesprek." });
    }

    const conversation = await pool.query(
      "SELECT id,status FROM live_chat_conversations WHERE id=$1",
      [id]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    const messages = await pool.query(
      "SELECT id,sender,message,created_at FROM live_chat_messages WHERE conversation_id=$1 ORDER BY id LIMIT 500",
      [id]
    );
    await pool.query(
      "UPDATE live_chat_messages SET read_at=NOW() WHERE conversation_id=$1 AND sender='customer' AND read_at IS NULL",
      [id]
    );

    res.json({
      conversation: conversation.rows[0],
      messages: messages.rows
    });
  } catch (error) {
    console.error("Admin live chat messages:", error);
    res.status(500).json({ error: "Berichten laden is mislukt." });
  }
});
app.post("/api/admin/live-chat/:id/messages", requirePermission("orders.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const message = String(req.body?.message || "").trim().slice(0, 2000);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig gesprek." });
    }
    if (!message) {
      return res.status(400).json({ error: "Typ een antwoord." });
    }

    const conversation = await pool.query(
      "SELECT id FROM live_chat_conversations WHERE id=$1",
      [id]
    );
    if (!conversation.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    await pool.query(
      "INSERT INTO live_chat_messages(conversation_id,sender,message) VALUES($1,'admin',$2)",
      [id, message]
    );
    await pool.query(
      "UPDATE live_chat_conversations SET updated_at=NOW() WHERE id=$1",
      [id]
    );

    res.status(201).json({ success: true });
  } catch (error) {
    console.error("Admin live chat reply:", error);
    res.status(500).json({ error: "Antwoord versturen is mislukt." });
  }
});
app.post("/api/admin/live-chat/:id/status", requirePermission("orders.view"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = req.body?.status === "closed" ? "closed" : "open";

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldig gesprek." });
    }

    const result = await pool.query(
      "UPDATE live_chat_conversations SET status=$2,updated_at=NOW() WHERE id=$1 RETURNING id",
      [id, status]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Gesprek niet gevonden." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Admin live chat status:", error);
    res.status(500).json({ error: "Status wijzigen is mislukt." });
  }
});
app.post("/api/chat", (_req, res) => {
  res.status(410).json({
    error: "Gebruik HOMS TECH Chat om ons een bericht te sturen."
  });
});


function buildInvoicePdf(invoice){
 const W=595,H=842,navy=[0.04,0.11,0.19],green=[0.14,0.83,0.40],ink=[0.12,0.16,0.23],muted=[0.38,0.43,0.50],pale=[0.95,0.97,0.98],line=[0.87,0.90,0.93];
 const pages=[];let c=[];
 const rgb=a=>a.map(v=>Number(v).toFixed(3)).join(" ");
 const rect=(x,y,w,h,color)=>c.push(rgb(color)+" rg "+x+" "+y+" "+w+" "+h+" re f");
 const rule=(x1,y1,x2,y2,color=line)=>c.push(rgb(color)+" RG 0.7 w "+x1+" "+y1+" m "+x2+" "+y2+" l S");
 const txt=(x,y,text,size=10,font="F1",color=ink)=>c.push("BT /"+font+" "+size+" Tf "+rgb(color)+" rg 1 0 0 1 "+x+" "+y+" Tm ("+invoicePdfEscape(text)+") Tj ET");
 const euro=n=>"EUR "+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
 const date=new Date(invoice.created_at).toLocaleDateString("nl-NL"),items=Array.isArray(invoice.lines)?invoice.lines:[];
 const perPage=11,pageCount=Math.max(1,Math.ceil(items.length/perPage));
 for(let p=0;p<pageCount;p++){
  c=[];rect(0,720,W,122,navy);rect(0,716,W,4,green);
  txt(42,791,"HOMS TECH",24,"F2",[1,1,1]);txt(43,770,"PHONE REPAIR  |  REFURBISHED DEVICES",8,"F1",[0.82,0.87,0.92]);
  txt(42,744,"FACTUUR",17,"F2",[1,1,1]);txt(420,793,"FACTUURNUMMER",7,"F2",[0.70,0.78,0.85]);txt(420,775,String(invoice.invoice_number||"-"),11,"F2",[1,1,1]);txt(420,752,"DATUM  "+date,9,"F1",[0.90,0.93,0.96]);
  txt(42,681,"FACTUUR AAN",8,"F2",muted);txt(42,658,String(invoice.customer_name||"-").slice(0,48),13,"F2",ink);
  txt(42,640,String(invoice.customer_address||"").slice(0,58),9,"F1",muted);txt(42,624,String(invoice.customer_email||"").slice(0,55),9,"F1",muted);
  txt(340,681,"GEGEVENS LEVERANCIER",8,"F2",muted);txt(340,658,"HOMS TECH",12,"F2",ink);txt(340,640,"KVK: "+(invoice.kvk_number||"Nog niet ingevuld"),9,"F1",muted);txt(340,624,"BTW-ID: "+(invoice.vat_id||"Nog niet ingevuld"),9,"F1",muted);
  const top=p===0?548:590;rect(42,top-8,511,25,pale);
  txt(51,top,"OMSCHRIJVING",8,"F2",muted);txt(333,top,"AANTAL",8,"F2",muted);txt(392,top,"PRIJS",8,"F2",muted);txt(465,top,"BTW",8,"F2",muted);txt(510,top,"TOTAAL",8,"F2",muted);
  let y=top-29;const pageItems=items.slice(p*perPage,(p+1)*perPage);
  for(let j=0;j<pageItems.length;j++){
   const it=pageItems[j],qty=Number(it.quantity)||0,price=Number(it.unitPrice)||0,rate=Number(it.vatRate)||0;
   if(j%2===1)rect(42,y-7,511,23,[0.985,0.988,0.992]);
   txt(51,y,String(it.description||"").slice(0,42),9,"F1",ink);txt(341,y,String(qty),9,"F1",ink);txt(389,y,euro(price),8,"F1",ink);txt(469,y,rate+"%",8,"F1",ink);txt(505,y,euro(qty*price*(1+rate/100)),8,"F2",ink);rule(42,y-10,553,y-10);y-=25;
  }
  if(p===pageCount-1){
   y=Math.min(y-10,230);rule(330,y+6,553,y+6,[0.80,0.84,0.88]);
   txt(355,y-14,"Subtotaal excl. BTW",9,"F1",muted);txt(470,y-14,euro(invoice.subtotal),9,"F1",ink);
   txt(355,y-34,"BTW",9,"F1",muted);txt(470,y-34,euro(invoice.vat_total),9,"F1",ink);
   rect(330,y-68,223,25,navy);txt(343,y-59,"TOTAAL",10,"F2",[1,1,1]);txt(450,y-59,euro(invoice.total),10,"F2",[1,1,1]);
   rect(42,82,511,58,[0.95,0.97,0.98]);rect(42,82,4,58,green);txt(55,123,"BETALEN PER BANKOVERSCHRIJVING",8,"F2",navy);txt(55,106,"Naam: Abdullrahman Nawaya",9,"F1",ink);txt(300,106,"IBAN: NL96 REVO 0480 6699 45",9,"F2",ink);txt(55,91,"Omschrijving: "+String(invoice.invoice_number||"Factuur").slice(0,32),8,"F1",muted);
  }
  rule(42,48,553,48,[0.84,0.87,0.90]);txt(42,32,"HOMS TECH  |  Bedankt voor uw vertrouwen.",8,"F1",muted);txt(470,32,"Pagina "+(p+1)+" / "+pageCount,8,"F1",muted);
  pages.push(c.join("\n"));
 }
 const objects=[];objects.push("<< /Type /Catalog /Pages 2 0 R >>");
 const pageRefs=pages.map((_,i)=>(3+i*2)+" 0 R").join(" ");objects.push("<< /Type /Pages /Kids ["+pageRefs+"] /Count "+pages.length+" >>");
 for(let i=0;i<pages.length;i++){
  const pageObj=3+i*2,streamObj=pageObj+1,stream=pages[i];
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+W+" "+H+"] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents "+streamObj+" 0 R >>");
  objects.push("<< /Length "+Buffer.byteLength(stream,"latin1")+" >>\nstream\n"+stream+"\nendstream");
 }
 let pdf="%PDF-1.4\n",offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf,"latin1"));pdf+=(i+1)+" 0 obj\n"+objects[i]+"\nendobj\n";}
 const xref=Buffer.byteLength(pdf,"latin1");pdf+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n";for(let i=1;i<offsets.length;i++)pdf+=String(offsets[i]).padStart(10,"0")+" 00000 n \n";pdf+="trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";return Buffer.from(pdf,"latin1");
}
app.get("/api/admin/emails",requirePermission("site.save"),async(req,res)=>{
  try{const r=await pool.query("SELECT id,direction,from_address,to_addresses,subject,LEFT(text_body,180) AS preview,attachments,is_read,created_at,message_id,references_header FROM admin_emails ORDER BY created_at DESC,id DESC LIMIT 200");res.json({emails:r.rows});}
  catch(e){console.error("Admin email list:",e);res.status(500).json({error:"E-mails laden is mislukt."});}
});
app.get("/api/admin/emails/:id",requirePermission("site.save"),async(req,res)=>{
  try{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:"Ongeldig bericht."});const r=await pool.query("UPDATE admin_emails SET is_read=TRUE WHERE id=$1 AND direction='inbound' RETURNING *",[id]);if(!r.rows.length){const other=await pool.query("SELECT * FROM admin_emails WHERE id=$1",[id]);if(!other.rows.length)return res.status(404).json({error:"Bericht niet gevonden."});return res.json({email:other.rows[0]});}res.json({email:r.rows[0]});}
  catch(e){console.error("Admin email detail:",e);res.status(500).json({error:"Bericht laden is mislukt."});}
});
app.delete("/api/admin/emails/:id",requirePermission("site.save"),async(req,res)=>{
  try{
    const id=Number(req.params.id);
    if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:"Ongeldig bericht."});
    const result=await pool.query("DELETE FROM admin_emails WHERE id=$1 RETURNING id",[id]);
    if(!result.rowCount)return res.status(404).json({error:"Bericht niet gevonden."});
    return res.json({success:true,id});
  }catch(e){console.error("Admin email delete:",e);return res.status(500).json({error:"E-mail verwijderen is mislukt."});}
});
app.post("/api/admin/emails/send",requirePermission("site.save"),async(req,res)=>{
  try{
    const apiKey=process.env.RESEND_API_KEY,from=process.env.RESEND_FROM_EMAIL;
    if(!apiKey||!from||from==="onboarding@resend.dev")return res.status(503).json({error:"Stel RESEND_API_KEY en een geverifieerd RESEND_FROM_EMAIL in."});
    const to=String(req.body?.to||"").trim().slice(0,254),subject=String(req.body?.subject||"").trim().slice(0,240),textBody=String(req.body?.text||"").trim().slice(0,50000);
    const parseRecipients=value=>String(value||"").split(/[;,]+/).map(x=>x.trim()).filter(Boolean);
    const cc=parseRecipients(req.body?.cc),bcc=parseRecipients(req.body?.bcc),rawAttachments=Array.isArray(req.body?.attachments)?req.body.attachments:[];
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)||!subject||!textBody)return res.status(400).json({error:"Vul een geldig e-mailadres, onderwerp en bericht in."});
    const recipients=[...cc,...bcc];if(recipients.length>20||recipients.some(x=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))return res.status(400).json({error:"Controleer de Cc- en Bcc-e-mailadressen."});
    if(rawAttachments.length>10)return res.status(400).json({error:"Je kunt maximaal 10 bijlagen toevoegen."});
    const allowedTypes=new Set(["image/jpeg","image/png","image/webp","image/gif","image/heic","application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/plain"]);
    let attachmentTotal=0;
    const attachments=rawAttachments.map(file=>{
      const filename=String(file?.filename||"").replace(/[\/\\\r\n]/g,"_").slice(0,180);
      const ext=filename.split(".").pop().toLowerCase();
      const fallbackTypes={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",gif:"image/gif",heic:"image/heic",pdf:"application/pdf",doc:"application/msword",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xls:"application/vnd.ms-excel",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",txt:"text/plain"};
      const mime=String(file?.content_type||fallbackTypes[ext]||"application/octet-stream").toLowerCase();
      const content=String(file?.content||"");
      if(!filename||!content||!allowedTypes.has(mime)||!/^[A-Za-z0-9+/]+={0,2}$/.test(content))throw new Error("Een bijlage heeft een ongeldig formaat.");
      const size=Buffer.from(content,"base64").length;attachmentTotal+=size;
      if(size>10*1024*1024||attachmentTotal>20*1024*1024)throw new Error("Bijlagen mogen maximaal 10 MB per bestand en 20 MB totaal zijn.");
      return {filename,content,content_type:mime};
    });
    const messageHtml=textBody.split(/\r?\n/).map(line=>escapeHtml(line).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/__(.+?)__/g,"<u>$1</u>").replace(/_(.+?)_/g,"<em>$1</em>")).join("<br>");
    const signatureText="\n\n—\nHOMS TECH | Customer Support\nwww.homs-tech.nl";
    const textWithSignature=textBody+signatureText;
    const signatureHtml=`
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:26px;width:100%;max-width:520px;font-family:Arial,Helvetica,sans-serif">
        <tr><td style="border-top:2px solid #2563eb;padding-top:15px"></td></tr>
        <tr>
          <td style="padding:0;color:#10283f">
            <a href="https://homs-tech.nl" target="_blank" style="text-decoration:none;display:inline-block">
              <img src="https://homs-tech.nl/assets/homs-tech-logo.png" width="132" alt="HOMS TECH" style="display:block;width:132px;max-width:132px;height:auto;border:0">
            </a>
            <div style="font-size:16px;line-height:22px;font-weight:700;letter-spacing:1.1px;color:#10283f;margin-top:10px">HOMS TECH</div>
            <div style="font-size:11px;line-height:17px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;margin-top:2px">Customer Support</div>
            <div style="font-size:13px;line-height:20px;margin-top:9px">
              <a href="https://homs-tech.nl" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:600">www.homs-tech.nl</a>
            </div>
          </td>
        </tr>
      </table>`;
    const html=`<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#263445">${messageHtml}${signatureHtml}</div>`;
    const replyToId=Number(req.body?.replyToId)||0;
    let replyHeaders;
    if(replyToId){
      const originalResult=await pool.query("SELECT direction,message_id,references_header FROM admin_emails WHERE id=$1",[replyToId]);
      const original=originalResult.rows[0];
      if(!original||original.direction!=="inbound")return res.status(400).json({error:"Het oorspronkelijke inkomende bericht is niet gevonden. Verstuur dit bericht als nieuw e-mailbericht."});
      // Website contact-form entries are stored locally and have no RFC Message-ID.
      // Allow replying to them as a normal new email; only add threading headers when available.
      if(String(original.message_id||"").trim()){
        const refs=[...new Set((String(original.references_header||"")+" "+String(original.message_id)).match(/<[^<>\s]+>/g)||[])].slice(-20);
        replyHeaders={"In-Reply-To":String(original.message_id).trim(),"References":refs.join(" ")};
      }
    }
    const sendPayload={from,to:[to],cc,bcc,subject,text:textWithSignature,html,reply_to:"mail@inbound.homs-tech.nl",attachments:attachments.map(x=>({filename:x.filename,content:x.content}))};
    if(replyHeaders)sendPayload.headers=replyHeaders;
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify(sendPayload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){console.error("Admin email send provider error:",response.status,JSON.stringify(data));return res.status(502).json({error:"E-mailprovider kon het bericht niet versturen."});}
    await pool.query("INSERT INTO admin_emails(resend_email_id,direction,from_address,to_addresses,subject,text_body,html_body,attachments,is_read) VALUES($1,'outbound',$2,$3::jsonb,$4,$5,$6,$7::jsonb,TRUE)",[String(data.id||"sent-"+Date.now()+"-"+crypto.randomBytes(5).toString("hex")),from,JSON.stringify([to,...cc,...bcc]),subject,textBody,html,JSON.stringify(attachments.map(x=>({filename:x.filename,content_type:x.content_type,size:Buffer.from(x.content,"base64").length}))) ]);
    res.json({success:true,to,attachmentCount:attachments.length});
  }catch(e){console.error("Admin email send:",e);res.status(500).json({error:"E-mail versturen is mislukt."});}
});
app.get("/api/admin/invoices", requirePermission("site.save"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id,invoice_number,customer_name,customer_email,subtotal,vat_total,total,status,created_at FROM manual_invoices ORDER BY id DESC LIMIT 200"
    );
    res.json({ invoices: result.rows });
  } catch (error) {
    console.error("Invoice list:", error);
    res.status(500).json({ error: "Facturen laden is mislukt." });
  }
});
app.post("/api/admin/invoices", requirePermission("site.save"), async (req, res) => {
  try {
    const body = req.body || {};
    const customerName = String(body.customerName || "").trim().slice(0, 160);
    const customerEmail = String(body.customerEmail || "").trim().slice(0, 254);
    const customerAddress = String(body.customerAddress || "").trim().slice(0, 300);
    const kvkNumber = String(body.kvkNumber || "").trim().slice(0, 30);
    const vatId = String(body.vatId || "").trim().slice(0, 40);

    if (
      !customerName ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) ||
      !Array.isArray(body.lines) ||
      !body.lines.length ||
      body.lines.length > 80
    ) {
      return res.status(400).json({
        error: "Vul een klantnaam, geldig e-mailadres en factuurregels in."
      });
    }

    const lines = body.lines.map((item) => ({
      description: String(item.description || "").trim().slice(0, 240),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      vatRate: Number(item.vatRate)
    }));

    const hasInvalidLine = lines.some((item) =>
      !item.description ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 999 ||
      !Number.isFinite(item.unitPrice) ||
      item.unitPrice < 0 ||
      item.unitPrice > 1000000 ||
      ![0, 9, 21].includes(item.vatRate)
    );

    if (hasInvalidLine) {
      return res.status(400).json({
        error: "Een factuurregel bevat ongeldige gegevens."
      });
    }

    const subtotal = lines.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    const vatTotal = lines.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice * item.vatRate / 100,
      0
    );
    const total = subtotal + vatTotal;
    const temporaryInvoiceNumber =
      "HT-PENDING-" + Date.now() + "-" + Math.floor(Math.random() * 100000);

    const inserted = await pool.query(
      "INSERT INTO manual_invoices(invoice_number,customer_name,customer_email,customer_address,kvk_number,vat_id,lines,subtotal,vat_total,total) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10) RETURNING *",
      [
        temporaryInvoiceNumber,
        customerName,
        customerEmail,
        customerAddress,
        kvkNumber,
        vatId,
        JSON.stringify(lines),
        subtotal.toFixed(2),
        vatTotal.toFixed(2),
        total.toFixed(2)
      ]
    );

    const row = inserted.rows[0];
    const invoiceNumber =
      "HT-" + new Date(row.created_at).getFullYear() + "-" +
      String(row.id).padStart(6, "0");

    const updated = await pool.query(
      "UPDATE manual_invoices SET invoice_number=$2 WHERE id=$1 RETURNING *",
      [row.id, invoiceNumber]
    );

    res.status(201).json({
      invoice: {
        id: row.id,
        invoice_number: invoiceNumber,
        created_at: row.created_at,
        status: row.status,
        total: updated.rows[0].total
      }
    });
  } catch (error) {
    console.error("Invoice create:", error);
    res.status(500).json({ error: "Factuur opslaan is mislukt." });
  }
});
app.get("/api/admin/invoices/:id/pdf", requirePermission("site.save"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldige factuur." });
    }

    const result = await pool.query(
      "SELECT * FROM manual_invoices WHERE id=$1",
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Factuur niet gevonden." });
    }

    const invoice = result.rows[0];
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="' + invoice.invoice_number + '.pdf"'
    );
    res.send(buildInvoicePdf(invoice));
  } catch (error) {
    console.error("Invoice PDF:", error);
    res.status(500).json({ error: "PDF maken is mislukt." });
  }
});
app.post("/api/admin/invoices/:id/test-send", requirePermission("site.save"), async (req, res) => {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;

    if (!apiKey) {
      return res.status(503).json({
        error: "E-mail is niet ingesteld: RESEND_API_KEY ontbreekt."
      });
    }
    if (!from || from === "onboarding@resend.dev") {
      return res.status(503).json({
        error: "Stel eerst een geverifieerd afzenderadres in via RESEND_FROM_EMAIL."
      });
    }

    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ error: "Ongeldige factuur." });
    }

    const result = await pool.query(
      "SELECT * FROM manual_invoices WHERE id=$1",
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Factuur niet gevonden." });
    }

    const invoice = result.rows[0];
    const pdf = buildInvoicePdf(invoice);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [invoice.customer_email],
        subject: "HOMS TECH - factuur " + invoice.invoice_number,
        reply_to: "mail@inbound.homs-tech.nl",
        html:
          "<p>In de bijlage vindt u de factuur van HOMS TECH.</p>" +
          "<p><strong>Betalen per bankoverschrijving</strong><br>" +
          "Naam: Abdullrahman Nawaya<br>" +
          "IBAN: NL96 REVO 0480 6699 45<br>" +
          "Omschrijving: " + invoice.invoice_number + "</p>",
        attachments: [{
          filename: invoice.invoice_number + ".pdf",
          content: pdf.toString("base64")
        }]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(
        "Invoice test email provider error:",
        response.status,
        JSON.stringify(data)
      );
      return res.status(502).json({
        error: "E-mailprovider kon de testmail niet versturen. Controleer de e-mailinstellingen."
      });
    }

    res.json({ success: true, to: invoice.customer_email });
  } catch (error) {
    console.error("Invoice test send:", error);
    res.status(500).json({ error: "Testmail versturen is mislukt." });
  }
});
