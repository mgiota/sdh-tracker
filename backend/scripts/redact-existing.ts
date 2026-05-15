/**
 * One-time backfill: redact PII from all existing free-form text columns.
 *
 * Usage:
 *   npx ts-node scripts/redact-existing.ts            # dry-run (default)
 *   npx ts-node scripts/redact-existing.ts --apply    # actually write to DB
 */
import { Pool } from "pg";
import * as dotenv from "dotenv";
import { redact, redactDeep } from "../src/services/redact";

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DRY_RUN = !process.argv.includes("--apply");

if (DRY_RUN) {
  console.log("DRY RUN — no changes will be written. Pass --apply to persist.");
}

type ColumnSpec =
  | { table: string; idCol: string; col: string; type: "text" }
  | { table: string; idCol: string; col: string; type: "jsonb" };

const COLUMNS: ColumnSpec[] = [
  { table: "cases",           idCol: "id", col: "title",      type: "text" },
  { table: "cases",           idCol: "id", col: "body",       type: "text" },
  { table: "cases",           idCol: "id", col: "ai_summary", type: "text" },
  { table: "github_comments", idCol: "id", col: "body",       type: "text" },
  { table: "case_updates",    idCol: "id", col: "content",    type: "text" },
  { table: "case_updates",    idCol: "id", col: "metadata",   type: "jsonb" },
  { table: "slack_links",     idCol: "id", col: "description",type: "text" },
  { table: "slack_links",     idCol: "id", col: "ai_summary", type: "text" },
  { table: "handovers",       idCol: "id", col: "summary",    type: "text" },
  { table: "handovers",       idCol: "id", col: "next_steps", type: "text" },
  { table: "duty_weeks",      idCol: "id", col: "notes",      type: "text" },
  { table: "chat_messages",   idCol: "id", col: "content",    type: "text" },
  { table: "weekly_reports",  idCol: "id", col: "narrative",  type: "text" },
  { table: "weekly_reports",  idCol: "id", col: "markdown",   type: "text" },
  { table: "weekly_reports",  idCol: "id", col: "data",       type: "jsonb" },
];

async function backfillColumn(spec: ColumnSpec): Promise<void> {
  const { table, idCol, col, type } = spec;

  // Skip column if it doesn't exist in this DB (some tables were added via migration)
  const exists = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name=$1 AND column_name=$2`,
    [table, col]
  );
  if (!exists.rows.length) {
    console.log(`  SKIP  ${table}.${col} (column not found)`);
    return;
  }

  const { rows } = await pool.query(
    `SELECT ${idCol}, ${col} FROM ${table} WHERE ${col} IS NOT NULL`
  );

  let changed = 0;
  let unchanged = 0;

  for (const row of rows) {
    const original = row[col];
    let redacted: string | null;

    if (type === "jsonb") {
      const parsed = typeof original === "string" ? JSON.parse(original) : original;
      const cleaned = redactDeep(parsed);
      redacted = JSON.stringify(cleaned);
      if (redacted === JSON.stringify(parsed)) { unchanged++; continue; }
    } else {
      redacted = redact(original as string);
      if (redacted === original) { unchanged++; continue; }
    }

    changed++;
    if (!DRY_RUN) {
      await pool.query(
        `UPDATE ${table} SET ${col}=$1 WHERE ${idCol}=$2`,
        [redacted, row[idCol]]
      );
    }
  }

  console.log(`  ${table}.${col} — ${changed} changed, ${unchanged} unchanged${DRY_RUN ? " (dry run)" : ""}`);
}

async function main() {
  console.log("\nBackfilling PII redaction...\n");
  for (const spec of COLUMNS) {
    await backfillColumn(spec);
  }
  console.log("\nDone.");
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
