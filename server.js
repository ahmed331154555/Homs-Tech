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
const { buildInvoicePdf } = require("./utils/invoice-pdf");
const path = require("path");
const {
  sanitizeDevicesCatalogData,
  sanitizeCartStockData
} = require("./utils/catalog-sanitizers");
const app = express();
// Render runs the app behind one trusted reverse proxy; use its client IP for rate limits.
app.set("trust proxy", 1);
const { registerAdminOrderRoutes } = require("./routes/admin-orders");
const { registerAdminWebshopOrderRoutes } = require("./routes/admin-webshop-orders");
const { registerAdminBuybackOrderRoutes } = require("./routes/admin-buyback-orders");
const { registerAdminInvoiceRoutes } = require("./routes/admin-invoices");
const { registerAdminInventoryRoutes } = require("./routes/admin-inventory");
const { registerAdminEmailRoutes } = require("./routes/admin-emails");
const { registerContactRoutes } = require("./routes/contact");
const { registerAnnouncementBarRoutes } = require("./routes/announcement-bars");
const { registerBenefitsStripRoutes } = require("./routes/benefits-strip");
const { registerBuybackRoutes } = require("./routes/buyback");
const { registerLiveChatRoutes } = require("./routes/live-chat");
const { registerWebshopCheckoutRoutes } = require("./routes/webshop-checkout");
const { registerPartnerApiRoutes } = require("./routes/partner-api");
const { registerRepairQuoteRoutes } = require("./routes/repair-quote-requests");
const { registerRepairOrderRoutes } = require("./routes/repair-orders");
const { registerCustomerReviewRoutes } = require("./routes/customer-reviews");
const { registerCustomerAuthRoutes } = require("./routes/customer-auth");
const { registerPaymentRoutes } = require("./routes/payments");
const { registerAdminCustomerRoutes } = require("./routes/admin-customers");
const { registerAdminUserRoutes } = require("./routes/admin-users");
const { registerDeviceRegisterRoutes } = require("./routes/device-register");
const { registerResendInboundWebhook } = require("./routes/resend-inbound");
const { validateRepairQuotePayload } = require("./utils/repair-quote");
const { validateBuybackOfferedPrice } = require("./utils/buyback-order");
const { sanitizePublicSiteData, sanitizeHomepageSiteData } = require("./utils/site-data-sanitizers");
const { resolveMolliePaymentStatus, molliePaymentMatchesOrder } = require("./utils/mollie-payment");
const { encryptPayPalSecret, decryptPayPalSecret, getPayPalBaseUrl } = require("./utils/payment-secrets");
const { cancelPaypalOrder } = require("./utils/paypal-payment");
const { allowLiveChat, liveChatFirstReply } = require("./utils/live-chat");
const { checkRepairRequestRateLimit } = require("./utils/repair-request-rate-limit");
const { checkAuthLoginRateLimit } = require("./utils/auth-login-rate-limit");
const { startMemoryMonitor } = require("./utils/memory-monitor");
const { resolveRepairRequestCustomerId } = require("./utils/repair-request-customer");
const { createPaidOrderInventoryDeductor } = require("./utils/paid-order-inventory");
const { priceProductFromCatalog } = require("./utils/cart-pricing");
const { validateCartInventoryQuantities } = require("./utils/cart-inventory-validation");
const { sanitizeProductCatalogData, sanitizeProductFamilyData } = require("./utils/product-catalog-sanitizer");
const { getProductFamilyRecords } = require("./utils/product-family");
const { buildPublicBuybackCatalogPayload, sumDataImageBytes } = require("./utils/buyback-public-catalog");
const { createAdminAuth } = require("./utils/admin-auth");
const { buildAdminSiteSectionSelect, getAdminSiteSection } = require("./utils/admin-site-sections");
const { sanitizeStoredAdminPermissions, normalizeAdminPermissions } = require("./utils/admin-permissions");
const { createCustomerEmails } = require("./utils/customer-emails");
const { ensureBuybackOrdersTable } = require("./utils/buyback-schema");
const { initializeDatabaseWithRetry } = require("./utils/database-initialization");
const { initializeDatabaseSchema } = require("./utils/database-schema");
const { createPaymentSettings } = require("./utils/payment-settings");
const { createPaymentGatewayClients } = require("./utils/payment-gateways");
const {
  preserveExistingProductPhotos,
  preserveExistingCatalogPhotos,
  preserveExistingBuybackPhotos
} = require("./utils/catalog-photo-preservation");
const { saveShopCatalog, validateShopCatalogIdentifiers, validateShopCatalogImages } = require("./utils/shop-catalog");
const PORT = process.env.PORT || 3000;
const SHOP_ENABLED_SQL = "SELECT COALESCE((data->>'shopPageEnabled')::boolean, TRUE) AS enabled FROM site_settings WHERE id = 1";

