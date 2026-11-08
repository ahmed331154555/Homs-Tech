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
const { registerAdminEmailRoutes } = require("./routes/admin-emails");
const { registerContactRoutes } = require("./routes/contact");
const { registerAnnouncementBarRoutes } = require("./routes/announcement-bars");
const { registerBuybackRoutes } = require("./routes/buyback");
const { registerLiveChatRoutes } = require("./routes/live-chat");
const { registerWebshopCheckoutRoutes } = require("./routes/webshop-checkout");
const { registerRepairQuoteRoutes } = require("./routes/repair-quote-requests");
const { registerRepairOrderRoutes } = require("./routes/repair-orders");
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
const { resolveRepairRequestCustomerId } = require("./utils/repair-request-customer");
const { createPaidOrderInventoryDeductor } = require("./utils/paid-order-inventory");
const { priceProductFromCatalog } = require("./utils/cart-pricing");
const { validateCartInventoryQuantities } = require("./utils/cart-inventory-validation");
const { sanitizeProductCatalogData } = require("./utils/product-catalog-sanitizer");
const { createAdminAuth } = require("./utils/admin-auth");
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
      "SELECT COALESCE((data->>'shopPageEnabled')::boolean, TRUE) AS enabled FROM site_settings WHERE id = 1",
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
      "SELECT COALESCE((data->>'shopPageEnabled')::boolean, TRUE) AS enabled FROM site_settings WHERE id = 1",
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
// Lightweight public catalog for the customer buyback page.
// Avoid downloading the full site settings document (which can contain large
// repair/product images) just to render the buyback model selector.
app.get("/api/buyback/catalog", async (req, res) => {
  try {
    const result = await queryWithConnectionRetry(
      "SELECT data->'buybackCatalog' AS catalog, data->'buybackPhones' AS phones, data->'phones' AS sales_phones FROM site_settings WHERE id = 1",
      [],
      4
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Buyback catalog not found" });
    }
    res.set("Cache-Control", "no-store");
    return res.json(sanitizePublicSiteData({
      buybackCatalog: Array.isArray(result.rows[0].catalog) ? result.rows[0].catalog : [],
      buybackPhones: Array.isArray(result.rows[0].phones) ? result.rows[0].phones : [],
      // Only public model identity, display images and customer-facing specs are exposed.
      salesPhones: (Array.isArray(result.rows[0].sales_phones) ? result.rows[0].sales_phones : []).map(phone => {
        if (!phone || typeof phone !== "object") return null;
        return {
          name: phone.name || "",
          brand: phone.brand || "",
          image: phone.image || (Array.isArray(phone.images) ? phone.images.find(Boolean) : "") || "",
          images: Array.isArray(phone.images) ? phone.images.filter(Boolean).slice(0, 4) : [],
          screenSize: phone.screenSize || "",
          processor: phone.processor || "",
          memory: phone.memory || "",
          gpu: phone.gpu || "",
          releaseYear: phone.releaseYear || "",
          connectivity: phone.connectivity || "",
          specifications: Array.isArray(phone.specifications) ? phone.specifications : []
        };
      }).filter(Boolean)
    }));
  } catch (error) {
    console.error("[BUYBACK CATALOG] Load failed:", error);
    return res.status(500).json({ error: "Buyback catalog could not be loaded" });
  }
});

registerAnnouncementBarRoutes(app, {
  requirePermission,
  queryWithConnectionRetry
});

// Get website settings
app.get("/api/site", async (req, res) => {
  try {
    const view=String(req.query.view||"").trim().toLowerCase();
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
      res.set("Cache-Control","no-store");
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
      res.set("Cache-Control","public, max-age=0, must-revalidate");
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
    if(view==="cart"){
      const result=await queryWithConnectionRetry("SELECT data->'shopProducts' AS shop_products FROM site_settings WHERE id=1",[],4);
      if(!result.rows.length)return res.status(404).json({error:"Settings not found"});
      res.set("Cache-Control","public, max-age=0, must-revalidate");
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
registerAdminWebshopOrderRoutes(app, { pool, requirePermission, deductPaidOrderInventory, ensureBuybackOrdersTable });

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
registerAdminOrderRoutes(app, { pool, requirePermission });
registerAdminBuybackOrderRoutes(app, {
  pool,
  requirePermission,
  ensureBuybackOrdersTable,
  escapeHtml
});

registerAdminInvoiceRoutes(app, {
  pool,
  requirePermission,
  buildInvoicePdf
});

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
      "SELECT COALESCE((data->>'shopPageEnabled')::boolean, TRUE) AS enabled FROM site_settings WHERE id = 1",
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

registerAdminCustomerRoutes(app, { pool, requirePermission, hashPassword });

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
initializeDatabaseWithRetry(() => initializeDatabaseSchema(pool), wait)
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