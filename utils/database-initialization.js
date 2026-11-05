"use strict";

async function initializeDatabaseWithRetry(initDatabase, wait, maxAttempts = 12, logError = console.error) {
  if (typeof initDatabase !== "function" || typeof wait !== "function") {
    throw new TypeError("Database initializer and wait functions are required.");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer.");
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDatabase();
      return;
    } catch (error) {
      lastError = error;
      logError(`Database initialization attempt ${attempt}/${maxAttempts} failed:`, error?.message || error);
      if (attempt < maxAttempts) {
        await wait(Math.min(2000 * attempt, 10000));
      }
    }
  }
  throw lastError;
}

module.exports = { initializeDatabaseWithRetry };
