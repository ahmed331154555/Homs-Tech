"use strict";

const crypto = require("crypto");

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function safeText(value, max = 180) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function parseStock(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const match = String(value == null ? "" : value).trim().match(/^\d+/);
  return match ? Number(match[0]) : null;
}

function getPartnerProductId(phone, index, phones = []) {
  const explicitId = safeText(phone?.id, 120);
  if (explicitId) return explicitId;
  const name = safeText(phone?.name || phone?.title, 180).toLocaleLowerCase();
  const sku = safeText(phone?.sku, 100).toLocaleLowerCase();
  if (!name && !sku) return "";
  const identity = [
    safeText(phone?.brand || "Apple", 80).toLocaleLowerCase(),
    name,
    sku
  ].join("|");
  const occurrence = phones.slice(0, Math.max(0, index)).filter(item => {
    const other = [
      safeText(item?.brand || "Apple", 80).toLocaleLowerCase(),
      safeText(item?.name || item?.title, 180).toLocaleLowerCase(),
      safeText(item?.sku, 100).toLocaleLowerCase()
    ].join("|");
    return other === identity;
  }).length;
  return "legacy-" + crypto.createHash("sha256").update(identity + "|" + occurrence).digest("hex").slice(0, 24);
}

function hasVariantPricing(phone) {
  return phone?.pricingMode === "variant" && Array.isArray(phone.variantPrices) && phone.variantPrices.length > 0;
}

