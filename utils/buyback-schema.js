"use strict";

async function ensureBuybackOrdersTable(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool is required.");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS buyback_orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      device TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      model TEXT DEFAULT '',
      storage TEXT DEFAULT '',
      condition TEXT DEFAULT '',
      face_id TEXT DEFAULT '',
      battery TEXT DEFAULT '',
      screen TEXT DEFAULT '',
      offered_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      iban TEXT DEFAULT '',
      payment_method TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nieuw',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Keep this compatible with an already-existing buyback_orders table.
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS order_no TEXT`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS model TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS iban TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS final_offer NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE buyback_orders ADD COLUMN IF NOT EXISTS final_offer_sent_at TIMESTAMPTZ`);
  await pool.query(`UPDATE buyback_orders SET order_no = 'BT-LEGACY-' || id WHERE order_no IS NULL`);
  await pool.query(`ALTER TABLE buyback_orders ALTER COLUMN order_no SET NOT NULL`);
}

module.exports = { ensureBuybackOrdersTable };
