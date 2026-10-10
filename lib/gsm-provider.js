/**
 * HOMS TECH GSM provider boundary.
 *
 * This module deliberately does not guess Easy-Unlocker's API URL or payload.
 * When official API documentation is available, implement the provider methods
 * below without coupling provider-specific fields to the storefront/admin UI.
 */

const GSM_CATEGORIES = Object.freeze([
  "imei",
  "remote",
  "server",
  "frp",
  "firmware"
]);

function normalizeCategory(value) {
  const category = String(value || "").trim().toLowerCase();
  return GSM_CATEGORIES.includes(category) ? category : null;
}

function normalizeService(input, category) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("GSM service must be an object.");
  }

  const safeCategory = normalizeCategory(category);
  if (!safeCategory) throw new TypeError("Unsupported GSM service category.");

  const name = String(input.name || "").trim();
  if (!name) throw new TypeError("GSM service name is required.");

  const priceText = input.price == null ? "" : String(input.price).trim();
  if (priceText && (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || !Number.isFinite(Number(priceText)))) {
    throw new TypeError("GSM service price must be a non-negative decimal amount.");
  }

  return {
    ...input,
    name,
    category: safeCategory,
    group: String(input.group || safeCategory).trim().slice(0, 120),
    price: priceText,
    priceCurrency: "EUR",
    active: input.active !== false,
    requiredFields: Array.isArray(input.requiredFields)
      ? [...new Set(input.requiredFields.map(v => String(v).trim()).filter(Boolean))]
      : [],
    formFields: Array.isArray(input.formFields) ? input.formFields : []
  };
}

/**
 * The local provider uses the existing site_settings.gsmServices catalog.
 * It never makes up upstream services or prices. A future Easy-Unlocker
 * adapter should implement the same methods using verified official docs.
 */
function createLocalGsmProvider({ loadCatalog, saveCatalog }) {
  if (typeof loadCatalog !== "function" || typeof saveCatalog !== "function") {
    throw new TypeError("Local GSM provider requires loadCatalog and saveCatalog.");
  }

  return {
    name: "local",
    async listServices() {
      const catalog = await loadCatalog();
      const result = {};
      for (const category of GSM_CATEGORIES) {
        const items = Array.isArray(catalog?.[category]) ? catalog[category] : [];
        result[category] = items.map(item => ({ ...item }));
      }
      return result;
    },
    async saveService(category, service) {
      const safeCategory = normalizeCategory(category);
      if (!safeCategory) throw new TypeError("Unsupported GSM service category.");
      const normalized = normalizeService(service, safeCategory);
      const catalog = await loadCatalog();
      const next = catalog && typeof catalog === "object" ? { ...catalog } : {};
      const list = Array.isArray(next[safeCategory]) ? [...next[safeCategory]] : [];
      const id = String(normalized.sourceId || normalized.id || "").trim();
      const index = id ? list.findIndex(item => String(item?.sourceId || item?.id || "") === id) : -1;
      if (index >= 0) list[index] = { ...list[index], ...normalized };
      else list.push(normalized);
      next[safeCategory] = list;
      await saveCatalog(next);
      return normalized;
    }
  };
}

function getEasyUnlockerApiReadiness(env = process.env) {
  const configured = Boolean(
    String(env.EASY_UNLOCKER_API_BASE_URL || "").trim() &&
    String(env.EASY_UNLOCKER_API_KEY || "").trim()
  );
  return {
    configured,
    provider: configured ? "easy-unlocker" : "local",
    note: configured
      ? "Credentials are present; official endpoint documentation and a verified adapter are still required before API calls are enabled."
      : "Using the existing local GSM catalog. No upstream API calls are made."
  };
}

module.exports = {
  GSM_CATEGORIES,
  normalizeCategory,
  normalizeService,
  createLocalGsmProvider,
  getEasyUnlockerApiReadiness
};
