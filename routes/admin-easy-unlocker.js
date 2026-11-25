"use strict";

const { parseEasyUnlockerCatalog } = require("../utils/easy-unlocker-catalog");

const CHUNK = 500;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 30 * 1024 * 1024;

async function ensureEasyUnlockerSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eu_services (
      product_id TEXT PRIMARY KEY,
      uuid TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL DEFAULT '',
      category_name TEXT NOT NULL DEFAULT '',
      price NUMERIC(14,4) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      image_url TEXT NOT NULL DEFAULT '',
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      in_catalog BOOLEAN NOT NULL DEFAULT TRUE,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      margin_percent NUMERIC(7,2),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    "CREATE INDEX IF NOT EXISTS eu_services_category_idx ON eu_services (category_id)",
  );
}

function rowToService(row) {
  return {
    id: row.product_id,
    name: row.name,
    type: row.type,
    categoryId: row.category_id,
    categoryName: row.category_name,
    price: Number(row.price),
    currency: row.currency,
    imageUrl: row.image_url,
    fields: Array.isArray(row.fields) ? row.fields : [],
    inCatalog: row.in_catalog,
    published: row.published,
    marginPercent:
      row.margin_percent === null || row.margin_percent === undefined
        ? null
        : Number(row.margin_percent),
    updatedAt: row.updated_at,
  };
}

function cleanMargin(value) {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(String(value).replace(",", "."));
  if (!Number.isFinite(number) || number < 0 || number > 500) return undefined;
  return Math.round(number * 100) / 100;
}

