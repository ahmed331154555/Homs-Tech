/**
 * HOMS TECH GSM provider boundary.
 *
 * The storefront and admin catalog use the existing site_settings.gsmServices
 * structure. Provider-specific API details stay behind this boundary so an
 * official Easy-Unlocker adapter can be added later without changing the UI.
 */

const GSM_CATEGORIES = Object.freeze(["imei", "remote", "server", "frp", "firmware"]);
const ALLOWED_FIELD_TYPES = new Set(["text", "email", "number", "textarea", "select"]);

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

  const name = String(input.name || "").trim().slice(0, 180);
  if (!name) throw new TypeError("GSM service name is required.");

  const price = input.price == null ? "" : String(input.price).trim();
  if (price && (!/^\d+(?:\.\d{1,2})?$/.test(price) || !Number.isFinite(Number(price)))) {
    throw new TypeError("GSM service price must be a non-negative decimal amount.");
  }

  const formFields = Array.isArray(input.formFields) ? input.formFields
    .filter(field => field && typeof field === "object" && !Array.isArray(field))
    .slice(0, 30)
    .map(field => {
      const key = String(field.key || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
      const type = ALLOWED_FIELD_TYPES.has(String(field.type || "text")) ? String(field.type || "text") : "text";
      return {
        key,
        label: String(field.label || key).trim().slice(0, 100),
        type,
        required: field.required === true,
        autoFromEmail: field.autoFromEmail === true,
        placeholder: String(field.placeholder || "").trim().slice(0, 180),
        options: Array.isArray(field.options) ? field.options.map(v => String(v).slice(0, 100)).slice(0, 50) : []
      };
    }).filter(field => field.key) : [];

  return {
    ...input,
    name,
    category: safeCategory,
    group: String(input.group || safeCategory).trim().slice(0, 120),
    price,
    priceCurrency: "EUR",
    active: input.active !== false,
    requiredFields: Array.isArray(input.requiredFields)
      ? [...new Set(input.requiredFields.map(v => String(v).trim()).filter(Boolean))].slice(0, 30)
      : [],
    formFields
  };
}

function validateDynamicFieldValues(formFields, values) {
  const data = values && typeof values === "object" && !Array.isArray(values) ? values : {};
  for (const field of (Array.isArray(formFields) ? formFields : [])) {
    if (!field || !field.key) continue;
    const value = String(data[field.key] ?? "").trim();
    if (field.required === true && !value) {
      return { valid: false, key: field.key, label: String(field.label || field.key), reason: "required" };
    }
    if (field.type === "select" && value && Array.isArray(field.options) &&
        !field.options.some(option => String(option) === value)) {
      return { valid: false, key: field.key, label: String(field.label || field.key), reason: "invalid_option" };
    }
  }
  return { valid: true };
}

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
  const baseUrl = String(env.EASY_UNLOCKER_API_BASE_URL || "").trim();
  const key = String(env.EASY_UNLOCKER_API_KEY || "").trim();
  const configured = Boolean(baseUrl && key);
  return {
    configured,
    provider: "local",
    apiCredentialsPresent: configured,
    apiCallsEnabled: false,
    note: configured
      ? "Credentials are present, but API calls remain disabled until the official endpoint and authentication contract are verified."
      : "Using the local GSM catalog. No upstream API calls are made."
  };
}

module.exports = {
  GSM_CATEGORIES,
  normalizeCategory,
  normalizeService,
  validateDynamicFieldValues,
  createLocalGsmProvider,
  getEasyUnlockerApiReadiness
};
