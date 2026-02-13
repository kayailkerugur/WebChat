const { Pool } = require("pg");
const env = require("../config/env");

const pool = new Pool({
  connectionString: env.databaseUrl,
});

pool.on("connect", () => {
  console.log("🟢 PostgreSQL connected");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err);
});

async function healthcheck() {
  const result = await pool.query("select 1 as ok");
  return result.rows[0]?.ok === 1;
}

module.exports = { pool, healthcheck };