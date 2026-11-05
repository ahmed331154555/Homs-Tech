const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Avoid keeping stale idle connections around when the managed database
  // briefly restarts or drops an idle socket.
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  ssl:
    process.env.DATABASE_URL &&
    !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,
});

pool.on("error", (error) => {
  console.error("Unexpected idle PostgreSQL client error:", error.message);
});

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function queryWithConnectionRetry(sql, params, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await pool.query(sql, params);
    } catch (error) {
      lastError = error;
      const retryable = [
        "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
        "57P01", "57P02", "57P03", "08000", "08003", "08006"
      ].includes(error?.code) ||
        /connection terminated unexpectedly|connection closed|connection timeout|socket disconnected before secure TLS/i.test(String(error?.message || ""));
      if (!retryable || attempt === attempts) throw error;
      console.warn(`PostgreSQL connection failed during query (attempt ${attempt}/${attempts}); retrying after transient connection error.`);
      await wait(Math.min(1000 * attempt, 5000));
    }
  }
  throw lastError;
}

module.exports = { pool, wait, queryWithConnectionRetry };
