/**
 * One-time migration: make github fields nullable, add slack_origin_url column.
 * Run once: npx ts-node scripts/migrate-slack-origin.ts
 */
import "dotenv/config";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`ALTER TABLE cases ALTER COLUMN github_url DROP NOT NULL`);
    console.log("✓ github_url is now nullable");

    await client.query(`ALTER TABLE cases ALTER COLUMN github_issue_num DROP NOT NULL`);
    console.log("✓ github_issue_num is now nullable");

    await client.query(`ALTER TABLE cases ALTER COLUMN github_repo DROP NOT NULL`);
    console.log("✓ github_repo is now nullable");

    await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS slack_origin_url TEXT`);
    console.log("✓ slack_origin_url column added");

    await client.query("COMMIT");
    console.log("\nMigration complete.");
  } catch (err: any) {
    await client.query("ROLLBACK");
    // If columns are already nullable, Postgres throws no error — but ALTER COLUMN on an
    // already-nullable column can throw "column is already nullable" in some drivers. Safe to ignore.
    if (err.message?.includes("already nullable") || err.message?.includes("does not exist")) {
      console.log("(already migrated, nothing to do)");
    } else {
      console.error("Migration failed:", err.message);
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
