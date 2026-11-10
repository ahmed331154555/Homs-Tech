"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaidOrderInventoryDeductor } = require("../utils/paid-order-inventory");

function createFakePool(order, catalog) {
  const calls = [];
  let savedCatalog = null;
  const client = {
    async query(sql, params = []) {
      calls.push({ scope: "client", sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("SELECT id, items, payment_status")) return { rows: order ? [structuredClone(order)] : [] };
      if (sql.includes("SELECT data FROM site_settings")) return { rows: catalog === null ? [] : [{ data: structuredClone(catalog) }] };
      if (sql.includes("UPDATE site_settings SET data=")) {
        savedCatalog = JSON.parse(params[0]);
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() { calls.push({ scope: "client", sql: "RELEASE" }); }
  };
  const pool = {
    async connect() { return client; },
    async query(sql, params = []) {
      calls.push({ scope: "pool", sql, params });
      return { rows: [] };
    }
  };
  return { pool, calls, get savedCatalog() { return savedCatalog; } };
}

test("inventory deduction skips orders that are not paid", async () => {
  const fake = createFakePool({ id: 1, items: [], payment_status: "Pending" }, {});
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  assert.deepEqual(await deduct(1), { skipped: true });
  assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(fake.savedCatalog, null);
});

test("inventory deduction is idempotent for an order already deducted", async () => {
  const fake = createFakePool({ id: 2, items: [], payment_status: "Paid", inventory_deducted_at: "2026-01-01" }, {});
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  assert.deepEqual(await deduct(2), { alreadyDeducted: true });
  assert.ok(fake.calls.some(call => call.sql === "COMMIT"));
  assert.equal(fake.savedCatalog, null);
});

test("inventory deduction decrements standard phone stock and commits once", async () => {
  const fake = createFakePool(
    { id: 3, payment_status: "Paid", items: [{ type: "phone", id: 0, qty: 2 }] },
    { phones: [{ name: "Phone", stock: 5 }] }
  );
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  assert.deepEqual(await deduct(3), { deducted: true });
  assert.equal(fake.savedCatalog.phones[0].stock, 3);
  assert.ok(fake.calls.some(call => call.sql.includes("inventory_deducted_at=NOW()")));
  assert.ok(fake.calls.some(call => call.sql === "COMMIT"));
});

test("inventory deduction decrements the exact selected variant", async () => {
  const fake = createFakePool(
    {
      id: 4, payment_status: "Paid",
      items: [{ type: "phone", id: 0, qty: 2, options: { condition: "New", color: "Black", storage: "128 GB" } }]
    },
    { phones: [{ pricingMode: "variant", variantPrices: [
      { condition: "New", color: "Black", storage: "128 GB", stock: 5 },
      { condition: "New", color: "Blue", storage: "128 GB", stock: 8 }
    ] }] }
  );
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  assert.deepEqual(await deduct(4), { deducted: true });
  assert.equal(fake.savedCatalog.phones[0].variantPrices[0].stock, 3);
  assert.equal(fake.savedCatalog.phones[0].variantPrices[1].stock, 8);
});

test("inventory deduction decrements selected custom add-on stock", async () => {
  const fake = createFakePool(
    { id: 5, payment_status: "Paid", items: [
      { type: "phone", id: 0, qty: 2, options: { custom: { "optionGroups:0": "Case" } } }
    ] },
    { phones: [{ name: "Phone", stock: 5, optionGroups: [
      { options: [{ label: "Case", stock: 4 }] }
    ] }] }
  );
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  assert.deepEqual(await deduct(5), { deducted: true });
  assert.equal(fake.savedCatalog.phones[0].stock, 3);
  assert.equal(fake.savedCatalog.phones[0].optionGroups[0].options[0].stock, 2);
});

test("inventory deduction rolls back and records an error when stock is insufficient", async () => {
  const fake = createFakePool(
    { id: 6, payment_status: "Paid", items: [{ type: "phone", id: 0, qty: 3 }] },
    { phones: [{ name: "Phone", stock: 2 }] }
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
    assert.deepEqual(await deduct(6), { error: true });
  } finally {
    console.error = originalError;
  }
  assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(fake.savedCatalog, null);
  assert.ok(fake.calls.some(call => call.scope === "pool" && call.sql.includes("inventory_error=$1")));
});

test("inventory deduction fails safely when the catalog row is missing", async () => {
  const fake = createFakePool({ id: 7, payment_status: "Paid", items: [] }, null);
  const originalError = console.error;
  console.error = () => {};
  try {
    const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
    assert.deepEqual(await deduct(7), { error: true });
  } finally {
    console.error = originalError;
  }
  assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(fake.savedCatalog, null);
});

test("legacy second-hand paid orders fail safely without changing the catalog", async () => {
  const fake = createFakePool(
    { id: 8, payment_status: "Paid", items: [{ type: "used", id: 0, qty: 1 }] },
    { usedPhones: [{ name: "Legacy phone", stock: 3 }], phones: [] }
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
    assert.deepEqual(await deduct(8), { error: true });
  } finally {
    console.error = originalError;
  }
  assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(fake.savedCatalog, null);
  assert.ok(fake.calls.some(call => call.scope === "pool" && call.sql.includes("inventory_error=$1")));
});


test("paid webshop stock deductions are written to the central inventory history", async () => {
  const fake = createFakePool(
    {
      id: 39,
      payment_status: "Paid",
      items: [{ type: "phone", id: 0, qty: 2, sku: "HT-PHONE-13", options: { condition: "A", color: "Black", storage: "128GB" } }]
    },
    {
      phones: [{
        name: "iPhone 13",
        pricingMode: "variant",
        variantPrices: [{ condition: "A", color: "Black", storage: "128GB", stock: 5 }]
      }]
    }
  );
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  assert.deepEqual(await deduct(39), { deducted: true });
  const movement = fake.calls.find(call => call.sql.includes("INSERT INTO inventory_movements"));
  assert.ok(movement, "a central inventory movement should be inserted");
  assert.equal(movement.params[0], "phone");
  assert.equal(movement.params[3], "iPhone 13");
  assert.equal(movement.params[6], -2);
  assert.equal(movement.params[7], 5);
  assert.equal(movement.params[8], 3);
  assert.equal(movement.params[9], "Webshop bestelling #39");
  assert.ok(fake.calls.some(call => call.sql === "COMMIT"));
});


test("paid order rejects fractional custom add-on stock without saving the catalog", async () => {
  const fake = createFakePool(
    {
      id: 41,
      payment_status: "Paid",
      items: [{ type: "phone", id: 0, qty: 1, options: { custom: { "optionGroups:0": "Case" } } }]
    },
    {
      phones: [{
        name: "Phone",
        stock: 5,
        optionGroups: [{ options: [{ label: "Case", stock: 1.5 }] }]
      }]
    }
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
    assert.deepEqual(await deduct(41), { error: true });
  } finally {
    console.error = originalError;
  }
  assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(fake.savedCatalog, null);
  assert.ok(fake.calls.some(call => call.scope === "pool" && call.sql.includes("inventory_error=$1")));
});

test("paid order accepts whole-number custom add-on stock and deducts exactly once", async () => {
  const fake = createFakePool(
    {
      id: 42,
      payment_status: "Paid",
      items: [{ type: "phone", id: 0, qty: 2, options: { custom: { "optionGroups:0": "Case" } } }]
    },
    {
      phones: [{
        name: "Phone",
        stock: 5,
        optionGroups: [{ options: [{ label: "Case", stock: 4 }] }]
      }]
    }
  );
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  assert.deepEqual(await deduct(42), { deducted: true });
  assert.equal(fake.savedCatalog.phones[0].optionGroups[0].options[0].stock, 2);
  assert.ok(fake.calls.some(call => call.sql === "COMMIT"));
});


test("paid order rejects unsupported item types without changing inventory", async () => {
  const fake = createFakePool(
    { id: 43, payment_status: "Paid", items: [{ type: "unknown", id: 0, qty: 1 }] },
    { phones: [{ name: "Phone", stock: 5 }] }
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
    assert.deepEqual(await deduct(43), { error: true });
  } finally {
    console.error = originalError;
  }
  assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
  assert.equal(fake.savedCatalog, null);
  assert.ok(fake.calls.some(call => call.scope === "pool" && call.sql.includes("inventory_error=$1")));
});

test("paid order rejects missing or empty item lists for manual review", async () => {
  for (const items of [null, [], "not-an-array"]) {
    const fake = createFakePool(
      { id: 44, payment_status: "Paid", items },
      { phones: [{ name: "Phone", stock: 5 }] }
    );
    const originalError = console.error;
    console.error = () => {};
    try {
      const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
      assert.deepEqual(await deduct(44), { error: true });
    } finally {
      console.error = originalError;
    }
    assert.ok(fake.calls.some(call => call.sql === "ROLLBACK"));
    assert.equal(fake.savedCatalog, null);
  }
});


test("inventory deduction rejects invalid order identifiers before connecting", async () => {
  const fake = createFakePool(
    { id: 1, payment_status: "Paid", items: [{ type: "phone", id: 0, qty: 1 }] },
    { phones: [{ name: "Phone", stock: 2 }] }
  );
  const deduct = createPaidOrderInventoryDeductor({ pool: fake.pool });
  for (const invalidId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, "1", null]) {
    assert.deepEqual(await deduct(invalidId), { error: true });
  }
  assert.equal(fake.calls.length, 0, "invalid identifiers must not open or query a database connection");
  assert.equal(fake.savedCatalog, null);
});