// Lightweight RSS/heap samples help correlate Render memory spikes with traffic.
startMemoryMonitor();
const { getMollieApiKey, getPayPalSettings } = createPaymentSettings({
  pool,
  getEnv: () => process.env,
  decryptSecret: decryptPayPalSecret
});
const { mollieRequest, getPayPalAccessToken } = createPaymentGatewayClients({
  getMollieApiKey,
  getPayPalSettings,
  getPayPalBaseUrl,
  fetchImpl: fetch
});
const deductPaidOrderInventory = createPaidOrderInventoryDeductor({ pool });
const {
  getSuperAdminUser,
  getAdminFromRequest,
  refreshAdminUserFromDb,
  requirePermission,
  requireSiteOrPhoneUpdate
} = createAdminAuth({
  jwt,
  pool,
  getAdminUsername: () => String(process.env.ADMIN_USERNAME || ""),
  getJwtSecret: () => process.env.JWT_SECRET
});
const { sendCustomerVerificationEmail, sendWelcomeEmail } = createCustomerEmails({
  getEnv: () => process.env,
  fetchImpl: fetch,
  escapeHtml
});


app.use(compression({ threshold: 1024 }));
registerResendInboundWebhook(app, {
  express,
  pool,
  cryptoImpl: crypto,
  getEnv: () => process.env,
  fetchImpl: fetch
});

// Repair quote uploads allow at most 6 MB of decoded photos (about 8 MB Base64).
// Apply a route-specific cap before the broader admin/catalog JSON parser so
// oversized public uploads cannot consume the full 50 MB request budget.
app.use("/api/repair-requests", express.json({ limit: "9mb" }));
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
// Public shop availability switch. Missing setting keeps the existing Shop visible by default.
app.get("/api/shop/status", async (req, res) => {
  try {
    const result = await queryWithConnectionRetry(
      SHOP_ENABLED_SQL,
      [], 4
    );
    if (!result.rows.length) return res.status(404).json({ enabled: true });
    res.set("Cache-Control", "no-store");
    return res.json({ enabled: result.rows[0].enabled !== false });
  } catch (error) {
    console.error("[SHOP STATUS] Load failed:", error);
    return res.status(503).json({ error: "Shopstatus kon niet worden gecontroleerd." });
  }
});

// Serve Shop only while enabled. Redirect direct product links home when temporarily hidden.
app.get("/shop.html", async (req, res) => {
  try {
    const result = await queryWithConnectionRetry(
      SHOP_ENABLED_SQL,
      [], 4
    );
    if (!result.rows.length || result.rows[0].enabled === false) {
      return res.redirect(302, "/");
    }
    return res.sendFile(path.join(__dirname, "shop.html"));
  } catch (error) {
    console.error("[SHOP PAGE] Availability check failed:", error);
    return res.redirect(302, "/");
  }
});

// Serve the crawler policy explicitly and prevent stale browser/CDN caching.
// The policy itself stays in robots.txt so it remains easy to review and maintain.
app.get("/robots.txt", (req, res) => {
  res.set("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.type("text/plain").sendFile(path.join(__dirname, "robots.txt"));
});

app.use(express.static(__dirname, {
  dotfiles: "deny",
  index: "index.html",
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    // Cache versionless static assets briefly; HTML remains revalidated.
    if (/\\.(?:css|js|png|jpe?g|webp|svg|gif|ico|woff2?)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    }
  }
}));

// Create database tables and default settings
// Keep the compact public buyback catalog warm in memory so the first
// customer request does not wait for a database read.
let publicBuybackCatalogCache = null;
let publicBuybackCatalogLoadPromise = null;

async function loadPublicBuybackCatalog() {
  const startedAt = Date.now();
  const result = await queryWithConnectionRetry(
    "SELECT data->'buybackCatalog' AS catalog, data->'buybackPhones' AS phones, data->'phones' AS sales_phones FROM site_settings WHERE id = 1",
    [],
    4
  );
  if (!result.rows.length) throw new Error("Buyback catalog not found");

  const row = result.rows[0];
  const payload = buildPublicBuybackCatalogPayload({
    buybackCatalog: Array.isArray(row.catalog) ? row.catalog : [],
    buybackPhones: Array.isArray(row.phones) ? row.phones : [],
    salesPhones: Array.isArray(row.sales_phones) ? row.sales_phones : []
  });
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
  publicBuybackCatalogCache = payload;
  const imageBytes = {
    catalog: sumDataImageBytes(payload.buybackCatalog),
    buybackPhones: sumDataImageBytes(payload.buybackPhones),
    salesPhones: sumDataImageBytes(payload.salesPhones)
  };
  console.info(
    `[BUYBACK CATALOG] Warmed in ${Date.now() - startedAt}ms; ${payload.buybackPhones.length} active buyback phones, ${payload.salesPhones.length} matching sales records, ${payloadBytes} response bytes; embedded image bytes: ${JSON.stringify(imageBytes)}.`
  );
  return payload;
}

function getPublicBuybackCatalog() {
  if (publicBuybackCatalogCache) return Promise.resolve(publicBuybackCatalogCache);
  if (!publicBuybackCatalogLoadPromise) {
    publicBuybackCatalogLoadPromise = loadPublicBuybackCatalog()
      .finally(() => { publicBuybackCatalogLoadPromise = null; });
  }
  return publicBuybackCatalogLoadPromise;
}

