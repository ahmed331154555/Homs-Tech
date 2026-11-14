"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerAdminInventoryRoutes, inventoryCatalog } = require("../routes/admin-inventory");

function makeHarness({ data = {}, history = [], actor = "warehouse.admin" } = {}) {
  const routes = new Map();
  const queries = [];
  let savedData = data;
  const movementRows = [...history];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM site_settings") && sql.includes("FOR UPDATE")) return { rows: [{ phones: savedData.phones || [], shop_products: savedData.shopProducts || [] }] };
      if (sql.includes("UPDATE site_settings")) {
        const key = sql.includes("'{shopProducts}'") ? "shopProducts" : "phones";
        savedData = { ...savedData, [key]: JSON.parse(params[0]) };
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO inventory_movements")) {
        const row = {
          id: movementRows.length + 1,
          item_type: params[0],
          product_id: params[1],
          variant_id: params[2],
          product_name: params[3],
          variant_label: params[4],
          sku: params[5],
          movement_type: params[6],
          quantity: params[7],
          stock_before: params[8],
          stock_after: params[9],
          reference: params[10],
          note: params[11],
          created_by: params[12],
          created_at: new Date("2026-11-10T10:00:00Z")
        };
        movementRows.unshift(row);
        return { rows: [row] };
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = {
    async query(sql) {
      queries.push({ sql, params: [] });
      if (sql.includes("FROM site_settings")) return { rows: [{ phones: savedData.phones || [], devices: savedData.devices || [], shop_products: savedData.shopProducts || [] }] };
      if (sql.includes("FROM inventory_movements")) return { rows: movementRows };
      return { rows: [] };
    },
    async connect() { return client; }
  };
  const app = {
    get(path, ...handlers) { routes.set("GET " + path, handlers.at(-1)); },
    post(path, ...handlers) { routes.set("POST " + path, handlers.at(-1)); }
  };
  registerAdminInventoryRoutes(app, {
    pool,
    requirePermission: permission => {
      assert.equal(permission, "site.save");
      return (_req, _res, next) => next();
    }
  });
  return { routes, pool, queries, getData: () => savedData, getMovements: () => movementRows, actor };
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("inventory catalog lists phone and Shop variants without duplicating parent stock", () => {
  const rows = inventoryCatalog({
    phones: [{
      id: "phone-1",
      name: "iPhone 13",
      pricingMode: "variant",
      variantPrices: [
        { storage: "128GB", color: "Black", condition: "A", stock: 3 },
        { storage: "256GB", color: "Blue", condition: "B", stock: 0 }
      ]
    }],
    shopProducts: [{
      id: "part-1",
      name: "iPhone 13 screen",
      category: "Onderdelen",
      variants: [{ id: "screen-oled", sku: "HT-SCR-01", quality: "OLED", stock: "4" }]
    }]
  });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.stock), [3, 0, 4]);
  assert.equal(rows[0].variantLabel, "128GB · Black · A");
  assert.equal(rows[2].sku, "HT-SCR-01");
});

test("inventory overview returns counts and recent movement history", async () => {
  const history = [{ id: 7, movement_type: "purchase", quantity: 5 }];
  const h = makeHarness({
    data: {
      phones: [{ id: "p1", name: "iPhone", stock: 2 }],
      shopProducts: [{ id: "s1", name: "Screen", stock: "3 stuks" }]
    },
    history
  });
  const res = response();
  await h.routes.get("GET /api/admin/inventory")({ query: { threshold: "2" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.products, 2);
  assert.equal(res.body.summary.totalUnits, 5);
  assert.equal(res.body.summary.lowStockCount, 1);
  assert.equal(res.body.movements[0].id, 7);
  const catalogQuery = h.queries.find(query => query.sql.includes("FROM site_settings"));
  assert.ok(catalogQuery);
  assert.match(catalogQuery.sql, /jsonb_build_object/);
  assert.match(catalogQuery.sql, /'variantPrices'/);
  assert.match(catalogQuery.sql, /shop_products/);
  assert.doesNotMatch(catalogQuery.sql, /SELECT data FROM site_settings/i);
  assert.doesNotMatch(catalogQuery.sql, /'image'|'images'|'colorGalleryImages'/i);
});

test("Shop purchase movement updates stock and writes an audit record atomically", async () => {
  const h = makeHarness({
    data: {
      shopProducts: [{
        id: "screen-1",
        name: "iPhone 13 OLED",
        variants: [{ id: "oled-black", sku: "HT-001", quality: "OLED", stock: "2", active: true }]
      }]
    }
  });
  const res = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    admin: { username: "warehouse.admin" },
    body: {
      itemType: "shop",
      productId: "screen-1",
      variantId: "oled-black",
      movementType: "purchase",
      quantity: 5,
      reference: "INK-2026-001",
      note: "Nieuwe levering"
    }
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.stock, 7);
  assert.equal(h.getData().shopProducts[0].variants[0].stock, "7");
  assert.equal(h.getMovements()[0].quantity, 5);
  assert.equal(h.getMovements()[0].stock_before, 2);
  assert.equal(h.getMovements()[0].stock_after, 7);
  assert.equal(h.getMovements()[0].created_by, "warehouse.admin");
  assert.ok(h.queries.some(query => query.sql === "COMMIT"));
});

test("inventory sale cannot make stock negative", async () => {
  const h = makeHarness({
    data: {
      phones: [{
        id: "phone-1",
        name: "iPhone 13",
        variantPrices: [{ storage: "128GB", color: "Black", condition: "A", stock: 1 }]
      }]
    }
  });
  const res = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    body: {
      itemType: "phone",
      productId: "phone-1",
      variantIndex: 0,
      variantKey: "128GB::Black::A",
      movementType: "sale",
      quantity: 2
    }
  }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(h.getData().phones[0].variantPrices[0].stock, 1);
  assert.equal(h.getMovements().length, 0);
});

