const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GSM_CATEGORIES,
  normalizeCategory,
  normalizeService,
  validateDynamicFieldValues,
  createLocalGsmProvider,
  getEasyUnlockerApiReadiness
} = require("../lib/gsm-provider");

test("accepts only supported GSM categories", () => {
  assert.equal(normalizeCategory("IMEI"), "imei");
  assert.equal(normalizeCategory("unknown"), null);
  assert.deepEqual(GSM_CATEGORIES, ["imei", "remote", "server", "frp", "firmware"]);
});

test("normalizes services and forces storefront currency to EUR", () => {
  const service = normalizeService({ name: "  Test Service ", price: "12.50", priceCurrency: "USD" }, "server");
  assert.equal(service.name, "Test Service");
  assert.equal(service.category, "server");
  assert.equal(service.price, "12.50");
  assert.equal(service.priceCurrency, "EUR");
  assert.equal(service.active, true);
});

test("rejects malformed services and invalid prices", () => {
  assert.throws(() => normalizeService({ name: "Bad", price: "-1" }, "imei"));
  assert.throws(() => normalizeService({ price: "5" }, "imei"));
  assert.throws(() => normalizeService({ name: "Bad" }, "other"));
});

test("local provider reads and saves without losing other categories", async () => {
  let catalog = { imei: [{ sourceId: "one", name: "Existing" }], server: [] };
  const provider = createLocalGsmProvider({
    loadCatalog: async () => catalog,
    saveCatalog: async next => { catalog = next; }
  });
  await provider.saveService("server", { sourceId: "srv-1", name: "Server Service", price: "4.00" });
  assert.equal(catalog.imei[0].name, "Existing");
  assert.equal(catalog.server[0].name, "Server Service");
  assert.equal((await provider.listServices()).server.length, 1);
});

test("normalizes dynamic select fields and limits unsafe field definitions", () => {
  const service = normalizeService({
    name: "Custom service",
    formFields: [
      { key: "device model!", label: "Model", type: "select", required: true, options: ["iPhone", "Samsung", "<script>"], autoFromEmail: false },
      { key: "!!!", label: "Ignored invalid key", type: "unsupported" },
      null
    ]
  }, "remote");
  assert.equal(service.formFields.length, 1);
  assert.equal(service.formFields[0].key, "devicemodel");
  assert.equal(service.formFields[0].type, "select");
  assert.equal(service.formFields[0].required, true);
  assert.deepEqual(service.formFields[0].options, ["iPhone", "Samsung", "<script>"]);
});

test("rejects excessive or malformed prices and bounds long service names", () => {
  assert.throws(() => normalizeService({ name: "Service", price: "1.234" }, "server"));
  const service = normalizeService({ name: "X".repeat(250) }, "server");
  assert.equal(service.name.length, 180);
});

test("validates required dynamic fields and enforces dropdown options", () => {
  const fields = [
    { key: "email", label: "Account e-mail", type: "email", required: true },
    { key: "model", label: "Device model", type: "select", required: true, options: ["iPhone", "Samsung"] }
  ];
  assert.deepEqual(validateDynamicFieldValues(fields, {}), {
    valid: false, key: "email", label: "Account e-mail", reason: "required"
  });
  assert.equal(validateDynamicFieldValues(fields, { email: "user@example.com", model: "iPhone" }).valid, true);
  assert.deepEqual(validateDynamicFieldValues(fields, { email: "user@example.com", model: "Injected option" }), {
    valid: false, key: "model", label: "Device model", reason: "invalid_option"
  });
});

test("does not claim Easy-Unlocker API is ready without credentials", () => {
  const result = getEasyUnlockerApiReadiness({});
  assert.equal(result.configured, false);
  assert.equal(result.provider, "local");
});
