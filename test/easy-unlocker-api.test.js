const test = require("node:test");
const assert = require("node:assert/strict");
const { readConfig, createEasyUnlockerClient } = require("../lib/easy-unlocker-api");

const validEnv = {
  EASY_UNLOCKER_API_BASE_URL: "https://easy-unlocker.com",
  EASY_UNLOCKER_API_KEY: "test-secret",
  EASY_UNLOCKER_API_SERVICES_PATH: "/documented/services",
  EASY_UNLOCKER_API_KEY_HEADER: "X-API-Key",
  EASY_UNLOCKER_API_TIMEOUT_MS: "5000"
};

test("does not consider a key alone to be a configured API", () => {
  const config = readConfig({ EASY_UNLOCKER_API_KEY: "test-secret" });
  assert.equal(config.configured, false);
  assert.ok(config.missing.includes("EASY_UNLOCKER_API_BASE_URL must be a valid HTTPS base URL"));
  assert.ok(config.missing.includes("EASY_UNLOCKER_API_SERVICES_PATH must be the official absolute path"));
  assert.ok(config.missing.includes("EASY_UNLOCKER_API_KEY_HEADER must be the documented HTTP header name"));
});

test("rejects non-HTTPS API base URLs", () => {
  const config = readConfig({ ...validEnv, EASY_UNLOCKER_API_BASE_URL: "http://easy-unlocker.com" });
  assert.equal(config.configured, false);
});

test("uses the documented key header only on the configured HTTPS origin", async () => {
  let captured;
  const client = createEasyUnlockerClient({
    env: validEnv,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ services: [] })
      };
    }
  });
  const response = await client.listServices();
  assert.deepEqual(response.data, { services: [] });
  assert.equal(captured.url, "https://easy-unlocker.com/documented/services");
  assert.equal(captured.options.headers["X-API-Key"], "test-secret");
  assert.equal(captured.options.headers.Authorization, undefined);
});

test("does not make a network call when the endpoint contract is incomplete", async () => {
  let called = false;
  const client = createEasyUnlockerClient({
    env: { EASY_UNLOCKER_API_KEY: "test-secret" },
    fetchImpl: async () => { called = true; throw new Error("should not call"); }
  });
  await assert.rejects(client.listServices, { code: "EASY_UNLOCKER_NOT_CONFIGURED" });
  assert.equal(called, false);
});

test("rejects absolute paths to prevent sending credentials to another host", async () => {
  const client = createEasyUnlockerClient({
    env: validEnv,
    fetchImpl: async () => { throw new Error("should not call"); }
  });
  await assert.rejects(
    client.request("https://attacker.example/collect"),
    /API path must be a relative path/
  );
});
