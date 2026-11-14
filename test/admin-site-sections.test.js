"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ADMIN_SITE_SECTIONS,
  getAdminSiteSection,
  buildAdminSiteSectionSelect
} = require("../utils/admin-site-sections");

test("admin site section map contains only explicit page data dependencies", () => {
  assert.deepEqual(ADMIN_SITE_SECTIONS.general.fields, ["homepage"]);
  assert.deepEqual(ADMIN_SITE_SECTIONS.services.fields, ["services"]);
  assert.deepEqual(ADMIN_SITE_SECTIONS.repair.fields, ["repairPage", "repairCoverage"]);
  assert.deepEqual(ADMIN_SITE_SECTIONS.phones.fields, [
    "phones", "phoneFolders", "globalConditionDetails", "globalConditionOverviewImage"
  ]);
  assert.deepEqual(ADMIN_SITE_SECTIONS.shop.fields, ["shopProducts"]);
  assert.deepEqual(ADMIN_SITE_SECTIONS.buyback.fields, ["buybackCatalog", "buybackPhones"]);
  assert.deepEqual(ADMIN_SITE_SECTIONS.categories.fields, [
    "deviceCategories", "globalConditionDetails", "globalConditionOverviewImage"
  ]);
  assert.deepEqual(ADMIN_SITE_SECTIONS.why.fields, ["why", "features"]);
});

test("admin site section lookup rejects unknown and malformed section names", () => {
  assert.equal(getAdminSiteSection("phones"), ADMIN_SITE_SECTIONS.phones);
  assert.equal(getAdminSiteSection(" PHONES "), ADMIN_SITE_SECTIONS.phones);
  assert.equal(getAdminSiteSection("orders"), null);
  assert.equal(getAdminSiteSection("__proto__"), null);
  assert.equal(getAdminSiteSection(""), null);
});

test("admin section SQL selects only the allowlisted JSONB keys", () => {
  assert.equal(
    buildAdminSiteSectionSelect("repair"),
    "SELECT data->'repairPage' AS \"repairPage\", data->'repairCoverage' AS \"repairCoverage\" FROM site_settings WHERE id = 1"
  );
  assert.equal(
    buildAdminSiteSectionSelect("phones"),
    "SELECT data->'phones' AS \"phones\", data->'phoneFolders' AS \"phoneFolders\", data->'globalConditionDetails' AS \"globalConditionDetails\", data->'globalConditionOverviewImage' AS \"globalConditionOverviewImage\" FROM site_settings WHERE id = 1"
  );
  assert.equal(buildAdminSiteSectionSelect("not-a-page"), null);
});

test("admin site data routes require section permissions and never select the full settings document", () => {
  const server = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");
  const routeStart = server.indexOf('app.get("/api/admin/site-data/:section"');
  const routeEnd = server.indexOf("// Get website settings", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "admin section GET route should exist");
  const route = server.slice(routeStart, routeEnd);
  assert.ok(route.includes("requirePermission(config.permission, { allowSiteSave: true })"));
  assert.ok(route.includes("buildAdminSiteSectionSelect(section)"));
  assert.ok(!route.includes("SELECT data FROM site_settings"));
  assert.ok(!route.includes("SELECT * FROM site_settings"));
});

test("lightweight admin section saves merge only validated top-level JSONB fields", () => {
  const server = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");
  const routeStart = server.indexOf('app.put("/api/admin/site-data/:section"');
  const routeEnd = server.indexOf("// Get website settings", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart, "admin section PUT route should exist");
  const route = server.slice(routeStart, routeEnd);
  assert.ok(route.includes("config.writeFields"));
  assert.ok(route.includes("keys.some(key => !allowedFields.includes(key))"));
  assert.ok(route.includes("data = data || $1::jsonb"));
  assert.ok(!route.includes("SELECT data FROM site_settings"));
});

test("admin login no longer downloads the full site settings JSON document", () => {
  const js = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "assets", "homs-admin.js"), "utf8");
  const start = js.indexOf("async function loadData(){");
  const end = js.indexOf("/* ---------------- GENERAL ---------------- */", start);
  assert.ok(start >= 0 && end > start, "loadData function should exist");
  const loadData = js.slice(start, end);
  assert.ok(!loadData.includes('fetch("/api/site")'));
  assert.ok(loadData.includes("loadAdminSiteSection(currentPage)"));
  assert.ok(js.includes('fetch("/api/admin/site-data/"+encodeURIComponent(page)'));
});

test("admin navigation lazy-loads a section once and keeps its in-memory edits", () => {
  const js = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "assets", "homs-admin.js"), "utf8");
  assert.ok(js.includes("const adminLoadedSections=new Set()"));
  assert.ok(js.includes("if(adminLoadedSections.has(page))return true"));
  assert.ok(js.includes("if(ADMIN_SITE_DATA_PAGES.has(page)&&adminLazyLoadingEnabled)"));
  assert.ok(js.includes("adminDirtySections.add(currentPage)"));
});

test("lightweight admin save payloads contain only the active page data", () => {
  const js = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "assets", "homs-admin.js"), "utf8");
  const start = js.indexOf("async function save(isAuto=false){");
  const end = js.indexOf("/* ---------------- SEARCH + ADMIN USERS ---------------- */", start);
  assert.ok(start >= 0 && end > start, "save function should exist");
  const save = js.slice(start, end);
  assert.ok(save.includes("homepage:JSON.parse(JSON.stringify(data.homepage||{}))"));
  assert.ok(save.includes("services:JSON.parse(JSON.stringify(data.services||[]))"));
  assert.ok(save.includes("repairPage:JSON.parse(JSON.stringify(data.repairPage||{}))"));
  assert.ok(save.includes("deviceCategories:JSON.parse(JSON.stringify(data.deviceCategories||[]))"));
  assert.ok(save.includes("why:JSON.parse(JSON.stringify(data.why||[]))"));
  assert.ok(save.includes('"/api/admin/site-data/"+encodeURIComponent(savePage)'));
});
