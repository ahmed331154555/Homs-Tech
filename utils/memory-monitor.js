"use strict";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const BYTES_PER_MIB = 1024 * 1024;

function toMiB(bytes) {
  return (Number(bytes) / BYTES_PER_MIB).toFixed(1);
}

function formatMemoryLog(memory) {
  return [
    "[MEMORY]",
    `rss=${toMiB(memory.rss)}MiB`,
    `heapUsed=${toMiB(memory.heapUsed)}MiB`,
    `heapTotal=${toMiB(memory.heapTotal)}MiB`,
    `external=${toMiB(memory.external)}MiB`,
    `arrayBuffers=${toMiB(memory.arrayBuffers || 0)}MiB`
  ].join(" ");
}

function startMemoryMonitor(options = {}) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) {
    throw new TypeError("Memory monitor interval must be at least 1000ms");
  }

  const getMemoryUsage = options.getMemoryUsage || (() => process.memoryUsage());
  const log = options.log || (message => console.info(message));
  const setIntervalImpl = options.setIntervalImpl || setInterval;

  const report = () => {
    try {
      log(formatMemoryLog(getMemoryUsage()));
    } catch (error) {
      console.error("[MEMORY] Unable to collect memory usage:", error?.message || error);
    }
  };

  // Log immediately, then periodically. The timer must never keep the process alive.
  report();
  const timer = setIntervalImpl(report, intervalMs);
  if (timer && typeof timer.unref === "function") timer.unref();
  return timer;
}

module.exports = { startMemoryMonitor, formatMemoryLog };
