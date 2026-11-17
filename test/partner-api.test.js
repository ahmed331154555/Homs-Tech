"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerPartnerApiRoutes, hashToken, parseStock, getPartnerProductId, hasVariantPricing, partnerImages, partnerVariantRows, calculateWholesalePrice, partnerVariantKey } = require("../routes/partner-api");

test("partner API keys are stored as deterministic SHA-256 hashes, not plaintext", () => {
  const token = "htp_" + "a".repeat(64);
  const hash = hashToken(token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, token);
  assert.equal(hashToken(token), hash);
});

test("partner stock parser handles numeric and Dutch stock labels safely", () => {
  assert.equal(parseStock(4), 4);
  assert.equal(parseStock("3 stuks"), 3);
  assert.equal(parseStock("0 op voorraad"), 0);
  assert.equal(parseStock("onbekend"), null);
  assert.equal(parseStock(null), null);
});

function makeRouteHarness({ phones = [], prices = [], partner = { id: 7, name: "Test Partner" } } = {}) {
  const routes = new Map();
  const queries = [];
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers); },
    post(path, ...handlers) { routes.set("POST " + path, handlers); },
    patch(path, ...handlers) { routes.set("PATCH " + path, handlers); },
    delete(path, ...handlers) { routes.set("DELETE " + path, handlers); },
    put(path, ...handlers) { routes.set("PUT " + path, handlers); }
  };
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM api_partners WHERE token_hash")) {
        return { rows: params[0] === hashToken("htp_" + "a".repeat(64)) && partner.active !== false ? [partner] : [] };
      }
      if (sql.includes("FROM api_partners WHERE id=$1")) return { rows: [partner] };
      if (sql.includes("UPDATE api_partners SET") && sql.includes("RETURNING id,name,email")) return { rows: [{ ...partner, name: params[0], email: params[1] }] };
      if (sql.includes("data->'phones'")) return { rows: [{ phones }] };
      if (sql.includes("FROM api_partner_prices")) return { rows: prices };
      if (sql.includes("UPDATE api_partner_orders")) return { rows: [{ id: params[2], status: params[0], admin_note: params[1], updated_at: "2026-11-17T10:00:00.000Z" }] };
      if (sql.includes("INSERT INTO api_partner_orders")) {
        return { rows: [{ id: 99, status: "Nieuw", wholesale_total: params[6], created_at: "2026-11-17T10:00:00.000Z" }] };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql, params = []) {
          queries.push({ sql, params });
          if (sql.includes("SELECT id FROM api_partners")) return { rows: [partner] };
          if (sql.includes("UPDATE api_partners SET active=FALSE")) return { rows: [{ id: partner.id }] };
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  registerPartnerApiRoutes(app, {
    pool,
    requirePermission: permission => {
      assert.equal(permission, "site.save");
      return (_req, _res, next) => next();
    }
  });
  return {
    routes, queries,
    async invoke(method, path, req = {}, res = response()) {
      req.params ||= {};
      req.body ||= {};
      req.get ||= name => name.toLowerCase() === "authorization" ? req.authorization || "" : "";
      res.set = function() { return this; };
      const handlers = routes.get(method + " " + path);
      assert.ok(handlers, "route exists: " + method + " " + path);
      async function run(index) {
        if (index >= handlers.length) return;
        let continued = false;
        await handlers[index](req, res, () => { continued = true; return run(index + 1); });
        if (!continued && index < handlers.length - 1) return;
      }
      await run(0);
      return res;
    }
  };
}

function response() {
  return {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(value) { this.body = value; return this; }
  };
}

const samplePhones = [
  {
    id: "iphone-13", name: "iPhone 13", pricingMode: "variant", active: true, available: true,
    variantPrices: [
      { storage: "128GB", color: "Black", condition: "A", stock: 3, price: 399, active: true, available: true },
      { storage: "256GB", color: "Blue", condition: "A", stock: 0, price: 449, active: true, available: true }
    ]
  },
  { id: "inactive", name: "Inactive phone", active: false, stock: 4 }
];

