"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { initializeDatabaseWithRetry } = require("../utils/database-initialization");

test("database initialization returns immediately when the first attempt succeeds", async () => {
  let attempts = 0;
  const delays = [];
  await initializeDatabaseWithRetry(
    async () => { attempts += 1; },
    async delay => { delays.push(delay); },
    5,
    () => {}
  );
  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
});

test("database initialization retries transient failures with increasing delays", async () => {
  let attempts = 0;
  const delays = [];
  await initializeDatabaseWithRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("temporary connection failure");
    },
    async delay => { delays.push(delay); },
    5,
    () => {}
  );
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("database initialization caps retry delays at ten seconds", async () => {
  let attempts = 0;
  const delays = [];
  await initializeDatabaseWithRetry(
    async () => { attempts += 1; throw new Error("offline"); },
    async delay => { delays.push(delay); },
    7,
    () => {}
  ).catch(() => {});
  assert.equal(attempts, 7);
  assert.deepEqual(delays, [2000, 4000, 6000, 8000, 10000, 10000]);
});

test("database initialization throws the last error after exhausting attempts", async () => {
  let attempts = 0;
  const lastError = new Error("database remains unavailable");
  await assert.rejects(
    initializeDatabaseWithRetry(
      async () => { attempts += 1; throw lastError; },
      async () => {},
      3,
      () => {}
    ),
    error => error === lastError
  );
  assert.equal(attempts, 3);
});

test("database initialization rejects invalid retry configuration", async () => {
  await assert.rejects(
    initializeDatabaseWithRetry(async () => {}, async () => {}, 0),
    /maxAttempts must be a positive integer/
  );
});