// Serve embedded phone photos separately so the model catalog stays lightweight.
app.get("/api/buyback/image/:id", async (req, res) => {
  const phoneId = String(req.params.id || "");
  const imagePath = String(req.query.path || "");
  const segments = imagePath.split(".");
  if (!phoneId || !imagePath || imagePath.length > 240 ||
      segments.some(segment => !segment || ["__proto__", "prototype", "constructor"].includes(segment))) {
    return res.status(400).end();
  }

  try {
    const result = await queryWithConnectionRetry(
      `SELECT phone
       FROM site_settings,
       LATERAL jsonb_array_elements(COALESCE(data->'buybackPhones', '[]'::jsonb)) AS buyback(phone)
       WHERE phone->>'id' = $1
         AND COALESCE(phone->>'active', 'true') <> 'false'
       LIMIT 1`,
      [phoneId],
      4
    );
    if (!result.rows.length) return res.status(404).end();

    let imageValue = result.rows[0].phone;
    for (const segment of segments) {
      const key = /^\d+$/.test(segment) ? Number(segment) : segment;
      if (!imageValue || typeof imageValue !== "object" ||
          !Object.prototype.hasOwnProperty.call(imageValue, key)) {
        return res.status(404).end();
      }
      imageValue = imageValue[key];
    }

    const match = typeof imageValue === "string"
      ? imageValue.match(/^data:image\/(jpeg|png|webp|gif);base64,([a-z0-9+/]+={0,2})$/i)
      : null;
    if (!match) return res.status(404).end();

    const imageBuffer = Buffer.from(match[2], "base64");
    if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) {
      return res.status(413).end();
    }
    res.set({
      "Content-Type": "image/" + match[1].toLowerCase(),
      "Content-Length": String(imageBuffer.length),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff"
    });
    return res.send(imageBuffer);
  } catch (error) {
    console.error("[BUYBACK IMAGE] Load failed:", error);
    return res.status(500).end();
  }
});

// Serve homepage phone photos separately so large Base64 images never block the catalog JSON.
app.get("/api/homepage/phone-image/:index", async (req, res) => {
  const phoneIndex = String(req.params.index || "");
  const imagePath = String(req.query.path || "");
  const segments = imagePath.split(".");
  if (!/^\\d{1,5}$/.test(phoneIndex) || !imagePath || imagePath.length > 240 ||
      segments.some(segment => !segment || ["__proto__", "prototype", "constructor"].includes(segment))) {
    return res.status(400).end();
  }

  try {
    const result = await queryWithConnectionRetry(
      "SELECT (data->'phones')->$1 AS phone FROM site_settings WHERE id = 1",
      [phoneIndex],
      4
    );
    if (!result.rows.length || !result.rows[0].phone) return res.status(404).end();

    let imageValue = result.rows[0].phone;
    for (const segment of segments) {
      const key = /^\\d+$/.test(segment) ? Number(segment) : segment;
      if (!imageValue || typeof imageValue !== "object" ||
          !Object.prototype.hasOwnProperty.call(imageValue, key)) {
        return res.status(404).end();
      }
      imageValue = imageValue[key];
    }

    const match = typeof imageValue === "string"
      ? imageValue.match(/^data:image\\/(jpeg|png|webp|gif);base64,([a-z0-9+/]+={0,2})$/i)
      : null;
    if (!match) return res.status(404).end();

    const imageBuffer = Buffer.from(match[2], "base64");
    if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) {
      return res.status(413).end();
    }
    res.set({
      "Content-Type": "image/" + match[1].toLowerCase(),
      "Content-Length": String(imageBuffer.length),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff"
    });
    return res.send(imageBuffer);
  } catch (error) {
    console.error("[HOMEPAGE PHONE IMAGE] Load failed:", error);
    return res.status(500).end();
  }
});

// Serve homepage repair-service photos separately from the settings payload.
app.get("/api/homepage/service-image/:index", async (req, res) => {
  const serviceIndex = String(req.params.index || "");
  if (!/^\\d{1,3}$/.test(serviceIndex)) return res.status(400).end();

  try {
    const result = await queryWithConnectionRetry(
      "SELECT (data->'services')->$1->>3 AS image FROM site_settings WHERE id = 1",
      [serviceIndex],
      4
    );
    const image = result.rows[0]?.image;
    const match = typeof image === "string"
      ? image.match(/^data:image\\/(jpeg|png|webp|gif);base64,([a-z0-9+/]+={0,2})$/i)
      : null;
    if (!match) return res.status(404).end();

    const imageBuffer = Buffer.from(match[2], "base64");
    if (!imageBuffer.length || imageBuffer.length > 5 * 1024 * 1024) return res.status(413).end();
    res.set({
      "Content-Type": "image/" + match[1].toLowerCase(),
      "Content-Length": String(imageBuffer.length),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff"
    });
    return res.send(imageBuffer);
  } catch (error) {
    console.error("[HOMEPAGE SERVICE IMAGE] Load failed:", error);
    return res.status(500).end();
  }
});