test("partner product feed requires an active matching API key and only returns assigned in-stock variants", async () => {
  const key = "htp_" + "a".repeat(64);
  const h = makeRouteHarness({
    phones: samplePhones,
    prices: [{ product_id: "iphone-13", variant_key: "128GB|Black|A", wholesale_price: "25.00" }]
  });
  const denied = await h.invoke("GET", "/api/partner/v1/products", { authorization: "Bearer htp_" + "b".repeat(64) });
  assert.equal(denied.statusCode, 401);

  const disabled = makeRouteHarness({ partner: { id: 7, name: "Disabled Partner", active: false } });
  const disabledResponse = await disabled.invoke("GET", "/api/partner/v1/products", { authorization: "Bearer " + key });
  assert.equal(disabledResponse.statusCode, 401);

  const allowed = await h.invoke("GET", "/api/partner/v1/products", { authorization: "Bearer " + key });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.count, 1);
  assert.equal(allowed.body.products[0].wholesalePrice, 25);
  assert.equal(allowed.body.products[0].storage, "128GB");
  const feedCatalogQuery = h.queries.find(q => q.sql.includes("data->'phones'"));
  assert.match(feedCatalogQuery.sql, /jsonb_agg/);
  assert.match(feedCatalogQuery.sql, /'images'/);
});

test("partner order uses database wholesale price and does not trust a submitted price", async () => {
  const key = "htp_" + "a".repeat(64);
  const h = makeRouteHarness({
    phones: samplePhones,
    prices: [{ product_id: "iphone-13", variant_key: "128GB|Black|A", wholesale_price: "25.00" }]
  });
  const res = await h.invoke("POST", "/api/partner/v1/orders", {
    authorization: "Bearer " + key,
    body: {
      customer: { name: "Customer", email: "customer@example.com", phone: "+31612345678", street: "Main Street", houseNumber: "1", postcode: "3011AA", city: "Rotterdam" },
      items: [{ productId: "iphone-13", variantKey: "128GB|Black|A", quantity: 1, wholesaleUnitPrice: 0.01, price: 0.01 }]
    }
  });
  assert.equal(res.statusCode, 201);
  const insert = h.queries.find(q => q.sql.includes("INSERT INTO api_partner_orders"));
  const storedItems = JSON.parse(insert.params[5]);
  assert.equal(storedItems[0].wholesaleUnitPrice, 25);
  assert.equal(res.body.order.status, "Nieuw");
});

test("partner order rejects repeated lines whose combined quantity exceeds stock", async () => {
  const key = "htp_" + "a".repeat(64);
  const h = makeRouteHarness({
    phones: samplePhones,
    prices: [{ product_id: "iphone-13", variant_key: "128GB|Black|A", wholesale_price: "25.00" }]
  });
  const res = await h.invoke("POST", "/api/partner/v1/orders", {
    authorization: "Bearer " + key,
    body: {
      customer: { name: "Customer", email: "customer@example.com", phone: "+31612345678", street: "Main Street", houseNumber: "1", postcode: "3011AA", city: "Rotterdam" },
      items: [
        { productId: "iphone-13", variantKey: "128GB|Black|A", quantity: 2 },
        { productId: "iphone-13", variantKey: "128GB|Black|A", quantity: 2 }
      ]
    }
  });
  assert.equal(res.statusCode, 409);
  assert.equal(h.queries.some(q => q.sql.includes("INSERT INTO api_partner_orders")), false);
});