async function saveCatalog(pool, catalog) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < catalog.services.length; i += CHUNK) {
      const part = catalog.services.slice(i, i + CHUNK);
      await client.query(
        `INSERT INTO eu_services
           (product_id, uuid, name, type, category_id, category_name, price,
            currency, image_url, fields, in_catalog, updated_at)
         SELECT t.product_id, t.uuid, t.name, t.type, t.category_id,
                t.category_name, t.price, t.currency, t.image_url,
                t.fields::jsonb, TRUE, NOW()
         FROM unnest($1::text[], $2::text[], $3::text[], $4::text[],
                     $5::text[], $6::text[], $7::numeric[], $8::text[],
                     $9::text[], $10::text[])
           AS t(product_id, uuid, name, type, category_id, category_name,
                price, currency, image_url, fields)
         ON CONFLICT (product_id) DO UPDATE SET
           uuid = EXCLUDED.uuid, name = EXCLUDED.name, type = EXCLUDED.type,
           category_id = EXCLUDED.category_id,
           category_name = EXCLUDED.category_name, price = EXCLUDED.price,
           currency = EXCLUDED.currency, image_url = EXCLUDED.image_url,
           fields = EXCLUDED.fields, in_catalog = TRUE, updated_at = NOW()`,
        [
          part.map((s) => s.productId),
          part.map((s) => s.uuid),
          part.map((s) => s.name),
          part.map((s) => s.type),
          part.map((s) => s.categoryId),
          part.map((s) => s.categoryName),
          part.map((s) => s.price),
          part.map((s) => s.currency),
          part.map((s) => s.imageUrl),
          part.map((s) => JSON.stringify(s.fields)),
        ],
      );
    }
    await client.query(
      "UPDATE eu_services SET in_catalog = FALSE WHERE NOT (product_id = ANY($1::text[]))",
      [catalog.services.map((s) => s.productId)],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

function readConfig(env) {
  const base = String(env.EASYUNLOCKER_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(
    env.EASYUNLOCKER_API_TOKEN || env.EASYUNLOCKER_API_KEY || "",
  ).trim();
  if (!base || !token) return { error: "EASYUNLOCKER_BASE_URL of EASYUNLOCKER_API_TOKEN ontbreekt op de server." };
  let parsed;
  try {
    parsed = new URL(base);
  } catch {
    return { error: "EASYUNLOCKER_BASE_URL is geen geldige URL." };
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return { error: "EASYUNLOCKER_BASE_URL moet een https-adres zijn zonder gegevens of query." };
  }
  if (/[\r\n]/.test(token)) return { error: "API-token is ongeldig." };
  return { base, token };
}

async function callReadOnly(fetchImpl, config, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.base}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      const error = new Error("Antwoord te groot.");
      error.status = 502;
      throw error;
    }
    if (response.status === 401 || response.status === 402) {
      const error = new Error(
        "Easy Unlocker weigerde de toegang (HTTP " + response.status + "). Controleer het token en of het IP-adres van deze server is toegestaan.",
      );
      error.status = 502;
      throw error;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const error = new Error("Easy Unlocker gaf geen geldig JSON-antwoord (HTTP " + response.status + ").");
      error.status = 502;
      throw error;
    }
    if (!response.ok || json.status !== "success") {
      const error = new Error("Easy Unlocker gaf een fout (HTTP " + response.status + ").");
      error.status = 502;
      throw error;
    }
    return json;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeout = new Error("Easy Unlocker reageerde niet binnen 60 seconden.");
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function registerAdminEasyUnlockerRoutes(
  app,
  {
    requirePermission,
    queryWithConnectionRetry,
    pool,
    fetchImpl = globalThis.fetch,
    env = process.env,
  },
) {
  const permission = requirePermission("site.save");
  const fail = (res, error, fallback) => {
    const status = error && error.status ? error.status : 500;
    if (status >= 500 && status !== 502 && status !== 504) {
      console.error("[EASY UNLOCKER]", error);
    }
    return res.status(status).json({ error: status === 500 ? fallback : error.message });
  };

  app.get("/api/admin/easy-unlocker/services", permission, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim().slice(0, 100);
      const category = String(req.query.category || "").trim().slice(0, 40);
      const published = String(req.query.published || "");
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const page = Math.max(1, Number(req.query.page) || 1);

      const where = ["in_catalog = TRUE"];
      const params = [];
      if (q) {
        params.push("%" + q.replace(/[\\%_]/g, "\\$&") + "%");
        where.push(`name ILIKE $${params.length}`);
      }
      if (category) {
        params.push(category);
        where.push(`category_id = $${params.length}`);
      }
      if (published === "1") where.push("published = TRUE");
      if (published === "0") where.push("published = FALSE");
      const clause = where.join(" AND ");

      const [list, total, cats, summary] = await Promise.all([
        queryWithConnectionRetry(
          `SELECT * FROM eu_services WHERE ${clause} ORDER BY published DESC, category_name, name LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
          params,
          3,
        ),
        queryWithConnectionRetry(
          `SELECT COUNT(*)::int AS n FROM eu_services WHERE ${clause}`,
          params,
          3,
        ),
        queryWithConnectionRetry(
          "SELECT category_id AS id, MAX(category_name) AS name, COUNT(*)::int AS n FROM eu_services WHERE in_catalog = TRUE GROUP BY category_id ORDER BY MAX(category_name)",
          [],
          3,
        ),
        queryWithConnectionRetry(
          "SELECT COUNT(*) FILTER (WHERE in_catalog)::int AS total, COUNT(*) FILTER (WHERE in_catalog AND published)::int AS published, MAX(updated_at) AS last_import, MAX(currency) AS currency FROM eu_services",
          [],
          3,
        ),
      ]);
      res.set("Cache-Control", "no-store");
      return res.json({
        services: list.rows.map(rowToService),
        total: total.rows[0].n,
        page,
        limit,
        categories: cats.rows.map((c) => ({ id: c.id, name: c.name || "—", count: c.n })),
        summary: {
          total: summary.rows[0].total || 0,
          published: summary.rows[0].published || 0,
          lastImport: summary.rows[0].last_import || null,
          currency: summary.rows[0].currency || "USD",
        },
      });
    } catch (error) {
      return fail(res, error, "Diensten laden mislukt.");
    }
  });

  app.post("/api/admin/easy-unlocker/import", permission, async (req, res) => {
    try {
      const catalog = parseEasyUnlockerCatalog(req.body);
      await saveCatalog(pool, catalog);
      return res.json({ ok: true, count: catalog.services.length, currency: catalog.currency });
    } catch (error) {
      if (/Ongeldig bestand|Geen diensten/.test(String(error.message))) {
        return res.status(400).json({ error: error.message });
      }
      return fail(res, error, "Importeren mislukt.");
    }
  });

  app.post("/api/admin/easy-unlocker/sync", permission, async (_req, res) => {
    const config = readConfig(env);
    if (config.error) return res.status(503).json({ error: config.error });
    try {
      const json = await callReadOnly(fetchImpl, config, "/products");
      const catalog = parseEasyUnlockerCatalog(json);
      await saveCatalog(pool, catalog);
      return res.json({ ok: true, count: catalog.services.length, currency: catalog.currency });
    } catch (error) {
      return fail(res, error, "Synchroniseren mislukt.");
    }
  });

  app.post("/api/admin/easy-unlocker/test", permission, async (_req, res) => {
    const config = readConfig(env);
    if (config.error) return res.status(503).json({ error: config.error });
    try {
      const json = await callReadOnly(fetchImpl, config, "/account");
      const data = json.data || {};
      return res.json({
        ok: true,
        balance: data.balance === undefined ? null : String(data.balance),
        currency: data.currency ? String(data.currency).slice(0, 8) : "",
      });
    } catch (error) {
      return fail(res, error, "Verbinding testen mislukt.");
    }
  });

  app.patch("/api/admin/easy-unlocker/services/:id", permission, async (req, res) => {
    try {
      const id = String(req.params.id || "").slice(0, 40);
      const sets = [];
      const params = [id];
      if (req.body && typeof req.body.published === "boolean") {
        params.push(req.body.published);
        sets.push(`published = $${params.length}`);
      }
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, "marginPercent")) {
        const margin = cleanMargin(req.body.marginPercent);
        if (margin === undefined) {
          return res.status(400).json({ error: "Winstmarge moet tussen 0 en 500% liggen." });
        }
        params.push(margin);
        sets.push(`margin_percent = $${params.length}`);
      }
      if (!sets.length) return res.status(400).json({ error: "Niets om te wijzigen." });
      const result = await queryWithConnectionRetry(
        `UPDATE eu_services SET ${sets.join(", ")} WHERE product_id = $1 RETURNING *`,
        params,
        3,
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Dienst niet gevonden." });
      return res.json({ service: rowToService(result.rows[0]) });
    } catch (error) {
      return fail(res, error, "Opslaan mislukt.");
    }
  });

  app.post("/api/admin/easy-unlocker/services/bulk", permission, async (req, res) => {
    try {
      const ids = Array.isArray(req.body && req.body.ids)
        ? req.body.ids.map((v) => String(v).slice(0, 40)).slice(0, 500)
        : [];
      if (!ids.length || typeof req.body.published !== "boolean") {
        return res.status(400).json({ error: "Ongeldige selectie." });
      }
      const result = await queryWithConnectionRetry(
        "UPDATE eu_services SET published = $2 WHERE product_id = ANY($1::text[]) AND in_catalog = TRUE",
        [ids, req.body.published],
        3,
      );
      return res.json({ ok: true, updated: result.rowCount || 0 });
    } catch (error) {
      return fail(res, error, "Opslaan mislukt.");
    }
  });
}

module.exports = { registerAdminEasyUnlockerRoutes, ensureEasyUnlockerSchema, readConfig };
