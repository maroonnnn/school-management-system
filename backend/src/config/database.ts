
import pg, { Pool } from "pg";
import "dotenv/config";

// Return DATE columns as plain "YYYY-MM-DD" strings. Otherwise pg builds a local-midnight JS Date
// that serializes to the previous day in UTC (off-by-one dates in the UI).
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

pool.on("connect", () => {
  console.log("PostgreSQL client connected");
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error);
});

export default pool;
