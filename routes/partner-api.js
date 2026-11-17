"use strict";

const crypto = require("crypto");
const { serverOptionDelta } = require("../utils/product-options");
const { moneyNumber } = require("../utils/money");

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
  const brand = safeText(phone?.brand || "Apple", 80).toLocaleLowerCase();
  const identity = sku ? "sku:" + sku : "legacy:" + brand + "|" + name;
  const occurrence = phones.slice(0, Math.max(0, index)).filter(item => {
    const otherSku = safeText(item?.sku, 100).toLocaleLowerCase();
    const otherName = safeText(item?.name || item?.title, 180).toLocaleLowerCase();
    const otherBrand = safeText(item?.brand || "Apple", 80).toLocaleLowerCase();
    const other = otherSku ? "sku:" + otherSku : "legacy:" + otherBrand + "|" + otherName;
    return other === identity;
  }).length;
  return "legacy-" + crypto.createHash("sha256").update(identity + "|" + occurrence).digest("hex").slice(0, 24);
}

function hasVariantPricing(phone) {
  return phone?.pricingMode === "variant";
}

function partnerVariantRows(phone) {
  if (hasVariantPricing(phone)) {
    return (Array.isArray(phone.variantPrices) ? phone.variantPrices : []).filter(v => v && typeof v === "object").map(variant => ({
      variant,
      storage: safeText(variant.storage, 40),
      color: safeText(variant.color, 80),
      condition: safeText(variant.condition, 80),
      retailPrice: moneyNumber(variant.price)
    }));
  }
  const activeOptions = key => (Array.isArray(phone[key]) ? phone[key] : []).map(option =>
    typeof option === "string" ? { label: option, priceDelta: 0 } : option
  ).filter(option =>
    option && typeof option === "object" && option.active !== false && option.enabled !== false && option.available !== false
  );
  const conditions = activeOptions("conditionOptions");
  const storages = activeOptions("storageOptions");
  const colors = activeOptions("colorOptions");
  const conditionRows = conditions.length ? conditions : [{ label: safeText(phone.condition, 80), basePrice: phone.price ?? phone.salePrice ?? phone.sellPrice }];
  const storageRows = storages.length ? storages : [{ label: Array.isArray(phone.storage) ? phone.storage[0] : (phone.storage || phone.geheugen || ""), priceDelta: 0 }];
  const colorRows = colors.length ? colors : [{ label: phone.color || phone.kleur || "", priceDelta: 0 }];
  const rows = [];
  for (const condition of conditionRows) for (const storage of storageRows) for (const color of colorRows) {
    const base = moneyNumber(condition.basePrice ?? condition.conditionBasePrice ?? condition.price ?? phone.price ?? phone.salePrice ?? phone.sellPrice);
    const retailPrice = base + serverOptionDelta(storage, "storage") + serverOptionDelta(color, "color");
    rows.push({
      variant: null,
      storage: safeText(storage.label, 40),
      color: safeText(color.label, 80),
      condition: safeText(condition.label, 80),
      retailPrice
    });
  }
  return rows;
}

function calculateWholesalePrice(retailPrice, discountPercent) {
  const retail = moneyNumber(retailPrice);
  const discount = Number(discountPercent);
  if (!Number.isFinite(retail) || retail <= 0 || !Number.isFinite(discount) || discount < 0 || discount > 100) return null;
  return Math.round((retail * (1 - discount / 100) + Number.EPSILON) * 100) / 100;
}

function partnerVariantKey(row) {
  return row.storage || row.color || row.condition
    ? [row.storage, row.color, row.condition].join("|")
    : "";
}

