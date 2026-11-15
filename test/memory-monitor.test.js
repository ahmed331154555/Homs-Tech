"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { startMemoryMonitor, formatMemoryLog } = require("../utils/memory-monitor");

test("formats RSS, V8 heap and external memory in MiB", () => {
  const line = formatMemoryLog({
    rss: 10 * 1024 * 1024,
    heapUsed: 4 * 1024 * 1024,
    heapTotal: 6 * 1024 * 1024,
    external: 2 * 1024 * 1024,
    arrayBuffers: 1 * 1024 * 1024
  });

  assert.equal(line, "[MEMORY] rss=10.0MiB heapUsed=4.0MiB heapTotal=6.0MiB external=2.0MiB arrayBuffers=1.0MiB");
});

test("logs immediately, schedules an unref'd interval and reports subsequent samples", () => {
  const messages = [];
  let scheduledCallback;
  let scheduledDelay;
  let unrefCalled = false;
  const timer = { unref() { unrefCalled = true; } };
  const samples = [
    { rss: 8 * 1024 * 1024, heapUsed: 3 * 1024 * 1024, heapTotal: 5 * 1024 * 1024, external: 1, arrayBuffers: 0 },
    { rss: 9 * 1024 * 1024, heapUsed: 4 * 1024 * 1024, heapTotal: 6 * 1024 * 1024, external: 2, arrayBuffers: 1 }
  ];

  const returnedTimer = startMemoryMonitor({
    intervalMs: 2000,
    getMemoryUsage: () => samples.shift(),
    log: message => messages.push(message),
    setIntervalImpl: (callback, delay) => {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return timer;
    }
  });

  assert.equal(returnedTimer, timer);
  assert.equal(unrefCalled, true);
  assert.equal(scheduledDelay, 2000);
  assert.equal(messages.length, 1);
  scheduledCallback();
  assert.equal(messages.length, 2);
  assert.match(messages[0], /rss=8.0MiB/);
  assert.match(messages[1], /rss=9.0MiB/);
});

test("rejects an interval that could create an overly frequent log loop", () => {
  assert.throws(() => startMemoryMonitor({ intervalMs: 999 }), /at least 1000ms/);
});
