"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("admin visual system keeps its brand tokens and consistent focus treatment", () => {
  const css = read("assets/homs-admin.css");
  assert.match(css, /--ht-navy:\s*#071d2d/i);
  assert.match(css, /--ht-blue:\s*#2563eb/i);
  assert.match(css, /--ht-shadow-card:/);
  assert.match(css, /--ht-focus:/);
  assert.match(css, /#dashboard input:focus[\s\S]*?box-shadow:var\(--ht-focus\)/);
});

test("admin layout has desktop and small-screen responsive safeguards", () => {
  const css = read("assets/homs-admin.css");
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /@media\s*\(max-width:\s*420px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /#dashboard \.orders-toolbar/);
  assert.match(css, /#dashboard \.order-card/);
});

test("admin page references the current stylesheet version", () => {
  const html = read("admin/index.html");
  assert.match(html, /homs-admin\.css\?v=20261110-admin-polish5/);
});


test("orders and inkoop workspace keeps mobile actions accessible", () => {
  const css = read("assets/homs-admin.css");
  assert.match(css, /#page-buyback-orders \.ht-inkoop-detail-foot\s*\{[\s\S]*?position:\s*sticky/);
  assert.match(css, /#page-buyback-orders \.ht-inkoop-toolbar/);
  assert.match(css, /#page-phone-orders \.ht-phone-status-chip\.is-shipped/);
  assert.match(css, /@media\s*\(max-width:\s*560px\)[\s\S]*?#page-phone-orders \.ht-phone-sale-head\{display:none\}/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("admin HTML uses matching versioned CSS and JavaScript assets", () => {
  const html = read("admin/index.html");
  assert.match(html, /homs-admin\.css\?v=20261110-admin-polish5/);
  assert.match(html, /homs-admin\.js\?v=20261110-admin-polish5/);
});


test("admin login and dashboard expose keyboard and assistive-technology labels", () => {
  const html = read("admin/index.html");
  const css = read("assets/homs-admin.css");
  assert.match(html, /class="ht-admin-skip-link" href="#dashboard"/);
  assert.match(html, /id="dashboard"[^>]*role="main"[^>]*tabindex="-1"/);
  assert.match(html, /<label for="username">/);
  assert.match(html, /<label for="password">/);
  assert.match(html, /id="loginStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /\.ht-admin-skip-link:focus/);
});

test("admin JavaScript has no duplicate top-level function declarations", () => {
  const js = read("assets/homs-admin.js");
  const names = [...js.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match => match[1]);
  assert.equal(new Set(names).size, names.length, "duplicate top-level function declaration detected");
});

test("admin stylesheet has balanced rule braces", () => {
  const css = read("assets/homs-admin.css");
  let depth = 0;
  for (const char of css) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    assert.ok(depth >= 0, "unexpected closing brace in stylesheet");
  }
  assert.equal(depth, 0, "unclosed CSS rule");
});


test("admin navigation announces the currently selected page", () => {
  const js = read("assets/homs-admin.js");
  assert.match(js, /b\.setAttribute\("aria-current","page"\)/);
  assert.match(js, /b\.removeAttribute\("aria-current"\)/);
});


test("unified orders workspace is built once and reuses existing order sections", () => {
  const js = read("assets/homs-admin.js");
  const start = js.indexOf("function setupUnifiedOrdersAdmin(){");
  const end = js.indexOf("\\nfunction setupOrdersSubmenu()", start);
  assert.ok(start >= 0 && end > start, "unified orders setup function should exist");
  const setup = js.slice(start, end);
  assert.match(setup, /if\(document\.getElementById\("page-all-orders"\)\)return/);
  assert.match(setup, /parent\.id="page-all-orders"/);
  assert.match(setup, /host\.appendChild\(section\)/);
  assert.match(setup, /if\(!hasPermission\(item\.permission\)\)/);
  assert.match(setup, /setupOrdersSubmenu\(\)/);
});

test("order submenu only exposes categories allowed by the current administrator", () => {
  const js = read("assets/homs-admin.js");
  const start = js.indexOf("function setupOrdersSubmenu(){");
  const end = js.indexOf("\\nfunction toggleOrdersMenu()", start);
  assert.ok(start >= 0 && end > start, "order submenu setup function should exist");
  const setup = js.slice(start, end);
  assert.match(setup, /unifiedOrderCategories\.forEach\(item=>\{/);
  assert.match(setup, /if\(!hasPermission\(item\.permission\)\)return/);
  assert.match(setup, /button\.dataset\.orderSubpage=item\.key/);
});


test("every admin navigation destination is backed by a page or a generated workspace", () => {
  const html = read("admin/index.html");
  const js = read("assets/homs-admin.js");
  const destinations = [...html.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);
  const pageIds = new Set([...html.matchAll(/id="page-([^"]+)"/g)].map(match => match[1]));
  const dynamicallyGenerated = new Set(["all-orders"]);
  const missing = [...new Set(destinations)].filter(page =>
    !pageIds.has(page) && !dynamicallyGenerated.has(page)
  );
  assert.deepEqual(missing, []);
  assert.match(js, /parent\.id="page-all-orders"/);
});

test("CI workflow runs syntax, admin asset, local asset and test checks", () => {
  const workflow = read(".github/workflows/homs-tech-tests.yml");
  assert.match(workflow, /work\/homs-tech-code-cleanup-professional/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /timeout-minutes:\s*15/);
  assert.match(workflow, /node --check/);
  assert.match(workflow, /scripts\/check-admin-inline\.js/);
  assert.match(workflow, /scripts\/check-local-assets\.js/);
  assert.match(workflow, /npm test/);
});


test("invoice workspace keeps accessible fields, live totals and responsive structure", () => {
  const html = read("admin/index.html");
  const css = read("assets/homs-admin.css");
  const js = read("assets/homs-admin.js");
  assert.match(html, /id="page-invoices"[^>]*data-permission="site\.save"/);
  assert.match(html, /for="invCustomerName"/);
  assert.match(html, /for="invCustomerEmail"/);
  assert.match(html, /id="invoiceFormStatus"[^>]*aria-live="polite"/);
  assert.match(html, /class="ht-invoice-lines-table"/);
  assert.match(html, /id="invoiceList" aria-live="polite"/);
  assert.match(css, /\.ht-invoice-form-grid/);
  assert.match(css, /\.ht-invoice-table-wrap/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(js, /function invoiceValidateLines\(/);
  assert.match(js, /function invoiceRoundMoney\(/);
  assert.match(js, /async function sendInvoiceTest\(id,button\)/);
  assert.match(js, /if\(opened\)\{opened\.opener=null;\}/);
});

test("invoice draft validation rejects unsupported VAT and invalid quantities", () => {
  const js = read("assets/homs-admin.js");
  assert.match(js, /!\[0,9,21\]\.includes\(line\.vatRate\)/);
  assert.match(js, /!Number\.isInteger\(line\.quantity\)/);
  assert.match(js, /line\.quantity<1\|\|line\.quantity>999/);
  assert.match(js, /line\.unitPrice<0\|\|line\.unitPrice>1000000/);
});

test("invoice calculations round each line and total to two decimal places", () => {
  const js = read("assets/homs-admin.js");
  assert.match(js, /Math\.round\(\(number\+Number\.EPSILON\)\*100\)\/100/);
  assert.match(js, /lineVat=invoiceRoundMoney\(lineSubtotal\*line\.vatRate\/100\)/);
});


test("inventory workspace is permission-gated and wired to the admin navigation", () => {
  const html = read("admin/index.html");
  const js = read("assets/homs-admin.js");
  const css = read("assets/homs-admin.css");
  assert.match(html, /data-page="inventory" data-permission="site\.save"/);
  assert.match(html, /id="page-inventory" data-permission="site\.save"/);
  assert.match(html, /id="inventoryItems"/);
  assert.match(html, /id="inventoryMovementForm"/);
  assert.match(html, /id="inventoryMovements"/);
  assert.match(js, /inventory:"site\.save"/);
  assert.match(js, /if\(page==="inventory"\)loadInventory\(\)/);
  assert.match(js, /async function loadInventory\(/);
  assert.match(js, /async function saveInventoryMovement\(/);
  assert.match(css, /\.ht-inventory-summary/);
  assert.match(css, /\.ht-inventory-history-table/);
  assert.match(css, /@media\(max-width:480px\)/);
});

test("inventory UI supports search, low-stock filters and signed corrections", () => {
  const html = read("admin/index.html");
  const js = read("assets/homs-admin.js");
  assert.match(html, /id="inventorySearch"/);
  assert.match(html, /id="inventoryStockFilter"/);
  assert.match(html, /value="correction"/);
  assert.match(js, /stockFilter==="low"/);
  assert.match(js, /type==="correction"/);
  assert.match(js, /movementType:type,quantity,note,reference/);
});


test("inventory movements have a persistent audit table and automatic payment integration", () => {
  const schema = read("utils/database-schema.js");
  const paidInventory = read("utils/paid-order-inventory.js");
  const routes = read("routes/admin-inventory.js");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS inventory_movements/);
  assert.match(schema, /movement_type TEXT NOT NULL CHECK/);
  assert.match(schema, /stock_before INTEGER NOT NULL/);
  assert.match(schema, /stock_after INTEGER NOT NULL/);
  assert.match(paidInventory, /INSERT INTO inventory_movements/);
  assert.match(paidInventory, /'webshop_sale'/);
  assert.match(routes, /SELECT data FROM site_settings WHERE id=1 FOR UPDATE/);
  assert.match(routes, /INSERT INTO inventory_movements/);
  assert.match(routes, /stockAfter < 0/);
});


test("admin save operation remains bound to the page where it started", () => {
  const js = read("assets/homs-admin.js");
  const start = js.indexOf("async function save(isAuto=false){");
  const end = js.indexOf("\n/* ---------------- SEARCH + ADMIN USERS ---------------- */", start);
  assert.ok(start >= 0 && end > start, "save function should exist");
  const save = js.slice(start, end);
  assert.match(save, /const savePage=currentPage/);
  assert.match(save, /"X-Homs-Admin-Section":savePage/);
  assert.match(save, /if\(currentPage===savePage\)\{/);
});