app.get("/api/buyback/catalog", async (req, res) => {
  try {
    const payload = await getPublicBuybackCatalog();
    res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=30");
    return res.json(payload);
  } catch (error) {
    console.error("[BUYBACK CATALOG] Load failed:", error);
    return res.status(500).json({ error: "Buyback catalog could not be loaded" });
  }
});

registerAnnouncementBarRoutes(app, {
  requirePermission,
  queryWithConnectionRetry
});
registerBenefitsStripRoutes(app, {
  requirePermission,
  queryWithConnectionRetry
});

// Load only the allowlisted JSONB fields needed by the requested admin editor.
app.get("/api/admin/site-data/:section", async (req, res) => {
  const section = String(req.params.section || "").trim().toLowerCase();
  const config = getAdminSiteSection(section);
  if (!config) return res.status(404).json({ error: "Onbekende beheerpagina." });

  return requirePermission(config.permission, { allowSiteSave: true })(req, res, async () => {
    try {
      const sql = buildAdminSiteSectionSelect(section);
      const result = await queryWithConnectionRetry(sql, [], 4);
      if (!result.rows.length) {
        return res.status(404).json({ error: "Website-instellingen niet gevonden." });
      }
      res.set("Cache-Control", "no-store");
      return res.json(result.rows[0]);
    } catch (error) {
      console.error("[ADMIN SITE DATA] Load failed:", error);
      return res.status(500).json({ error: "Beheergegevens konden niet worden geladen." });
    }
  });
});

// Save only the allowlisted fields for lightweight admin sections.
app.put("/api/admin/site-data/:section", async (req, res) => {
  const section = String(req.params.section || "").trim().toLowerCase();
  const config = getAdminSiteSection(section);
  if (!config) return res.status(404).json({ error: "Onbekende beheerpagina." });

  return requirePermission(config.writePermission || "site.save")(req, res, async () => {
    try {
      const allowedFields = Array.isArray(config.writeFields) ? config.writeFields : [];
      const body = req.body;
      if (!allowedFields.length) {
        return res.status(405).json({ error: "Deze pagina gebruikt een gespecialiseerde opslagroute." });
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return res.status(400).json({ error: "Ongeldige beheergegevens." });
      }
      const keys = Object.keys(body);
      if (!keys.length || keys.some(key => !allowedFields.includes(key))) {
        return res.status(400).json({ error: "De opslag bevat velden die niet bij deze pagina horen." });
      }

      const result = await queryWithConnectionRetry(
        "UPDATE site_settings SET data = data || $1::jsonb WHERE id = 1 RETURNING id",
        [JSON.stringify(body)],
        4
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: "Website-instellingen niet gevonden." });
      }
      res.set("Cache-Control", "no-store");
      return res.json({ success: true });
    } catch (error) {
      console.error("[ADMIN SITE DATA] Save failed:", error);
      return res.status(500).json({ error: "Beheergegevens konden niet worden opgeslagen." });
    }
  });
});

// Return only the selected product family, not the entire phone catalog.
app.get("/api/product/:id", async (req, res) => {
  const productIndex = Number(req.params.id);
  if (!Number.isSafeInteger(productIndex) || productIndex < 0) {
    return res.status(400).json({ error: "Ongeldig productnummer." });
  }

  try {
    const result = await queryWithConnectionRetry(
      `SELECT
        data->'phones' AS phones,
        data->>'businessName' AS business_name,
        data->>'siteName' AS site_name,
        data->>'tagline' AS tagline
      FROM site_settings
      WHERE id = 1`,
      [],
      4
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Product niet gevonden." });
    }

    const row = result.rows[0];
    const familyRecords = getProductFamilyRecords(
      Array.isArray(row.phones) ? row.phones : [],
      productIndex
    );
    const payload = sanitizeProductFamilyData({
      phones: familyRecords.map(record => ({
        index: record.index,
        product: record.phone
      })),
      productIndex,
      businessName: row.business_name,
      siteName: row.site_name,
      tagline: row.tagline
    });

    if (!payload.product) {
      return res.status(404).json({ error: "Product niet gevonden." });
    }

    res.set("Cache-Control", "public, max-age=10, stale-while-revalidate=30");
    return res.json(payload);
  } catch (error) {
    console.error("[PUBLIC PRODUCT] Load failed:", error);
    return res.status(500).json({ error: "Productgegevens konden niet worden geladen." });
  }
});

