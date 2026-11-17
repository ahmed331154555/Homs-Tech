"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const shopSource = fs.readFileSync(path.join(root, "shop.html"), "utf8");

test("Shop catalog API selects only shopProducts from site settings", () => {
  const start = serverSource.indexOf('if(view==="shop"){');
  const end = serverSource.indexOf('if(view==="cart"){', start);
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
  assert.match(shopSource, /fetch\(['"]\/api\/site\?view=shop['"]/);
  assert.doesNotMatch(shopSource, /fetch\(['"]\/api\/site['"]/);
});


test("Shop product details are fetched separately by stable product ID", () => {
  const start = serverSource.indexOf('app.get("/api/shop/product/:id"');
  const end = serverSource.indexOf('app.get("/api/site"', start);
  assert.ok(start >= 0, "single-product Shop endpoint must exist");
  assert.ok(end > start, "single-product endpoint must be registered before site settings");
  const route = serverSource.slice(start, end);
  assert.match(route, /jsonb_array_elements/);
  assert.match(route, /item\.product->>'id'\s*=\s*\$1/);
  assert.match(route, /sanitizePublicSiteData\(product\)/);
  assert.match(shopSource, /fetch\('\/api\/shop\/product\/'\s*\+/);
  assert.match(shopSource, /Promise\.all\(\[catalogRequest,detailRequest\]\)/);
});

test("Shop listing payload contains only a preview image and compact variants", () => {
  assert.match(serverSource, /buildShopCatalogList\(result\.rows\[0\]\.shop_products\)/);
});