function partnerCatalogQuery({ includeImages = false } = {}) {
  const imageFields = includeImages ? ", 'images', phone->'images', 'image', phone->'image'" : "";
  const sql = `
    SELECT COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', phone->'id',
        'name', phone->'name',
        'title', phone->'title',
        'brand', phone->'brand',
        'sku', phone->'sku',
        'description', phone->'description',
        'storage', phone->'storage',
        'color', phone->'color',
        'condition', phone->'condition',
        'stockStatus', phone->'stockStatus',
        'stock', phone->'stock',
        'price', phone->'price',
        'salePrice', phone->'salePrice',
        'sellPrice', phone->'sellPrice',
        'conditionOptions', COALESCE(phone->'conditionOptions', '[]'::jsonb),
        'storageOptions', COALESCE(phone->'storageOptions', '[]'::jsonb),
        'colorOptions', COALESCE(phone->'colorOptions', '[]'::jsonb),
        'active', phone->'active',
        'available', phone->'available',
        'pricingMode', phone->'pricingMode',
        'variantPrices', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'storage', variant->'storage',
            'color', variant->'color',
            'condition', variant->'condition',
            'sku', variant->'sku',
            'stock', variant->'stock',
            'active', variant->'active',
            'available', variant->'available',
            'price', variant->'price'
          ) ORDER BY variant_ordinality)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(phone->'variantPrices') = 'array'
              THEN phone->'variantPrices' ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS variant_rows(variant, variant_ordinality)
        ), '[]'::jsonb)__IMAGE_FIELDS__
      ) ORDER BY phone_ordinality)
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(data->'phones') = 'array'
          THEN data->'phones' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS phone_rows(phone, phone_ordinality)
    ), '[]'::jsonb) AS phones
    FROM site_settings WHERE id=1
  `;
  return sql.replace("__IMAGE_FIELDS__", imageFields);
}