function registerPartnerApiRoutes(app, { pool, cryptoImpl = crypto, requirePermission }) {
  const admin = requirePermission("site.save");

  app.get("/api/admin/partners", admin, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id,name,email,active,created_at,updated_at FROM api_partners ORDER BY created_at DESC"
      );
      res.set("Cache-Control", "no-store");
      return res.json({ partners: result.rows });
    } catch (error) {
      console.error("[PARTNER API] List partners failed:", error);
      return res.status(500).json({ error: "Partners konden niet worden geladen." });
    }
  });

  app.post("/api/admin/partners", admin, async (req, res) => {
    try {
      const name = safeText(req.body?.name, 120);
      const email = safeText(req.body?.email, 180).toLowerCase();
      if (!name) return res.status(400).json({ error: "Partnernaam is verplicht." });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
      }
      const token = "htp_" + cryptoImpl.randomBytes(32).toString("hex");
      const result = await pool.query(
        "INSERT INTO api_partners(name,email,token_hash) VALUES($1,$2,$3) RETURNING id,name,email,active,created_at",
        [name, email, hashToken(token)]
      );
      res.set("Cache-Control", "no-store");
      return res.status(201).json({ success: true, partner: result.rows[0], apiKey: token });
    } catch (error) {
      if (error?.code === "23505") return res.status(409).json({ error: "Deze partner bestaat al." });
      console.error("[PARTNER API] Create partner failed:", error);
      return res.status(500).json({ error: "Partner kon niet worden aangemaakt." });
    }
  });

  app.patch("/api/admin/partners/:id", admin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ongeldig partner-ID." });
    try {
      const active = req.body?.active;
      if (typeof active !== "boolean") return res.status(400).json({ error: "Geef active als true of false op." });
      const result = await pool.query(
        "UPDATE api_partners SET active=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,email,active,created_at,updated_at",
        [active, id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Partner niet gevonden." });
      return res.json({ success: true, partner: result.rows[0] });
    } catch (error) {
      console.error("[PARTNER API] Update partner failed:", error);
      return res.status(500).json({ error: "Partner kon niet worden bijgewerkt." });
    }
  });

  app.get("/api/admin/partners/:id/prices", admin, async (req, res) => {
    const partnerId = Number(req.params.id);
    if (!Number.isSafeInteger(partnerId) || partnerId < 1) return res.status(400).json({ error: "Ongeldig partner-ID." });
    try {
      const [partner, catalog, saved] = await Promise.all([
        pool.query("SELECT id FROM api_partners WHERE id=$1", [partnerId]),
        pool.query("SELECT data->'phones' AS phones FROM site_settings WHERE id=1"),
        pool.query("SELECT product_id,variant_key,wholesale_price FROM api_partner_prices WHERE partner_id=$1", [partnerId])
      ]);
      if (!partner.rows.length) return res.status(404).json({ error: "Partner niet gevonden." });
      const phones = Array.isArray(catalog.rows[0]?.phones) ? catalog.rows[0].phones : [];
      const savedMap = new Map(saved.rows.map(row => [row.product_id + "::" + row.variant_key, Number(row.wholesale_price)]));
      const items = [];
      for (const [phoneIndex, phone] of phones.entries()) {
        if (!phone || typeof phone !== "object" || phone.active === false || phone.available === false) continue;
        const productId = getPartnerProductId(phone, phoneIndex, phones);
        if (!productId) continue;
        const variants = hasVariantPricing(phone) ? phone.variantPrices.filter(v => v && v.active !== false && v.available !== false) : [null];
        for (const variant of variants) {
          const variantKey = variant ? [variant.storage, variant.color, variant.condition].map(v => safeText(v, 80)).join("|") : "";
          const key = productId + "::" + variantKey;
          items.push({
            productId, variantKey, name: safeText(phone.name || phone.title, 180),
            sku: safeText(variant?.sku || phone.sku, 100),
            storage: safeText(variant?.storage || phone.storage, 40),
            color: safeText(variant?.color || phone.color, 80),
            condition: safeText(variant?.condition || phone.condition, 80),
            stock: parseStock(variant ? variant.stock : phone.stock),
            wholesalePrice: savedMap.has(key) ? savedMap.get(key) : null
          });
        }
      }
      res.set("Cache-Control", "no-store");
      return res.json({ items });
    } catch (error) {
      console.error("[PARTNER API] Load wholesale prices failed:", error);
      return res.status(500).json({ error: "Groothandelsprijzen konden niet worden geladen." });
    }
  });

  app.put("/api/admin/partners/:id/prices", admin, async (req, res) => {
    const partnerId = Number(req.params.id);
    const prices = req.body?.prices;
    if (!Number.isSafeInteger(partnerId) || partnerId < 1 || !Array.isArray(prices) || prices.length > 1000) {
      return res.status(400).json({ error: "Ongeldige partner of prijslijst." });
    }
    const normalized = [];
    const seen = new Set();
    for (const item of prices) {
      const productId = safeText(item?.productId, 120);
      const variantKey = safeText(item?.variantKey || "", 180);
      const wholesalePrice = Number(item?.wholesalePrice);
      if (!productId || !Number.isFinite(wholesalePrice) || wholesalePrice < 0 || wholesalePrice > 100000) {
        return res.status(400).json({ error: "Elke prijsregel vereist een product-ID en geldige groothandelsprijs." });
      }
      const key = productId + "::" + variantKey;
      if (seen.has(key)) return res.status(400).json({ error: "Dubbele productuitvoering in de prijslijst." });
      seen.add(key);
      normalized.push({ productId, variantKey, wholesalePrice: wholesalePrice.toFixed(2) });
    }
    let phones = [];
    try {
      const catalog = await pool.query("SELECT data->'phones' AS phones FROM site_settings WHERE id=1");
      phones = Array.isArray(catalog.rows[0]?.phones) ? catalog.rows[0].phones : [];
    } catch (error) {
      console.error("[PARTNER API] Validate catalog prices failed:", error);
      return res.status(503).json({ error: "Productcatalogus kon niet worden gecontroleerd." });
    }
    for (const item of normalized) {
      const phoneIndex = phones.findIndex((p, index) => p && getPartnerProductId(p, index, phones) === item.productId && p.active !== false && p.available !== false);
      const phone = phoneIndex >= 0 ? phones[phoneIndex] : null;
      if (!phone) return res.status(400).json({ error: "Een product in de prijslijst bestaat niet of is niet actief." });
      const variants = hasVariantPricing(phone) ? phone.variantPrices : [null];
      const validVariant = variants.some(v => {
        const key = v ? [v.storage, v.color, v.condition].map(x => safeText(x, 80)).join("|") : "";
        return key === item.variantKey && (!v || (v.active !== false && v.available !== false));
      });
      if (!validVariant) return res.status(400).json({ error: "Een productuitvoering in de prijslijst bestaat niet of is niet actief." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const partner = await client.query("SELECT id FROM api_partners WHERE id=$1 FOR UPDATE", [partnerId]);
      if (!partner.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Partner niet gevonden." });
      }
      // PUT replaces the complete price list so removed assignments cannot remain active.
      await client.query("DELETE FROM api_partner_prices WHERE partner_id=$1", [partnerId]);
      for (const item of normalized) {
        await client.query(
          `INSERT INTO api_partner_prices(partner_id,product_id,variant_key,wholesale_price)
           VALUES($1,$2,$3,$4)
           ON CONFLICT(partner_id,product_id,variant_key)
           DO UPDATE SET wholesale_price=EXCLUDED.wholesale_price,updated_at=NOW()`,
          [partnerId, item.productId, item.variantKey, item.wholesalePrice]
        );
      }
      await client.query("COMMIT");
      return res.json({ success: true, updated: normalized.length });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      console.error("[PARTNER API] Save wholesale prices failed:", error);
      return res.status(500).json({ error: "Groothandelsprijzen konden niet worden opgeslagen." });
    } finally {
      client.release();
    }
  });

  async function authenticatePartner(req, res, next) {
    const header = String(req.get("authorization") || "");
    const match = header.match(/^Bearer\s+(htp_[a-f0-9]{64})$/i);
    if (!match) return res.status(401).json({ error: "Ongeldige API-sleutel." });
    try {
      const result = await pool.query(
        "SELECT id,name FROM api_partners WHERE token_hash=$1 AND active=TRUE",
        [hashToken(match[1])]
      );
      if (!result.rows.length) return res.status(401).json({ error: "API-sleutel ongeldig of uitgeschakeld." });
      req.partner = result.rows[0];
      return next();
    } catch (error) {
      console.error("[PARTNER API] Authentication failed:", error);
      return res.status(503).json({ error: "Partner-API tijdelijk niet beschikbaar." });
    }
  }

  app.get("/api/partner/v1/products", authenticatePartner, async (req, res) => {
    try {
      const [catalog, prices] = await Promise.all([
        pool.query("SELECT data->'phones' AS phones FROM site_settings WHERE id=1"),
        pool.query(
          "SELECT product_id,variant_key,wholesale_price FROM api_partner_prices WHERE partner_id=$1",
          [req.partner.id]
        )
      ]);
      const phones = Array.isArray(catalog.rows[0]?.phones) ? catalog.rows[0].phones : [];
      const priceMap = new Map(prices.rows.map(row => [row.product_id + "::" + row.variant_key, Number(row.wholesale_price)]));
      const products = [];
      for (const [phoneIndex, phone] of phones.entries()) {
        if (!phone || typeof phone !== "object" || phone.active === false || phone.available === false) continue;
        const productId = getPartnerProductId(phone, phoneIndex, phones);
        if (!productId) continue;
        const variants = hasVariantPricing(phone)
          ? phone.variantPrices.filter(v => v && v.active !== false && v.available !== false)
          : [null];
        for (const variant of variants) {
          const variantKey = variant
            ? [variant.storage, variant.color, variant.condition].map(v => safeText(v, 80)).join("|")
            : "";
          const key = productId + "::" + variantKey;
          if (!priceMap.has(key)) continue;
          const stock = parseStock(variant ? variant.stock : phone.stock);
          if (stock === 0) continue;
          products.push({
            id: productId,
            sku: safeText(variant?.sku || phone.sku, 100),
            name: safeText(phone.name || phone.title, 180),
            brand: safeText(phone.brand || "Apple", 80),
            description: safeText(phone.description, 1000),
            storage: safeText(variant?.storage || phone.storage, 40),
            color: safeText(variant?.color || phone.color, 80),
            condition: safeText(variant?.condition || phone.condition, 80),
            wholesalePrice: priceMap.get(key),
            currency: "EUR",
            stock: stock == null ? null : stock,
            images: (Array.isArray(phone.images) ? phone.images : [phone.image]).filter(v => typeof v === "string" && (/^https:\/\//i.test(v) || (v.startsWith("/") && !v.startsWith("//")))).slice(0, 8)
          });
        }
      }
      res.set("Cache-Control", "no-store");
      return res.json({ products, count: products.length });
    } catch (error) {
      console.error("[PARTNER API] Product feed failed:", error);
      return res.status(500).json({ error: "Productfeed kon niet worden geladen." });
    }
  });

  app.post("/api/partner/v1/orders", authenticatePartner, async (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || !items.length || items.length > 50) {
      return res.status(400).json({ error: "Een bestelling moet 1 tot 50 productregels bevatten." });
    }
    const customer = req.body?.customer && typeof req.body.customer === "object" ? req.body.customer : {};
    const customerName = safeText(customer.name, 160);
    const customerEmail = safeText(customer.email, 180).toLowerCase();
    const customerPhone = safeText(customer.phone, 60);
    const shippingAddress = {
      street: safeText(customer.street, 160),
      houseNumber: safeText(customer.houseNumber, 30),
      postcode: safeText(customer.postcode, 30),
      city: safeText(customer.city, 100),
      country: safeText(customer.country || "Nederland", 80)
    };
    if (!customerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail) || !customerPhone ||
        !shippingAddress.street || !shippingAddress.houseNumber || !shippingAddress.postcode || !shippingAddress.city) {
      return res.status(400).json({ error: "Vul de volledige klant- en verzendgegevens in." });
    }
    try {
      const [catalog, prices] = await Promise.all([
        pool.query("SELECT data->'phones' AS phones FROM site_settings WHERE id=1"),
        pool.query("SELECT product_id,variant_key,wholesale_price FROM api_partner_prices WHERE partner_id=$1", [req.partner.id])
      ]);
      const phones = Array.isArray(catalog.rows[0]?.phones) ? catalog.rows[0].phones : [];
      const priceMap = new Map(prices.rows.map(row => [row.product_id + "::" + row.variant_key, Number(row.wholesale_price)]));
      const orderItems = [];
      const requestedQuantities = new Map();
      for (const requested of items) {
        const productId = safeText(requested?.productId, 120);
        const variantKey = safeText(requested?.variantKey || "", 180);
        const quantity = Number(requested?.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
          return res.status(400).json({ error: "Ongeldige productregel of hoeveelheid." });
        }
        const phoneIndex = phones.findIndex((p, index) => p && getPartnerProductId(p, index, phones) === productId && p.active !== false && p.available !== false);
        const phone = phoneIndex >= 0 ? phones[phoneIndex] : null;
        if (!phone) return res.status(409).json({ error: "Een geselecteerd product is niet meer beschikbaar." });
        const variant = hasVariantPricing(phone)
          ? phone.variantPrices.find(v => v && [v.storage, v.color, v.condition].map(x => safeText(x, 80)).join("|") === variantKey && v.active !== false && v.available !== false)
          : null;
        if (hasVariantPricing(phone) && !variant) {
          return res.status(409).json({ error: "Een geselecteerde telefoonuitvoering is niet meer beschikbaar." });
        }
        const key = productId + "::" + variantKey;
        if (!priceMap.has(key)) return res.status(403).json({ error: "Voor een product ontbreekt de afgesproken groothandelsprijs." });
        const stock = parseStock(variant ? variant.stock : phone.stock);
        const requestedTotal = (requestedQuantities.get(key) || 0) + quantity;
        if (stock != null && stock < requestedTotal) return res.status(409).json({ error: "Onvoldoende voorraad voor " + safeText(phone.name, 120) + "." });
        requestedQuantities.set(key, requestedTotal);
        const unitPrice = priceMap.get(key);
        orderItems.push({
          productId,
          name: safeText(phone.name || phone.title, 180),
          sku: safeText(variant?.sku || phone.sku, 100),
          variantKey,
          storage: safeText(variant?.storage || phone.storage, 40),
          color: safeText(variant?.color || phone.color, 80),
          condition: safeText(variant?.condition || phone.condition, 80),
          quantity,
          wholesaleUnitPrice: unitPrice,
          lineTotal: Number((unitPrice * quantity).toFixed(2))
        });
      }
      const total = Number(orderItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2));
      const result = await pool.query(
        `INSERT INTO api_partner_orders(partner_id,customer_name,customer_email,customer_phone,shipping_address,items,wholesale_total)
         VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
         RETURNING id,status,wholesale_total,created_at`,
        [req.partner.id, customerName, customerEmail, customerPhone, JSON.stringify(shippingAddress), JSON.stringify(orderItems), total]
      );
      return res.status(201).json({ success: true, order: result.rows[0] });
    } catch (error) {
      console.error("[PARTNER API] Create order failed:", error);
      return res.status(500).json({ error: "Partnerbestelling kon niet worden aangemaakt." });
    }
  });
  app.get("/api/admin/partner-orders", admin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT o.id,o.partner_id,p.name AS partner_name,o.customer_name,o.customer_email,
          o.customer_phone,o.shipping_address,o.items,o.wholesale_total,o.status,o.admin_note,o.created_at,o.updated_at
         FROM api_partner_orders o JOIN api_partners p ON p.id=o.partner_id
         ORDER BY o.created_at DESC LIMIT 250`
      );
      res.set("Cache-Control", "no-store");
      return res.json({ orders: result.rows });
    } catch (error) {
      console.error("[PARTNER API] List partner orders failed:", error);
      return res.status(500).json({ error: "Partnerbestellingen konden niet worden geladen." });
    }
  });

  app.patch("/api/admin/partner-orders/:id", admin, async (req, res) => {
    const id = Number(req.params.id);
    const status = safeText(req.body?.status, 40);
    const allowed = new Set(["Nieuw", "In behandeling", "Goedgekeurd", "Afgewezen", "Verzonden", "Afgerond"]);
    if (!Number.isSafeInteger(id) || id < 1 || !allowed.has(status)) {
      return res.status(400).json({ error: "Ongeldig order-ID of ongeldige status." });
    }
    try {
      const note = safeText(req.body?.adminNote, 1000);
      const result = await pool.query(
        "UPDATE api_partner_orders SET status=$1,admin_note=$2,updated_at=NOW() WHERE id=$3 RETURNING id,status,admin_note,updated_at",
        [status, note, id]
      );
      if (!result.rows.length) return res.status(404).json({ error: "Partnerbestelling niet gevonden." });
      return res.json({ success: true, order: result.rows[0] });
    } catch (error) {
      console.error("[PARTNER API] Update partner order failed:", error);
      return res.status(500).json({ error: "Partnerbestelling kon niet worden bijgewerkt." });
    }
  });

}

module.exports = { registerPartnerApiRoutes, hashToken, parseStock, getPartnerProductId, hasVariantPricing };
