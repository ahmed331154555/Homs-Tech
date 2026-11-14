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
  assert.deepEqual(ADMIN_SITE_SECTIONS.why.fields, ["why"]);
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