test("admin price catalog joins active phone variants with the partner's saved wholesale prices", async () => {
  const h = makeRouteHarness({
    phones: samplePhones,
    prices: [{ product_id: "iphone-13", variant_key: "128GB|Black|A", wholesale_price: "25.00" }]
  });
  const res = await h.invoke("GET", "/api/admin/partners/:id/prices", { params: { id: "7" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 3); // Include active variants, zero-stock variants and inactive catalog rows for price preservation.
  assert.equal(res.body.items[0].wholesalePrice, 25);
  assert.equal(res.body.items[0].retailPrice, 399);
  assert.equal(res.body.discountPercent, 10);
  assert.equal(res.body.items[0].variantKey, "128GB|Black|A");
  assert.equal(res.body.items[2].active, false);
  const catalogQuery = h.queries.find(q => q.sql.includes("data->'phones'"));
  assert.match(catalogQuery.sql, /jsonb_agg/);
  assert.doesNotMatch(catalogQuery.sql, /'images'/);
});

test("admin price replacement validates product variants and saves only the submitted wholesale list", async () => {
  const h = makeRouteHarness({ phones: samplePhones });
  const res = await h.invoke("PUT", "/api/admin/partners/:id/prices", {
    params: { id: "7" },
    body: { discountPercent: 15, prices: [{ productId: "iphone-13", variantKey: "128GB|Black|A", wholesalePrice: 339.15 }] }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(h.queries.some(q => q.sql.includes("DELETE FROM api_partner_prices")));
  assert.ok(h.queries.some(q => q.sql.includes("UPDATE api_partners SET default_discount_percent") && q.params[0] === 15));
  const insert = h.queries.find(q => q.sql.includes("INSERT INTO api_partner_prices"));
  assert.deepEqual(insert.params, [7, "iphone-13", "128GB|Black|A", "339.15"]);
});

test("admin price replacement rejects unknown variants before changing saved prices", async () => {
  const h = makeRouteHarness({ phones: samplePhones });
  const res = await h.invoke("PUT", "/api/admin/partners/:id/prices", {
    params: { id: "7" },
    body: { prices: [{ productId: "iphone-13", variantKey: "1TB|Pink|A", wholesalePrice: 42.5 }] }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(h.queries.some(q => q.sql.includes("DELETE FROM api_partner_prices")), false);
});

test("admin can edit partner name and email without changing API token", async () => {
  const h = makeRouteHarness();
  const res = await h.invoke("PATCH", "/api/admin/partners/:id", {
    params: { id: "7" }, body: { name: "Updated Partner", email: "updated@example.com" }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(h.queries.some(q => q.sql.includes("UPDATE api_partners SET name=$1,email=$2")));
});

test("admin partner deletion revokes access and preserves historical orders", async () => {
  const h = makeRouteHarness();
  const res = await h.invoke("DELETE", "/api/admin/partners/:id", { params: { id: "7" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.ok(h.queries.some(q => q.sql.includes("UPDATE api_partners SET active=FALSE,deleted_at=NOW()")));
  assert.ok(h.queries.some(q => q.sql.includes("DELETE FROM api_partner_prices")));
  assert.equal(h.queries.some(q => q.sql.includes("DELETE FROM api_partner_orders")), false);
});

test("admin partner order status updates accept only the defined statuses", async () => {
  const h = makeRouteHarness();
  const valid = await h.invoke("PATCH", "/api/admin/partner-orders/:id", {
    params: { id: "99" }, body: { status: "Goedgekeurd", adminNote: "Voorraad gecontroleerd" }
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.order.status, "Goedgekeurd");
  const invalid = await h.invoke("PATCH", "/api/admin/partner-orders/:id", {
    params: { id: "99" }, body: { status: "Paid" }
  });
  assert.equal(invalid.statusCode, 400);
});

test("legacy phone partner IDs remain stable when unrelated catalog entries are inserted", () => {
  const phone = { name: "iPhone SE", brand: "Apple", sku: "HT-SE-001" };
  const before = getPartnerProductId(phone, 0, [phone]);
  const afterCatalog = [{ name: "Different phone", brand: "Apple" }, phone];
  const after = getPartnerProductId(phone, 1, afterCatalog);
  assert.match(before, /^legacy-[a-f0-9]{24}$/);
  assert.equal(after, before);
});

test("legacy pricing mode does not expose leftover variant rows as separate partner variants", () => {
  const phone = { pricingMode: "legacy", variantPrices: [{ storage: "128GB", color: "Black", condition: "A" }] };
  assert.equal(hasVariantPricing(phone), false);
});

test("legacy product identifier is not generated for an empty draft phone", () => {
  assert.equal(getPartnerProductId({ name: "", brand: "Apple", sku: "" }, 0, [{ name: "", brand: "Apple", sku: "" }]), "");
});

test("variant pricing mode with no configured rows does not fall back to a legacy product", () => {
  assert.equal(hasVariantPricing({ pricingMode: "variant", variantPrices: [] }), true);
});

test("partner image sanitizer includes small safe inline WebP and excludes oversized or unsafe data URLs", () => {
  const oversized = "data:image/webp;base64," + "A".repeat(300001);
  const images = partnerImages({
    images: [
      "data:image/webp;base64,QUJD",
      "javascript:alert(1)",
      oversized,
      "/assets/phone.webp",
      "https://cdn.example.com/phone.webp"
    ]
  });
  assert.deepEqual(images, [
    "data:image/webp;base64,QUJD",
    "/assets/phone.webp",
    "https://cdn.example.com/phone.webp"
  ]);
});

test("partner feed and order support legacy phones without explicit catalog IDs", async () => {
  const key = "htp_" + "a".repeat(64);
  const phone = {
    name: "iPhone SE", brand: "Apple", sku: "HT-SE-001", description: "Compact phone",
    storage: "128GB", color: "Black", condition: "A",
    pricingMode: "legacy", stock: 2,
    images: ["data:image/webp;base64,QUJD"]
  };
  const productId = getPartnerProductId(phone, 0, [phone]);
  const h = makeRouteHarness({
    phones: [phone],
    prices: [{ product_id: productId, variant_key: "128GB|Black|A", wholesale_price: "100.00" }]
  });
  const feed = await h.invoke("GET", "/api/partner/v1/products", { authorization: "Bearer " + key });
  assert.equal(feed.statusCode, 200);
  assert.equal(feed.body.products[0].id, productId);
  assert.equal(feed.body.products[0].images[0], "data:image/webp;base64,QUJD");
  assert.equal(feed.body.products[0].description, "Compact phone");
  assert.equal(feed.body.products[0].storage, "128GB");

  const order = await h.invoke("POST", "/api/partner/v1/orders", {
    authorization: "Bearer " + key,
    body: {
      customer: { name: "Customer", email: "customer@example.com", phone: "+31612345678", street: "Main Street", houseNumber: "1", postcode: "3011AA", city: "Rotterdam" },
      items: [{ productId, variantKey: "128GB|Black|A", quantity: 1 }]
    }
  });
  assert.equal(order.statusCode, 201);
});

test("legacy product ID prefers SKU so product renames do not break partner mapping", () => {
  const original = { name: "iPhone 13", brand: "Apple", sku: "HT-IPH13-128" };
  const renamed = { name: "Apple iPhone 13 128GB", brand: "Apple", sku: "HT-IPH13-128" };
  assert.equal(
    getPartnerProductId(original, 0, [original]),
    getPartnerProductId(renamed, 0, [renamed])
  );
});

test("partner feed and order reject products marked sold", async () => {
  const key = "htp_" + "a".repeat(64);
  const phone = { id: "sold-phone", name: "Sold phone", brand: "Apple", stockStatus: "sold", stock: 0 };
  const h = makeRouteHarness({
    phones: [phone],
    prices: [{ product_id: "sold-phone", variant_key: "", wholesale_price: "10.00" }]
  });
  const feed = await h.invoke("GET", "/api/partner/v1/products", { authorization: "Bearer " + key });
  assert.equal(feed.body.count, 0);
  const order = await h.invoke("POST", "/api/partner/v1/orders", {
    authorization: "Bearer " + key,
    body: {
      customer: { name: "Customer", email: "customer@example.com", phone: "+31612345678", street: "Main Street", houseNumber: "1", postcode: "3011AA", city: "Rotterdam" },
      items: [{ productId: "sold-phone", variantKey: "", quantity: 1 }]
    }
  });
  assert.equal(order.statusCode, 409);
});

test("partner wholesale price is calculated from current retail price and configurable discount", () => {
  assert.equal(calculateWholesalePrice(100, 10), 90);
  assert.equal(calculateWholesalePrice(399, 10), 359.1);
  assert.equal(calculateWholesalePrice(100, 0), 100);
  assert.equal(calculateWholesalePrice(100, 100), 0);
  assert.equal(calculateWholesalePrice(null, 10), null);
});

test("standard catalog pricing uses condition base price plus storage and color adjustments", () => {
  const rows = partnerVariantRows({
    pricingMode: "options",
    price: 300,
    conditionOptions: [{ label: "A", basePrice: 320, active: true }],
    storageOptions: [{ label: "256GB", priceDelta: 25, active: true }],
    colorOptions: [{ label: "Blue", priceDelta: 5, active: true }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].retailPrice, 350);
  assert.equal(partnerVariantKey(rows[0]), "256GB|Blue|A");
});

test("simple legacy catalog phones retain an empty variant key and their original sale price", () => {
  const rows = partnerVariantRows({ name: "Basic phone", price: 180 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].retailPrice, 180);
  assert.equal(partnerVariantKey(rows[0]), "");
});

test("standard option labels stored as strings are supported in retail-price calculation", () => {
  const rows = partnerVariantRows({
    price: "€250,00",
    conditionOptions: ["A"],
    storageOptions: ["128 GB"],
    colorOptions: ["Black"]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].retailPrice, 250);
  assert.equal(partnerVariantKey(rows[0]), "128 GB|Black|A");
});