// Get website settings
app.get("/api/site", async (req, res) => {
  try {
    const view=String(req.query.view||"").trim().toLowerCase();
    if(view==="footer"){
      // The shared footer needs only contact details and its own settings.
      // Do not serialize the full site document/catalog for every public page.
      const result = await queryWithConnectionRetry(
        `SELECT
          data->'homepage'->'footer' AS footer,
          data->>'areas' AS areas,
          data->>'phone' AS phone,
          data->>'whatsapp' AS whatsapp
        FROM site_settings
        WHERE id = 1`,
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];
      res.set("Cache-Control","public, max-age=0, must-revalidate");
      return res.json(sanitizePublicSiteData({
        homepage:{footer:row.footer && typeof row.footer === "object" ? row.footer : {}},
        areas:row.areas,
        phone:row.phone,
        whatsapp:row.whatsapp
      }));
    }
    if(view==="repair"){
      const result = await queryWithConnectionRetry(
        `SELECT
          data->'repairPage' AS repair_page,
          data->'services' AS services,
          data->>'businessName' AS business_name,
          data->>'siteName' AS site_name,
          data->>'tagline' AS tagline,
          COALESCE(NULLIF(BTRIM(data->>'whatsapp'), ''), NULLIF(BTRIM(data->'homepage'->'footer'->>'whatsapp'), '')) AS whatsapp
        FROM site_settings
        WHERE id = 1`,
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];
      // Repair-page settings are public and change infrequently; short caching avoids a database round-trip on every visit.
      res.set("Cache-Control","public, max-age=60, stale-while-revalidate=300");
      return res.json(sanitizePublicSiteData({
        repairPage:row.repair_page,
        services:Array.isArray(row.services)?row.services:[],
        businessName:row.business_name,
        siteName:row.site_name,
        tagline:row.tagline,
        whatsapp:row.whatsapp
      }));
    }
    if(view==="devices"){
      const result = await queryWithConnectionRetry(
        `SELECT
          data->'phones' AS phones,
          data->'devices' AS devices,
          data->'phone' AS phone,
          data->'whatsapp' AS whatsapp,
          data->'businessName' AS business_name,
          data->'siteName' AS site_name,
          data->'tagline' AS tagline
        FROM site_settings
        WHERE id = 1`,
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];
      res.set("Cache-Control","public, max-age=10, stale-while-revalidate=30");
      return res.json(sanitizeDevicesCatalogData({phones:row.phones,devices:row.devices,phone:row.phone,whatsapp:row.whatsapp,businessName:row.business_name,siteName:row.site_name,tagline:row.tagline}));
    }
    if(view==="product"){
      const result=await queryWithConnectionRetry(
        `SELECT
          data->'phones' AS phones,
          data->'phone' AS phone,
          data->'whatsapp' AS whatsapp,
          data->'businessName' AS business_name,
          data->'siteName' AS site_name,
          data->'tagline' AS tagline
        FROM site_settings
        WHERE id = 1`,
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];
      res.set("Cache-Control","public, max-age=0, must-revalidate");
      return res.json(sanitizeProductCatalogData({
        phones: row.phones,
        phone: row.phone,
        whatsapp: row.whatsapp,
        businessName: row.business_name,
        siteName: row.site_name,
        tagline: row.tagline
      }));
    }
    if(view==="shop"){
      const result=await queryWithConnectionRetry(
        "SELECT data->'shopProducts' AS shop_products FROM site_settings WHERE id=1",
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      res.set("Cache-Control","public, max-age=0, must-revalidate");
      return res.json(sanitizePublicSiteData({
        shopProducts:Array.isArray(result.rows[0].shop_products)?result.rows[0].shop_products:[]
      }));
    }
    if(view==="cart"){
      const result=await queryWithConnectionRetry("SELECT data->'shopProducts' AS shop_products FROM site_settings WHERE id=1",[],4);
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      res.set("Cache-Control","public, max-age=0, must-revalidate");
      return res.json({shopProducts:sanitizeCartStockData(result.rows[0].shop_products)});
    }
    if(view==="about"){
      const result=await queryWithConnectionRetry(
        `SELECT
          data->>'businessName' AS business_name,
          data->>'siteName' AS site_name,
          data->>'tagline' AS tagline,
          data->>'areas' AS areas,
          data->'why' AS why,
          data->'features' AS features,
          data->>'whatsapp' AS whatsapp,
          data->>'phone' AS phone
        FROM site_settings
        WHERE id=1`,
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];
      res.set("Cache-Control","public, max-age=0, must-revalidate");
      return res.json(sanitizePublicSiteData({
        businessName:row.business_name || row.site_name,
        tagline:row.tagline,
        areas:row.areas,
        why:row.why,
        features:row.features,
        whatsapp:row.whatsapp,
        phone:row.phone
      }));
    }
    if(view==="prices"){
      const result=await queryWithConnectionRetry(
        `SELECT
          data->>'businessName' AS business_name,
          data->>'siteName' AS site_name,
          data->>'tagline' AS tagline,
          data->>'whatsapp' AS whatsapp,
          data->>'phone' AS phone
        FROM site_settings
        WHERE id=1`,
        [],
        4
      );
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      const row=result.rows[0];
      res.set("Cache-Control","public, max-age=0, must-revalidate");
      return res.json(sanitizePublicSiteData({
        businessName:row.business_name,
        siteName:row.site_name,
        tagline:row.tagline,
        whatsapp:row.whatsapp,
        phone:row.phone
      }));
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
      const tokenUser = getAdminFromRequest(req);
      const user = await refreshAdminUserFromDb(tokenUser);
      canViewPrivate = !!user && (
        user.role === "superadmin" ||
        user.username === String(process.env.ADMIN_USERNAME || "") ||
        user.permissions?.includes("*") ||
        user.permissions?.includes("site.save")
      );
    } catch {}
    const data = result.rows[0].data;
    if (view === "home" && (!Array.isArray(data?.phones) || data.phones.length === 0)) {
      console.warn("[HOMEPAGE CATALOG] Stored phone catalog is empty or invalid.", {
        phonesType: Array.isArray(data?.phones) ? "array" : typeof data?.phones,
        popularEnabled: data?.homepage?.popular?.enabled !== false,
        selectedCount: Array.isArray(data?.homepage?.popular?.indexes) ? data.homepage.popular.indexes.length : 0
      });
    }
    // Private/admin responses must never be cached. Public responses can be revalidated
    // so repeat visits avoid transferring the full settings payload when unchanged.
    // Homepage settings change frequently through the admin panel. Avoid serving a
    // stale compact catalog from an intermediary cache after products are updated.
    res.set("Cache-Control", canViewPrivate || view === "home"
      ? "no-store"
      : "public, max-age=0, must-revalidate");
    if (!canViewPrivate && view === "home") {
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

registerContactRoutes(app, { pool, escapeHtml, cryptoImpl: crypto, getEnv: () => process.env, fetchImpl: fetch });

// Admin login + permissions


app.post("/api/login", async (req,res)=>{
  try{
    const loginIp = String(req.ip || req.socket.remoteAddress || "").trim();
    if (!checkAuthLoginRateLimit("admin", loginIp)) {
      return res.status(429).json({ error: "Te veel inlogpogingen. Wacht 15 minuten en probeer het opnieuw." });
    }
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

    const user={id:a.id,username:a.username,role:a.role||"admin",permissions:sanitizeStoredAdminPermissions(a.permissions)};
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
    const normalized={id:a.id,username:a.username,role:a.role||"admin",permissions:sanitizeStoredAdminPermissions(a.permissions)};
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

registerDeviceRegisterRoutes(app, {
  pool,
  requirePermission,
  deviceText,
  deviceMoney
});

registerCustomerAuthRoutes(app, {
  pool,
  crypto,
  jwt,
  hashPassword,
  verifyPassword,
  sendCustomerVerificationEmail,
  sendWelcomeEmail,
  escapeHtml,
  fetchImpl: fetch,
  getEnv: () => process.env
});

registerRepairOrderRoutes(app, {
  pool,
  jwt,
  escapeHtml,
  fetchImpl: fetch,
  getEnv: () => process.env
});

// Inventory deduction is handled by the isolated transaction module.

// ---------------- WEBSHOP ORDERS ----------------

registerPartnerApiRoutes(app, { pool, cryptoImpl: crypto, requirePermission });

registerWebshopCheckoutRoutes(app, {
  pool,
  jwt,
  crypto,
  escapeHtml,
  fetchImpl: fetch,
  getEnv: () => process.env,
  priceProductFromCatalog,
  validateCartInventoryQuantities
});

registerPaymentRoutes(app, {
  pool,
  crypto,
  requirePermission,
  getMollieApiKey,
  mollieRequest,
  getPayPalSettings,
  getPayPalAccessToken,
  cancelPaypalOrder,
  resolveMolliePaymentStatus,
  molliePaymentMatchesOrder,
  encryptPayPalSecret,
  getPayPalBaseUrl,
  deductPaidOrderInventory,
  fetchImpl: fetch,
  getEnv: () => process.env,
  escapeHtml
});

// Admin webshop order endpoints live in their own route module.
registerAdminWebshopOrderRoutes(app, {
  pool,
  requirePermission,
  mollieRequest,
  deductPaidOrderInventory,
  ensureBuybackOrdersTable,
  fetchImpl: fetch,
  getEnv: () => process.env,
  escapeHtml
});

registerRepairQuoteRoutes(app, {
  pool,
  checkRepairRequestRateLimit,
  validateRepairQuotePayload,
  resolveRepairRequestCustomerId,
  jwt,
  escapeHtml,
  fetchImpl: fetch,
  getEnv: () => process.env
});

// Admin order endpoints are registered from a dedicated router module.
registerAdminOrderRoutes(app, {
  pool,
  requirePermission,
  escapeHtml,
  fetchImpl: fetch,
  getEnv: () => process.env
});
registerAdminBuybackOrderRoutes(app, {
  pool,
  requirePermission,
  ensureBuybackOrdersTable,
  escapeHtml,
  crypto,
  fetchImpl: fetch,
  getEnv: () => process.env
});

registerAdminInvoiceRoutes(app, {
  pool,
  requirePermission,
  buildInvoicePdf
});

registerAdminInventoryRoutes(app, { pool, requirePermission });

registerAdminEmailRoutes(app, {
  pool,
  requirePermission,
  escapeHtml,
  crypto
});
// Dedicated photo endpoint to serve images on-demand with caching
// Authentication middleware
// Update website settings

// Admin-only toggle for temporarily hiding the public Shop without deleting products.
app.get("/api/admin/shop-visibility", requirePermission("site.save"), async (req, res) => {
  try {
    const result = await queryWithConnectionRetry(
      SHOP_ENABLED_SQL,
      [], 4
    );
    if (!result.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });
    return res.json({ enabled: result.rows[0].enabled !== false });
  } catch (error) {
    console.error("[ADMIN SHOP VISIBILITY] Load failed:", error);
    return res.status(500).json({ error: "Shopinstelling laden is mislukt." });
  }
});

app.put("/api/admin/shop-visibility", requirePermission("site.save"), async (req, res) => {
  try {
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ error: "Ongeldige Shop-instelling." });
    }
    const result = await queryWithConnectionRetry(
      "UPDATE site_settings SET data = jsonb_set(data, '{shopPageEnabled}', to_jsonb($1::boolean), TRUE) WHERE id = 1 RETURNING (data->>'shopPageEnabled')::boolean AS enabled",
      [req.body.enabled], 4
    );
    if (!result.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });
    return res.json({ success: true, enabled: result.rows[0].enabled });
  } catch (error) {
    console.error("[ADMIN SHOP VISIBILITY] Save failed:", error);
    return res.status(500).json({ error: "Shopinstelling opslaan is mislukt." });
  }
});

app.put("/api/site", requireSiteOrPhoneUpdate, async (req, res) => {
  try {
    const section = String(req.headers["x-homs-admin-section"] || "").trim().toLowerCase();
    const phoneSharedFields = ["phoneFolders", "globalConditionDetails", "globalConditionOverviewImage"];
    const hasPhoneSharedData = Object.prototype.hasOwnProperty.call(req.body || {}, "sharedData");
    const phoneSharedData = hasPhoneSharedData ? req.body.sharedData : {};
    const validPhoneSharedData = !hasPhoneSharedData || (
      phoneSharedData && typeof phoneSharedData === "object" && !Array.isArray(phoneSharedData) &&
      Object.keys(phoneSharedData).every(key => phoneSharedFields.includes(key)) &&
      (!Object.prototype.hasOwnProperty.call(phoneSharedData, "phoneFolders") || Array.isArray(phoneSharedData.phoneFolders)) &&
      (!Object.prototype.hasOwnProperty.call(phoneSharedData, "globalConditionDetails") || Array.isArray(phoneSharedData.globalConditionDetails)) &&
      (!Object.prototype.hasOwnProperty.call(phoneSharedData, "globalConditionOverviewImage") || typeof phoneSharedData.globalConditionOverviewImage === "string")
    );
    if (section === "phones" && hasPhoneSharedData && !validPhoneSharedData) {
      return res.status(400).json({ error: "Ongeldige gedeelde telefoongegevens." });
    }
    const phoneSharedJson = JSON.stringify(validPhoneSharedData ? phoneSharedData : {});

    // A single-product edit updates exactly one array element and its small
    // shared editor fields. Unrelated catalog entries stay outside Node memory.
    const singlePhoneKeys = Object.keys(req.body || {});
    const isSinglePhonePatch = section === "phones" &&
      req.body && req.body.phoneItem && typeof req.body.phoneItem === "object" &&
      !Array.isArray(req.body.phoneItem) &&
      Number.isInteger(Number(req.body.phoneIndex)) &&
      req.body.phoneIdentity && typeof req.body.phoneIdentity === "object" &&
      singlePhoneKeys.every(key => ["phoneItem", "phoneIndex", "phoneIdentity", "sharedData"].includes(key));

    if (isSinglePhonePatch) {
      const phoneIndex = Number(req.body.phoneIndex);
      const incomingPhone = req.body.phoneItem;
      const current = await queryWithConnectionRetry(
        "SELECT jsonb_array_length(COALESCE(data->'phones', '[]'::jsonb)) AS phone_count, data->'phones'->($1::int) AS phone FROM site_settings WHERE id = 1",
        [phoneIndex], 4
      );
      if (!current.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });
      const phoneCount = Number(current.rows[0].phone_count || 0);
      if (phoneIndex < 0 || phoneIndex > phoneCount) {
        return res.status(409).json({ error: "De productlijst is gewijzigd. Vernieuw de pagina en probeer opnieuw." });
      }

      let saved;
      if (phoneIndex === phoneCount) {
        saved = await queryWithConnectionRetry(
          "UPDATE site_settings SET data = (jsonb_set(data, '{phones}', COALESCE(data->'phones', '[]'::jsonb) || jsonb_build_array($1::jsonb), true) || $3::jsonb) WHERE id = 1 RETURNING data->'phones'->($2::int) AS phone",
          [JSON.stringify(incomingPhone), phoneIndex, phoneSharedJson], 4
        );
      } else {
        const existingPhone = current.rows[0].phone;
        const sameId = incomingPhone.id != null && existingPhone?.id != null &&
          String(incomingPhone.id) === String(existingPhone.id);
        const expected = req.body.phoneIdentity || {};
        const sameLegacyIdentity = incomingPhone.id == null && existingPhone?.id == null &&
          String(expected.name || "").trim() === String(existingPhone?.name || "").trim() &&
          String(expected.brand || "").trim() === String(existingPhone?.brand || "").trim();
        if (!sameId && !sameLegacyIdentity) {
          return res.status(409).json({ error: "Dit product is ondertussen gewijzigd of verplaatst. Vernieuw de pagina om overschrijven te voorkomen." });
        }
        // Load and preserve photos for this product only; unrelated product
        // images never enter the Node.js heap during a single-product save.
        preserveExistingProductPhotos(existingPhone, incomingPhone);
        saved = await queryWithConnectionRetry(
          "UPDATE site_settings SET data = (jsonb_set(data, ARRAY['phones', $2::text], $1::jsonb, false) || $3::jsonb) WHERE id = 1 RETURNING data->'phones'->($2::int) AS phone",
          [JSON.stringify(incomingPhone), phoneIndex, phoneSharedJson], 4
        );
      }
      if (!saved.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });
      return res.json({ success: true, phoneIndex, phone: saved.rows[0].phone });
    }

    // The phone editor sends the catalog plus its small shared editor fields,
    // never the entire 18+ MB settings document with unrelated page images.
    // Read and update only the phone projection and supplied shared JSONB keys.
    const phoneCatalogKeys = Object.keys(req.body || {});
    const isPhoneCatalogPatch = section === "phones" &&
      req.body && Array.isArray(req.body.phones) &&
      phoneCatalogKeys.every(key => ["phones", "sharedData"].includes(key));

    if (isPhoneCatalogPatch) {
      const current = await queryWithConnectionRetry(
        `SELECT COALESCE(
          (
            SELECT jsonb_agg(jsonb_build_object(
              'id', phone->'id',
              'name', phone->'name',
              'model', phone->'model',
              'images', phone->'images',
              'colorImages', phone->'colorImages',
              'colorGalleryImages', phone->'colorGalleryImages',
              'colorGallery', phone->'colorGallery',
              'galleryImages', phone->'galleryImages',
              'variantImages', phone->'variantImages'
            ))
            FROM jsonb_array_elements(COALESCE(data->'phones', '[]'::jsonb)) AS items(phone)
          ),
          '[]'::jsonb
        ) AS phones
        FROM site_settings
        WHERE id = 1`,
        [],
        4
      );
      if (!current.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });

      // Preserve only image fields for matching products. Avoid loading every
      // product's specifications, descriptions, options and pricing into Node.
      const existing = { phones: current.rows[0].phones || [] };
      const incoming = preserveExistingCatalogPhotos(existing, { phones: req.body.phones });

      const saved = await queryWithConnectionRetry(
        "UPDATE site_settings SET data = (jsonb_set(data, '{phones}', $1::jsonb, true) || $2::jsonb) WHERE id = 1 RETURNING id",
        [JSON.stringify(incoming.phones), phoneSharedJson],
        4
      );
      if (!saved.rows.length) return res.status(404).json({ error: "Website-instellingen niet gevonden." });

      // The admin already has the submitted catalog in memory; do not send
      // the full image-heavy catalog back over HTTP after saving it.
      return res.json({ success: true });
    }

    if (section === "phones") {
      return res.status(400).json({ error: "Ongeldige gegevens voor het opslaan van telefoons." });
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
    publicBuybackCatalogCache = null;
    getPublicBuybackCatalog().catch(error => console.warn("[BUYBACK CATALOG] Refresh after admin save failed:", error.message));
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
      const saved = await saveShopCatalog(
        queryWithConnectionRetry,
        req.body.shopProducts,
        req.body.expectedShopProducts
      );
      if (!saved) {
        return res.status(409).json({
          error: "De Shop-catalogus is ondertussen door iemand anders gewijzigd. Vernieuw de pagina en controleer de nieuwste gegevens voordat je opnieuw opslaat."
        });
      }
      // The browser already has the submitted catalog; avoid sending all
      // product photos back in the response after a successful save.
      return res.json({ success: true });
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

registerAdminCustomerRoutes(app, { pool, requirePermission, hashPassword, sendWelcomeEmail });

const customerReviewRoutes = registerCustomerReviewRoutes(app, {
  pool,
  requirePermission,
  getEnv: () => process.env,
  fetchImpl: fetch
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

registerBuybackRoutes(app, {
  pool,
  crypto,
  escapeHtml,
  fetchImpl: fetch,
  ensureBuybackOrdersTable,
  validateBuybackOfferedPrice
});

registerLiveChatRoutes(app, {
  pool,
  crypto,
  requirePermission,
  allowLiveChat,
  liveChatFirstReply
});

registerAdminUserRoutes(app, {
  pool,
  requirePermission,
  normalizeAdminPermissions,
  hashPassword,
  getAdminUsername: () => String(process.env.ADMIN_USERNAME || "")
});

// Start server
initializeDatabaseWithRetry(async () => {
  await initializeDatabaseSchema(pool);
  await customerReviewRoutes.ensureCustomerReviewSchema(pool);
  try {
    await getPublicBuybackCatalog();
  } catch (error) {
    console.warn("[BUYBACK CATALOG] Startup warm-up skipped:", error.message);
  }
}, wait)
  .then(() => {
    customerReviewRoutes.startWorker();
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