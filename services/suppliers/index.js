"use strict";

const { normalizeSupplierProduct, extractProductArray } = require("./normalize");

const CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 12 * 1000;
const cache = new Map();

const SUPPLIERS = {
  forza: { urlEnv: "FORZA_API_URL", keyEnv: "FORZA_API_KEY" },
  mobico: { urlEnv: "MOBICO_API_URL", keyEnv: "MOBICO_API_KEY" },
};

function getSupplierConfig(name, env = process.env) {
  const definition = SUPPLIERS[name];
  if (!definition) return null;
  const url = String(env[definition.urlEnv] || "").trim();
  const key = String(env[definition.keyEnv] || "").trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }
  return { url, key };
}

async function fetchSupplier(name, options = {}) {
  const config = getSupplierConfig(name, options.env || process.env);
  if (!config) {
    return { supplier: name, configured: false, products: [], error: "not_configured" };
  }

  const now = Date.now();
  const cached = cache.get(name);
  if (!options.force && cached && cached.expiresAt > now) {
    return { supplier: name, configured: true, products: cached.products, cached: true };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { supplier: name, configured: true, products: [], error: "fetch_unavailable" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(config.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.key}`,
        "X-API-Key": config.key,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { supplier: name, configured: true, products: [], error: `http_${response.status}` };
    }
    const payload = await response.json();
    const products = extractProductArray(payload)
      .map((item) => normalizeSupplierProduct(item, name))
      .filter(Boolean);
    cache.set(name, { products, expiresAt: now + CACHE_TTL_MS });
    return { supplier: name, configured: true, products, cached: false };
  } catch (error) {
    return {
      supplier: name,
      configured: true,
      products: [],
      error: error && error.name === "AbortError" ? "timeout" : "supplier_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getSupplierProducts(options = {}) {
  const names = options.supplier ? [options.supplier] : Object.keys(SUPPLIERS);
  const results = await Promise.all(names.map((name) => fetchSupplier(name, options)));
  const products = results.flatMap((result) => result.products);
  return { products, suppliers: results };
}

function clearSupplierCache() {
  cache.clear();
}

module.exports = {
  SUPPLIERS,
  getSupplierConfig,
  fetchSupplier,
  getSupplierProducts,
  clearSupplierCache,
};
