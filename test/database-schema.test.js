"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeDatabaseSchema } = require("../utils/database-schema");

function fakePool({ failAt = 0, siteSettingsExists = false } = {}) {
  const calls = [];
  let insertedDefaults = null;
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (failAt && calls.length === failAt) throw new Error("schema query failed");
      if (sql.includes("SELECT id FROM site_settings WHERE id = 1")) {
        return { rows: siteSettingsExists ? [{ id: 1 }] : [] };
      }
      if (sql.includes("INSERT INTO site_settings (id, data)")) {
        insertedDefaults = JSON.parse(params[0]);
      }
      return { rows: [] };
    }
  };
  return { pool, calls, get insertedDefaults() { return insertedDefaults; } };
}

test("database schema initializes all core application tables and migrations", async () => {
  const fake = fakePool();
  await initializeDatabaseSchema(fake.pool);
  const sql = fake.calls.map(call => call.sql).join("\n");
  for (const table of [
    "admin_emails",
    "device_register",
    "device_register_operations",
    "live_chat_conversations",
    "live_chat_messages",
    "site_settings",
    "customers",
    "customer_password_resets",
    "admin_users",
    "service_orders",
    "webshop_orders",
    "webshop_order_status_history",
    "webshop_order_notes",
    "order_settings",
    "manual_invoices"
  ]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + table));
  }
  assert.match(sql, /inventory_deducted_at TIMESTAMPTZ/);
  assert.match(sql, /payment_status TEXT NOT NULL DEFAULT 'Unpaid'/);
  assert.match(sql, /email_verified BOOLEAN NOT NULL DEFAULT TRUE/);
});

test("database schema inserts the default public settings only when missing", async () => {
  const missing = fakePool();
  await initializeDatabaseSchema(missing.pool);
  assert.equal(missing.insertedDefaults.siteName, "HOMS TECH");
  assert.equal(missing.insertedDefaults.devices.length, 6);
  assert.equal(missing.insertedDefaults.devices[0].name, "iPhone 12");
  assert.equal(missing.insertedDefaults.devices[5].name, "iPhone 17");

  const existing = fakePool({ siteSettingsExists: true });
  await initializeDatabaseSchema(existing.pool);
  assert.equal(existing.insertedDefaults, null);
  assert.ok(existing.calls.some(call => call.sql.includes("SELECT id FROM site_settings")));
});

test("database schema stops and propagates a failed migration", async () => {
  const fake = fakePool({ failAt: 5 });
  await assert.rejects(initializeDatabaseSchema(fake.pool), /schema query failed/);
  assert.equal(fake.calls.length, 5);
});

test("database schema requires a query-capable pool", async () => {
  await assert.rejects(initializeDatabaseSchema(null), /database pool is required/);
});
