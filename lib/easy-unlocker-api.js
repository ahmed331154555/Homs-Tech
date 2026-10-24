/**
 * Easy-Unlocker API client. Fail-closed until official endpoint/auth details are configured.
 */
function readConfig(env = process.env) {
  const baseUrl = String(env.EASY_UNLOCKER_API_BASE_URL || "").trim();
  const apiKey = String(env.EASY_UNLOCKER_API_KEY || "").trim();
  const servicesPath = String(env.EASY_UNLOCKER_API_SERVICES_PATH || "").trim();
  const keyHeader = String(env.EASY_UNLOCKER_API_KEY_HEADER || "").trim();
  const keyPrefix = String(env.EASY_UNLOCKER_API_KEY_PREFIX || "").trim();
  let base;
  try { base = new URL(baseUrl); } catch {}
  const validBase = Boolean(base && base.protocol === "https:" && !base.username && !base.password && !base.search && !base.hash);
  const validPath = servicesPath.startsWith("/") && !servicesPath.startsWith("//") && !servicesPath.includes("\\") && !/^[a-z][a-z0-9+.-]*:/i.test(servicesPath);
  const validHeader = /^[A-Za-z0-9-]+$/.test(keyHeader);
  const rawTimeout = Number(env.EASY_UNLOCKER_API_TIMEOUT_MS || 10000);
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.max(1000, Math.min(rawTimeout, 30000)) : 10000;
  const missing = [
    !validBase ? "EASY_UNLOCKER_API_BASE_URL must be a valid HTTPS base URL" : "",
    !apiKey ? "EASY_UNLOCKER_API_KEY is missing" : "",
    !validPath ? "EASY_UNLOCKER_API_SERVICES_PATH must be the official absolute path" : "",
    !validHeader ? "EASY_UNLOCKER_API_KEY_HEADER must be the documented HTTP header name" : ""
  ].filter(Boolean);
  return { baseUrl: validBase ? base.toString().replace(/\/$/, "") : "", apiKey, servicesPath: validPath ? servicesPath : "", keyHeader: validHeader ? keyHeader : "", keyPrefix, timeoutMs, configured: missing.length === 0, missing };
}
function createEasyUnlockerClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = readConfig(env);
  async function request(path, { method = "GET", body } = {}) {
    if (!config.configured) { const e = new Error("Easy-Unlocker API is not fully configured."); e.code = "EASY_UNLOCKER_NOT_CONFIGURED"; e.missing = config.missing; throw e; }
    if (typeof fetchImpl !== "function") throw new Error("Fetch is not available.");
    const verb = String(method).toUpperCase();
    if (!["GET", "POST"].includes(verb)) throw new TypeError("Only GET and POST are supported.");
    const p = String(path || "");
    if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(p)) throw new TypeError("API path must be a relative path on the configured Easy-Unlocker host.");
    const base = new URL(config.baseUrl);
    const url = new URL(p, base);
    if (url.origin !== base.origin || url.protocol !== "https:") throw new TypeError("Refusing to send API credentials outside the configured HTTPS origin.");
    const headers = { Accept: "application/json, application/xml, text/xml, */*", [config.keyHeader]: config.keyPrefix ? `${config.keyPrefix} ${config.apiKey}` : config.apiKey };
    const options = { method: verb, headers };
    if (body !== undefined) { headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    options.signal = controller.signal;
    try {
      const response = await fetchImpl(url.toString(), options);
      const text = await response.text();
      let data = text;
      const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (type.includes("json") || /^\s*[\[{]/.test(text)) { try { data = JSON.parse(text); } catch {} }
      if (!response.ok) { const e = new Error(`Easy-Unlocker API returned HTTP ${response.status}.`); e.code = "EASY_UNLOCKER_HTTP_ERROR"; e.status = response.status; throw e; }
      return { status: response.status, contentType: type, data };
    } finally { clearTimeout(timeout); }
  }
  return {
    config: { configured: config.configured, baseUrl: config.baseUrl, servicesPath: config.servicesPath, timeoutMs: config.timeoutMs, missing: config.missing },
    request,
    async listServices() {
      if (!config.configured) { const e = new Error("Easy-Unlocker API credentials or configuration are incomplete."); e.code = "EASY_UNLOCKER_NOT_CONFIGURED"; e.missing = config.missing; throw e; }
      if (!config.servicesPath) { const e = new Error("The official services endpoint path is not configured."); e.code = "EASY_UNLOCKER_SERVICES_PATH_MISSING"; throw e; }
      return request(config.servicesPath);
    }
  };
}
module.exports = { readConfig, createEasyUnlockerClient };
