"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureBuybackOrdersTable } = require("../utils/buyback-schema");

test("buyback schema creates the table and applies compatibility migrations in order", async () => {
  const queries = [];
  const pool = { async query(sql) { queries.push(sql); return { rows: [] }; } };
  await ensureBuybackOrdersTable(pool);
  assert.equal(queries.length, 10);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS buyback_orders/);
  assert.match(queries[0], /order_no TEXT NOT NULL UNIQUE/);
  assert.ok(queries[1].includes("ADD COLUMN IF NOT EXISTS order_no TEXT"));
  assert.ok(queries[2].includes("ADD COLUMN IF NOT EXISTS model TEXT"));
  assert.ok(queries[3].includes("ADD COLUMN IF NOT EXISTS iban TEXT"));
  assert.ok(queries[4].includes("ADD COLUMN IF NOT EXISTS payment_method TEXT"));
  assert.ok(queries[5].includes("ADD COLUMN IF NOT EXISTS answers JSONB"));
  assert.ok(queries[6].includes("ADD COLUMN IF NOT EXISTS final_offer NUMERIC"));
  assert.ok(queries[7].includes("ADD COLUMN IF NOT EXISTS final_offer_sent_at TIMESTAMPTZ"));
  assert.ok(queries[8].includes("BT-LEGACY-"));
  assert.ok(queries[9].includes("ALTER COLUMN order_no SET NOT NULL"));
});

test("buyback schema stops and propagates an error from a failed migration", async () => {
  const queries = [];
  const failure = new Error("migration failed");
  const pool = {
    async query(sql) {
      queries.push(sql);
      if (queries.length === 4) throw failure;
      return { rows: [] };
    }
  };
  await assert.rejects(ensureBuybackOrdersTable(pool), error => error === failure);
  assert.equal(queries.length, 4);
});

test("buyback schema requires a query-capable database pool", async () => {
  await assert.rejects(ensureBuybackOrdersTable(null), /database pool is required/);
});