test("inventory correction requires a reason and accepts signed deltas", async () => {
  const h = makeHarness({
    data: { phones: [{ id: "phone-1", name: "iPhone 13", stock: 4 }] }
  });
  const invalid = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    body: { itemType: "phone", productId: "phone-1", movementType: "correction", quantity: -1 }
  }, invalid);
  assert.equal(invalid.statusCode, 400);

  const valid = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    body: {
      itemType: "phone",
      productId: "phone-1",
      movementType: "correction",
      quantity: -1,
      note: "Foutieve telling gecorrigeerd"
    }
  }, valid);
  assert.equal(valid.statusCode, 201);
  assert.equal(valid.body.stock, 3);
  assert.equal(h.getMovements()[0].movement_type, "correction");
});

test("inventory rejects stale Shop variants instead of changing another option", async () => {
  const h = makeHarness({
    data: {
      shopProducts: [{
        id: "screen-1",
        name: "Screen",
        variants: [{ id: "new-id", sku: "HT-001", quality: "OLED", stock: "2" }]
      }]
    }
  });
  const res = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    body: {
      itemType: "shop",
      productId: "screen-1",
      variantId: "old-id",
      movementType: "purchase",
      quantity: 2
    }
  }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(h.getData().shopProducts[0].variants[0].stock, "2");
  assert.equal(h.getMovements().length, 0);
});

test("inventory rejects invalid quantities and movement types", async () => {
  const h = makeHarness({ data: { phones: [{ id: "p1", name: "iPhone", stock: 2 }] } });
  for (const body of [
    { itemType: "phone", productId: "p1", movementType: "sale", quantity: 0 },
    { itemType: "phone", productId: "p1", movementType: "unknown", quantity: 1 },
    { itemType: "phone", productId: "p1", movementType: "sale", quantity: 1.5 }
  ]) {
    const res = response();
    await h.routes.get("POST /api/admin/inventory/movements")({ body }, res);
    assert.equal(res.statusCode, 400);
  }
});


test("legacy Shop product stock accepts the catalog's 'N stuks' format", async () => {
  const h = makeHarness({
    data: {
      shopProducts: [{
        id: "cable-1",
        name: "USB-C cable",
        stock: "4 stuks",
        variants: []
      }]
    }
  });
  const res = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    admin: { username: "warehouse.admin" },
    body: {
      itemType: "shop",
      productId: "cable-1",
      movementType: "sale",
      quantity: 1,
      note: "Verkoop aan klant"
    }
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.stock, 3);
  assert.equal(h.getData().shopProducts[0].stock, "3 stuks");
  assert.equal(h.getMovements()[0].stock_before, 4);
  assert.equal(h.getMovements()[0].stock_after, 3);
});

test("inventory movement rejects a malformed legacy Shop stock value without changing it", async () => {
  const h = makeHarness({
    data: { shopProducts: [{ id: "cable-2", name: "Cable", stock: "voorraad onbekend" }] }
  });
  const res = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    body: {
      itemType: "shop",
      productId: "cable-2",
      movementType: "purchase",
      quantity: 2,
      note: "Voorraad aanvullen"
    }
  }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(h.getData().shopProducts[0].stock, "voorraad onbekend");
  assert.equal(h.getMovements().length, 0);
});


test("first Shop purchase initializes an untracked product stock balance", async () => {
  const h = makeHarness({
    data: { shopProducts: [{ id: "new-cable", name: "New cable", stock: "" }] }
  });
  const res = response();
  await h.routes.get("POST /api/admin/inventory/movements")({
    body: {
      itemType: "shop",
      productId: "new-cable",
      movementType: "purchase",
      quantity: 6,
      note: "Eerste voorraadregistratie"
    }
  }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.stock, 6);
  assert.equal(h.getData().shopProducts[0].stock, "6 stuks");
  assert.equal(h.getMovements()[0].stock_before, 0);
  assert.equal(h.getMovements()[0].stock_after, 6);
});


test("legacy phone products keep parent stock when checkout does not use variant pricing", () => {
  const rows = inventoryCatalog({
    phones: [{
      id: "legacy-phone",
      name: "Legacy iPhone",
      stock: 4,
      variantPrices: [
        { storage: "128GB", color: "Black", condition: "A", stock: 8 },
        { storage: "256GB", color: "Blue", condition: "B", stock: 9 }
      ]
    }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stock, 4);
  assert.equal(rows[0].variantLabel, "Standaard");
});
