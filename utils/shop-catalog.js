"use strict";

/**
 * Persist only the Shop catalog key so unrelated site settings are not overwritten.
 * The JSONB update is performed by PostgreSQL in one statement.
 */
async function saveShopCatalog(queryWithConnectionRetry, shopProducts) {
  const result = await queryWithConnectionRetry(
    "UPDATE site_settings SET data = jsonb_set(data, '{shopProducts}', $1::jsonb, true) WHERE id = 1 RETURNING data->'shopProducts' AS products",
    [JSON.stringify(shopProducts)],
    4
  );

  return Array.isArray(result.rows[0]?.products)
    ? result.rows[0].products
    : [];
}

module.exports = { saveShopCatalog };
