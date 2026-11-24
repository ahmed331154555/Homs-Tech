"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adminJs = fs.readFileSync(
  path.resolve(__dirname, "../assets/homs-admin.js"),
  "utf8",
);

test("inventory refreshes do not overlap", () => {
  assert.match(adminJs, /let inventoryLoading=false;/);
  assert.match(
    adminJs,
    /if\(!box\|\|inventoryLoading\)return;\s*inventoryLoading=true;/,
  );
  assert.match(adminJs, /finally\{inventoryLoading=false;\}/);
});

test("email inbox refreshes do not overlap", () => {
  assert.match(adminJs, /let adminEmailsLoading=false;/);
  assert.match(
    adminJs,
    /if\(!list\|\|adminEmailsLoading\)return;adminEmailsLoading=true;/,
  );
  assert.match(adminJs, /finally\{adminEmailsLoading=false;\}/);
});

test("repair request refreshes do not overlap", () => {
  assert.match(adminJs, /let repairOrdersLoading=false;/);
  assert.match(
    adminJs,
    /if\(!hasPermission\("orders.view"\)\|\|repairOrdersLoading\)return;\s*repairOrdersLoading=true;/,
  );
  assert.match(adminJs, /finally\{repairOrdersLoading=false;\}/);
});

test("webshop order refreshes do not overlap", () => {
  assert.match(adminJs, /let webshopOrdersLoading=false;/);
  assert.match(
    adminJs,
    /if\(!hasPermission\("webshop_orders.view"\)\|\|webshopOrdersLoading\)return;\s*webshopOrdersLoading=true;/,
  );
  assert.match(adminJs, /finally\{webshopOrdersLoading=false;\}/);
});

test("admin email detail ignores stale responses after a newer selection", () => {
  assert.match(adminJs, /let adminEmailOpenRequestId=0;/);
  assert.match(adminJs, /const requestId=\+\+adminEmailOpenRequestId;/);
  assert.match(
    adminJs,
    /requestId!==adminEmailOpenRequestId\|\|adminEmailSelectedId!==Number\(id\)/,
  );
  assert.match(
    adminJs,
    /if\(requestId===adminEmailOpenRequestId&&adminEmailSelectedId===Number\(id\)\)box\.textContent=e\.message/,
  );
});

const adminHtml = fs.readFileSync(
  path.resolve(__dirname, "../admin/index.html"),
  "utf8",
);

test("admin bundles are deferred and retain dependency order", () => {
  const mainScript = adminHtml.match(
    /<script\b(?=[^>]*src=["']\.\.\/assets\/homs-admin\.js\?v=20261124-shopcats["'])(?=[^>]*\bdefer(?:\s|>|=))[^>]*>/i,
  );
  const partnerScript = adminHtml.match(
    /<script\b(?=[^>]*src=["']\.\.\/assets\/partner-admin\.js\?v=20261117-partners6["'])(?=[^>]*\bdefer(?:\s|>|=))[^>]*>/i,
  );

  assert.ok(mainScript, "main admin bundle should use defer");
  assert.ok(partnerScript, "partner bundle should use defer");
  assert.ok(
    adminHtml.indexOf(partnerScript[0]) > adminHtml.indexOf(mainScript[0]),
    "partner bundle should defer after the main admin bundle",
  );
});
