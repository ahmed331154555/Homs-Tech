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
      "SELECT data->'buybackCatalog' AS catalog, data->'buybackPhones' AS phones FROM site_settings WHERE id = 1",
      [],
      4
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Buyback catalog not found" });
    }
    res.set("Cache-Control", "no-store");
    return res.json(sanitizePublicSiteData({
      buybackCatalog: Array.isArray(result.rows[0].catalog) ? result.rows[0].catalog : [],
      buybackPhones: Array.isArray(result.rows[0].phones) ? result.rows[0].phones : []
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

// ---------------- MOLLIE PAYMENTS ----------------
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
    if (order.payment_method !== "Mollie") return res.status(409).json({ error: "Deze bestelling is niet aangemaakt met Mollie als betaalmethode." });
    if (order.payment_status === "Paid") return res.status(409).json({ error: "Deze bestelling is al betaald." });
    if (order.mollie_payment_id) {
      try {
        const existing = await mollieRequest("/payments/" + encodeURIComponent(order.mollie_payment_id));
        if (molliePaymentMatchesOrder(existing, order) && String(existing.status || "").toLowerCase() === "paid") {
          await pool.query("UPDATE webshop_orders SET payment_status='Paid', payment_method='Mollie' WHERE id=$1 AND mollie_payment_id=$2", [localOrderId, order.mollie_payment_id]);
          const inventoryResult = await deductPaidOrderInventory(localOrderId);
          if (inventoryResult?.error) {
            return res.status(409).json({ error: "De betaling is bevestigd, maar de voorraad kon niet worden bijgewerkt. HOMS TECH controleert dit handmatig." });
          }
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
    // Keep concurrent retries for the same checkout attempt idempotent.
    // A new attempt gets a new key after the previous Mollie payment reaches a terminal state.
    const previousPaymentRef = String(order.mollie_payment_id || "initial").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "initial";
    const mollieIdempotencyKey = `homs-tech-order-${localOrderId}-${previousPaymentRef}`;
    const payment = await mollieRequest("/payments", {
      method: "POST",
      headers: { "Idempotency-Key": mollieIdempotencyKey },
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
    const localStatus = resolveMolliePaymentStatus(order.payment_status, payment.status);
    await pool.query("UPDATE webshop_orders SET payment_status=CASE WHEN payment_status IN ('Paid','Cancelled','Expired','Failed') AND $1 <> 'Paid' THEN payment_status ELSE $1 END, payment_method='Mollie' WHERE id=$2 AND mollie_payment_id=$3", [localStatus, orderId, paymentId]);
    if (localStatus === 'Paid') {
      const inventoryResult = await deductPaidOrderInventory(orderId);
      if (inventoryResult?.error) {
        console.error("Mollie webhook inventory processing failed; provider retry requested:", { orderId, paymentId });
        return res.sendStatus(500);
      }
    }
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
    const status = resolveMolliePaymentStatus(order.payment_status, payment.status);
    await pool.query("UPDATE webshop_orders SET payment_status=CASE WHEN payment_status IN ('Paid','Cancelled','Expired','Failed') AND $1 <> 'Paid' THEN payment_status ELSE $1 END WHERE id=$2 AND mollie_payment_id=$3", [status, localOrderId, order.mollie_payment_id]);
    if (status === 'Paid') {
      const inventoryResult = await deductPaidOrderInventory(localOrderId);
      if (inventoryResult?.error) {
        return res.status(409).json({ error: "De betaling is bevestigd, maar de voorraad kon niet worden bijgewerkt. HOMS TECH controleert dit handmatig.", paid: true, orderId: localOrderId });
      }
    }
    const paid = String(payment.status || "").toLowerCase() === "paid";
    res.json({ success: true, paid, status, orderId: localOrderId });
  } catch (error) {
    console.error("Mollie verify payment error:", error.statusCode || error.message);
    res.status(500).json({ error: "De betaalstatus kon niet worden gecontroleerd. Probeer het opnieuw." });
  }
});

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
      `SELECT id, name, email, total, payment_status, payment_method
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];
    if (order.payment_method !== "PayPal") return res.status(409).json({ error: "Deze bestelling is niet aangemaakt met PayPal als betaalmethode." });
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
        "PayPal-Request-Id": `homs-tech-create-${localOrderId}`
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
      `SELECT id, total, paypal_order_id, payment_status, payment_method
       FROM webshop_orders
       WHERE id = $1 AND checkout_token = $2`,
      [localOrderId, checkoutTokenHash]
    );

    if (!local.rows.length) {
      return res.status(404).json({ error: "Webshop bestelling niet gevonden." });
    }

    const order = local.rows[0];

    if (order.payment_method !== "PayPal") return res.status(409).json({ error: "Deze bestelling is niet aangemaakt met PayPal als betaalmethode." });
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
          "Content-Type": "application/json",
          "PayPal-Request-Id": `homs-tech-capture-${localOrderId}`
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
      data.purchase_units?.[0]?.custom_id !== String(localOrderId) ||
      data.purchase_units?.[0]?.reference_id !== `HOMS-${localOrderId}` ||
      captureStatus !== "COMPLETED" ||
      captureState !== "COMPLETED" ||
      captureCurrency !== "EUR" ||
      !Number.isFinite(captureAmount) ||
      !Number.isFinite(expectedAmount) ||
      Math.abs(captureAmount - expectedAmount) > 0.005
    ) {
      await pool.query(
        `UPDATE webshop_orders SET payment_status = $1 WHERE id = $2 AND paypal_order_id = $3 AND payment_method = 'PayPal' AND payment_status <> 'Paid'`,
        ["Failed", localOrderId, paypalOrderId]
      );
      return res.status(402).json({ error: "PayPal betaling is niet voltooid.", paypalStatus: captureStatus });
    }

    const paidUpdate = await pool.query(
      `UPDATE webshop_orders
       SET payment_status = 'Paid', payment_method = 'PayPal'
       WHERE id = $1 AND paypal_order_id = $2 AND payment_method = 'PayPal' AND payment_status <> 'Paid'
       RETURNING id`,
      [localOrderId, paypalOrderId]
    );
    if (!paidUpdate.rowCount) {
      const latest = await pool.query("SELECT payment_status FROM webshop_orders WHERE id = $1", [localOrderId]);
      if (latest.rows[0]?.payment_status === "Paid") {
        return res.json({ success: true, paid: true, orderId: localOrderId, paypalOrderId, captureId: capture?.id || null });
      }
      return res.status(409).json({ error: "De bestelling is ondertussen gewijzigd. Neem contact op met HOMS TECH." });
    }
    const inventoryResult = await deductPaidOrderInventory(localOrderId);
    if (inventoryResult?.error) {
      return res.status(409).json({ error: "PayPal heeft de betaling bevestigd, maar de voorraad kon niet worden bijgewerkt. HOMS TECH controleert dit handmatig.", paid: true, orderId: localOrderId });
    }

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
    const result = await cancelPaypalOrder({ pool, orderId: localOrderId, checkoutTokenHash });
    res.status(result.statusCode).json(result.body);
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
      paypal: {
        enabled: typeof paypal.enabled === "boolean" ? paypal.enabled : envConfigured,
        mode: String(paypal.mode || process.env.PAYPAL_MODE || "sandbox").toLowerCase() === "live" ? "live" : "sandbox",
        clientId: String(paypal.clientId || process.env.PAYPAL_CLIENT_ID || ""),
        merchantId: String(paypal.merchantId || ""),
        configured: !!(paypal.clientSecretEncrypted || process.env.PAYPAL_CLIENT_SECRET)
      },
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
    res.json({
      success: true,
      settings: { postnlEnabled, dhlEnabled, cashOnDeliveryEnabled },
      paypal: { enabled: paypalEnabled, mode, clientId, merchantId, configured: hasServerSecret },
      mollie: { configured: !!(mollieApiKeyEncrypted || process.env.MOLLIE_API_KEY) },
      api: { postnl: !!process.env.POSTNL_API_KEY, dhl: !!process.env.DHL_API_KEY }
    });
  }catch(error){
    console.error("Order settings save error:",error.message);
    res.status(500).json({error:error.message.includes("JWT_SECRET")?error.message:"Orderinstellingen konden niet worden opgeslagen."});
  }
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
});registerAdminUserRoutes(app, {
  pool,
  requirePermission,
  normalizeAdminPermissions,
  hashPassword,
  getAdminUsername: () => String(process.env.ADMIN_USERNAME || "")
});


