"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ensureBuybackOrdersTable } = require("../utils/buyback-schema");

test("buyback schema creates the table and applies compatibility migrations in order", async () => {
  const queries = [];
  const pool = { async query(sql) { queries.push(sql); return { rows: [] }; } };
  await ensureBuybackOrdersTable(pool);
  assert.equal(queries.length, 32);
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
  assert.ok(queries[10].includes("ADD COLUMN IF NOT EXISTS trade_in BOOLEAN"));
  assert.ok(queries[11].includes("trade_in_quote_token_hash"));
  assert.ok(queries[12].includes("trade_in_quote_expires_at"));
  assert.ok(queries[13].includes("trade_in_linked_order_id"));
  assert.ok(queries[14].includes("trade_in_inspected_value"));
  assert.ok(queries[15].includes("trade_in_adjustment_reason"));
  assert.ok(queries[16].includes("trade_in_adjustment_status"));
  assert.ok(queries[17].includes("buyback_orders_trade_in_linked_order_unique"));
  assert.ok(queries[18].includes("sale_inspected_value"));
  assert.ok(queries[19].includes("sale_inspection_reason"));
  assert.ok(queries[20].includes("sale_approval_token_hash"));
  assert.ok(queries[21].includes("sale_approval_expires_at"));
  assert.ok(queries[22].includes("sale_approval_decision_at"));
  assert.ok(queries[23].includes("sale_settlement_note"));
  assert.ok(queries[24].includes("sale_settled_at"));
  assert.ok(queries[25].includes("sale_payout_email_sent_at"));
  assert.ok(queries[26].includes("postnl_tracking_number"));
  assert.ok(queries[27].includes("shipping_label_pdf BYTEA"));
  assert.ok(queries[28].includes("shipping_label_filename"));
  assert.ok(queries[29].includes("shipping_label_uploaded_at"));
  assert.ok(queries[30].includes("shipping_label_email_sent_at"));
  assert.ok(queries[31].includes("DELETE FROM buyback_orders"));
  assert.ok(queries[31].includes("trade_in_quote_expires_at <= NOW()"));
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
