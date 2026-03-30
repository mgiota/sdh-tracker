import { Pool } from "pg";
import fs from "fs";
import path from "path";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb() {
  const schema = fs.readFileSync(
    path.join(__dirname, "schema.sql"),
    "utf8"
  );
  await pool.query(schema);
  console.log("DB schema applied");
}
