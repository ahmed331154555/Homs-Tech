"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const shopSource = fs.readFileSync(path.join(root, "shop.html"), "utf8");

test("Shop catalog API selects only shopProducts from site settings", () => {
  const start = serverSource.search(/if\s*\(\s*view\s*===\s*"shop"\s*\)\s*\{/);
  const end = serverSource.search(/if\s*\(\s*view\s*===\s*"cart"\s*\)\s*\{/);
  assert.notEqual(start, -1, "dedicated Shop API view must exist");
  assert.notEqual(end, -1, "Shop API view must end before the cart view");
  const route = serverSource.slice(start, end);
  assert.match(
    route,
    /SELECT data->'shopProducts' AS shop_products FROM site_settings WHERE id=1/,
  );
  assert.match(route, /sanitizePublicSiteData\(\{\s*shopProducts:/);
  assert.doesNotMatch(route, /SELECT\s+data\s+FROM\s+site_settings/i);
  assert.doesNotMatch(route, /SELECT\s+\*\s+FROM\s+site_settings/i);
});

test("Public Shop page requests the dedicated Shop catalog view", () => {
  assert.match(shopSource, /fetch\('\/api\/shop\/product\/'\s*\+/);
  assert.doesNotMatch(shopSource, /fetch\(['"]\/api\/site['"]/);
});

test("Shop product details are fetched separately by stable product ID", () => {
  const start = serverSource.indexOf('app.get("/api/shop/product/:id"');
  const end = serverSource.indexOf('app.get("/api/site"', start);
  assert.ok(start >= 0, "single-product Shop endpoint must exist");
  assert.ok(
    end > start,
    "single-product endpoint must be registered before site settings",
  );
  const route = serverSource.slice(start, end);
  assert.match(route, /jsonb_array_elements/);
  assert.match(route, /item\.product->>'id'\s*=\s*\$1/);
  assert.doesNotMatch(route, /shopPageEnabled/);
  assert.match(route, /sanitizePublicSiteData\(product\)/);
  assert.ok(shopSource.includes(String.raw`\/api\/shop\/image\/`));
  assert.match(shopSource, /Promise\.all\(\[catalogRequest,detailRequest\]\)/);
});

test("Shop listing payload contains only a preview image and compact variants", () => {
  assert.match(
    serverSource,
    /buildShopCatalogList\(result\.rows\[0\]\.shop_products\)/,
  );
});

test("Shop preview images are served lazily with validation and short caching", () => {
  const start = serverSource.indexOf('app.get("/api/shop/image/:id"');
  const end = serverSource.indexOf('app.get("/api/shop/product/:id"', start);
  assert.ok(
    start >= 0 && end > start,
    "Shop image endpoint must exist before product details",
  );
  const route = serverSource.slice(start, end);
  assert.match(route, /jsonb_array_elements/);
  assert.match(route, /item\.product->>'id'\s*=\s*\$1/);
  assert.match(route, /Buffer\.from\(match\[2\],\s*"base64"\)/);
  assert.match(route, /5\s*\*\s*1024\s*\*\s*1024/);
  assert.match(route, /X-Content-Type-Options/);
  assert.match(route, /max-age=60/);
  assert.ok(shopSource.includes("\\/api\\/shop\\/image\\/"));
});