function partnerImages(phone) {
  const candidates = Array.isArray(phone?.images) && phone.images.some(Boolean) ? phone.images : [phone?.image];
  return candidates.filter(value => {
    if (typeof value !== "string" || !value) return false;
    if (/^https:\/\//i.test(value) || (value.startsWith("/") && !value.startsWith("//"))) return true;
    return value.length <= 300000 && /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/]+={0,2}$/i.test(value);
  }).slice(0, 4);
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
        pool.query("SELECT id,default_discount_percent FROM api_partners WHERE id=$1", [partnerId]),
        pool.query(partnerCatalogQuery()),
        pool.query("SELECT product_id,variant_key,wholesale_price FROM api_partner_prices WHERE partner_id=$1", [partnerId])
      ]);
      if (!partner.rows.length) return res.status(404).json({ error: "Partner niet gevonden." });
      const discountPercent = Number(partner.rows[0].default_discount_percent ?? 10);
      const phones = Array.isArray(catalog.rows[0]?.phones) ? catalog.rows[0].phones : [];
      const savedMap = new Map(saved.rows.map(row => [row.product_id + "::" + row.variant_key, Number(row.wholesale_price)]));
      const items = [];
      for (const [phoneIndex, phone] of phones.entries()) {
        if (!phone || typeof phone !== "object") continue;
        const productId = getPartnerProductId(phone, phoneIndex, phones);
        if (!productId) continue;
        for (const row of partnerVariantRows(phone)) {
          const variant = row.variant;
          const variantKey = [row.storage, row.color, row.condition].join("|");
          const key = productId + "::" + variantKey;
          const calculatedPrice = calculateWholesalePrice(row.retailPrice, discountPercent);
          const savedPrice = savedMap.get(key);
          const isSaved = savedMap.has(key);
          items.push({
            productId, variantKey, name: safeText(phone.name || phone.title, 180),
            sku: safeText(variant?.sku || phone.sku, 100),
            storage: row.storage, color: row.color, condition: row.condition,
            stock: parseStock(variant ? variant.stock : phone.stock),
            active: phone.active !== false && phone.available !== false && String(phone.stockStatus || "").toLowerCase() !== "sold" && (!variant || (variant.active !== false && variant.available !== false)),
            retailPrice: Number.isFinite(row.retailPrice) ? Math.round(row.retailPrice * 100) / 100 : null,
            discountPercent,
            wholesalePrice: isSaved ? savedPrice : calculatedPrice,
            assigned: isSaved || (calculatedPrice !== null && phone.active !== false && phone.available !== false)
          });
        }
      }
      res.set("Cache-Control", "no-store");
      return res.json({ items, discountPercent });
    } catch (error) {
      console.error("[PARTNER API] Load wholesale prices failed:", error);
      return res.status(500).json({ error: "Groothandelsprijzen konden niet worden geladen." });
    }
  });

  app.put("/api/admin/partners/:id/prices", admin, async (req, res) => {
    const partnerId = Number(req.params.id);
    const prices = req.body?.prices;
    const discountPercent = Number(req.body?.discountPercent ?? 10);
    if (!Number.isSafeInteger(partnerId) || partnerId < 1 || !Array.isArray(prices) || prices.length > 1000 || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
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
      const catalog = await pool.query(partnerCatalogQuery());
      phones = Array.isArray(catalog.rows[0]?.phones) ? catalog.rows[0].phones : [];
    } catch (error) {
      console.error("[PARTNER API] Validate catalog prices failed:", error);
      return res.status(503).json({ error: "Productcatalogus kon niet worden gecontroleerd." });
    }
    for (const item of normalized) {
      const phoneIndex = phones.findIndex((p, index) => p && getPartnerProductId(p, index, phones) === item.productId);
      const phone = phoneIndex >= 0 ? phones[phoneIndex] : null;
      if (!phone) return res.status(400).json({ error: "Een product in de prijslijst bestaat niet of is niet actief." });
      const validVariant = partnerVariantRows(phone).some(row => [row.storage, row.color, row.condition].join("|") === item.variantKey);
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
      await client.query("UPDATE api_partners SET default_discount_percent=$1,updated_at=NOW() WHERE id=$2", [discountPercent, partnerId]);
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
      return res.json({ success: true, updated: normalized.length, discountPercent });
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
        pool.query(partnerCatalogQuery({ includeImages: true })),
        pool.query(
          "SELECT product_id,variant_key,wholesale_price FROM api_partner_prices WHERE partner_id=$1",
          [req.partner.id]
        )
      ]);
      const phones = Array.isArray(catalog.rows[0]?.phones) ? catalog.rows[0].phones : [];
      const priceMap = new Map(prices.rows.map(row => [row.product_id + "::" + row.variant_key, Number(row.wholesale_price)]));
      const products = [];
      for (const [phoneIndex, phone] of phones.entries()) {
        if (!phone || typeof phone !== "object" || phone.active === false || phone.available === false || String(phone.stockStatus || "").toLowerCase() === "sold") continue;
        const productId = getPartnerProductId(phone, phoneIndex, phones);
        if (!productId) continue;
        for (const row of partnerVariantRows(phone)) {
          const variant = row.variant;
          if (variant && (variant.active === false || variant.available === false)) continue;
          const variantKey = [row.storage, row.color, row.condition].join("|");
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
            storage: row.storage,
            color: row.color,
            condition: row.condition,
            wholesalePrice: priceMap.get(key),
            currency: "EUR",
            stock: stock == null ? null : stock,
            images: partnerImages(phone)
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
        pool.query(partnerCatalogQuery()),
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
        const phoneIndex = phones.findIndex((p, index) => p && getPartnerProductId(p, index, phones) === productId && p.active !== false && p.available !== false && String(p.stockStatus || "").toLowerCase() !== "sold");
        const phone = phoneIndex >= 0 ? phones[phoneIndex] : null;
        if (!phone) return res.status(409).json({ error: "Een geselecteerd product is niet meer beschikbaar." });
        const catalogVariant = partnerVariantRows(phone).find(row => [row.storage, row.color, row.condition].join("|") === variantKey);
        const variant = catalogVariant?.variant || null;
        if (!catalogVariant || (variant && (variant.active === false || variant.available === false))) {
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
          storage: catalogVariant.storage,
          color: catalogVariant.color,
          condition: catalogVariant.condition,
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

module.exports = { registerPartnerApiRoutes, hashToken, parseStock, getPartnerProductId, hasVariantPricing, partnerImages, partnerVariantRows, calculateWholesalePrice, partnerVariantKey, partnerCatalogQuery };
