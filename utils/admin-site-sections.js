"use strict";

const ADMIN_SITE_SECTIONS = Object.freeze({
  general: Object.freeze({ permission: "general.view", fields: Object.freeze(["homepage"]), writeFields: Object.freeze(["homepage"]) }),
  services: Object.freeze({ permission: "services.view", fields: Object.freeze(["services"]), writeFields: Object.freeze(["services"]) }),
  repair: Object.freeze({ permission: "site.save", fields: Object.freeze(["repairPage", "repairCoverage"]), writeFields: Object.freeze(["repairPage", "repairCoverage"]) }),
  phones: Object.freeze({ permission: "phones.view", fields: Object.freeze(["phones", "phoneFolders", "globalConditionDetails", "globalConditionOverviewImage"]) }),
  shop: Object.freeze({ permission: "site.save", fields: Object.freeze(["shopProducts"]) }),
  buyback: Object.freeze({ permission: "buyback.view", fields: Object.freeze(["buybackCatalog", "buybackPhones"]) }),
  categories: Object.freeze({ permission: "categories.view", fields: Object.freeze(["deviceCategories", "globalConditionDetails", "globalConditionOverviewImage"]), writeFields: Object.freeze(["deviceCategories", "globalConditionDetails", "globalConditionOverviewImage"]) }),
  why: Object.freeze({ permission: "why.view", fields: Object.freeze(["why", "features"]), writeFields: Object.freeze(["why"]) })
});

function getAdminSiteSection(section) {
  const key = String(section || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ADMIN_SITE_SECTIONS, key)
    ? ADMIN_SITE_SECTIONS[key]
    : null;
}

function buildAdminSiteSectionSelect(section) {
  const config = getAdminSiteSection(section);
  if (!config) return null;
  const columns = config.fields.map(field => `data->'${field}' AS "${field}"`);
  return `SELECT ${columns.join(", ")} FROM site_settings WHERE id = 1`;
}

module.exports = {
  ADMIN_SITE_SECTIONS,
  getAdminSiteSection,
  buildAdminSiteSectionSelect
};
