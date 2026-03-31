/**
 * dedup-engineers.ts
 *
 * Finds duplicate engineer records (same name, case-insensitive), picks a
 * canonical record per group (most FK references → fallback to lowest ID),
 * reassigns all foreign keys to the canonical, then deletes the duplicates.
 *
 * Usage:
 *   npx ts-node scripts/dedup-engineers.ts            # live run
 *   npx ts-node scripts/dedup-engineers.ts --dry-run  # preview only
 */

import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(__dirname, "../.env") });

import { pool } from "../src/db/client";

const DRY_RUN = process.argv.includes("--dry-run");

interface Engineer {
  id: number;
  name: string;
  github_handle: string;
}

interface FKCounts {
  opened_by:    number;
  current_owner: number;
  duty_weeks:   number;
  case_updates: number;
  slack_links:  number;
  handovers_from: number;
  handovers_to:   number;
  total: number;
}

async function getFKCounts(engineerId: number): Promise<FKCounts> {
  const [ob, co, dw, cu, sl, hf, ht] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS n FROM cases       WHERE opened_by_id    = $1", [engineerId]),
    pool.query("SELECT COUNT(*)::int AS n FROM cases       WHERE current_owner_id = $1", [engineerId]),
    pool.query("SELECT COUNT(*)::int AS n FROM duty_weeks  WHERE engineer_id      = $1", [engineerId]),
    pool.query("SELECT COUNT(*)::int AS n FROM case_updates WHERE engineer_id     = $1", [engineerId]),
    pool.query("SELECT COUNT(*)::int AS n FROM slack_links  WHERE added_by_id     = $1", [engineerId]),
    pool.query("SELECT COUNT(*)::int AS n FROM handovers    WHERE from_engineer_id = $1", [engineerId]),
    pool.query("SELECT COUNT(*)::int AS n FROM handovers    WHERE to_engineer_id   = $1", [engineerId]),
  ]);
  const opened_by     = ob.rows[0].n;
  const current_owner = co.rows[0].n;
  const duty_weeks    = dw.rows[0].n;
  const case_updates  = cu.rows[0].n;
  const slack_links   = sl.rows[0].n;
  const handovers_from = hf.rows[0].n;
  const handovers_to   = ht.rows[0].n;
  return {
    opened_by, current_owner, duty_weeks, case_updates,
    slack_links, handovers_from, handovers_to,
    total: opened_by + current_owner + duty_weeks + case_updates +
           slack_links + handovers_from + handovers_to,
  };
}

async function main() {
  console.log(`\n🔍 Engineer dedup script — ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE RUN"}\n`);

  // Find all duplicate name groups
  const { rows: dupGroups } = await pool.query<{ lower_name: string; ids: number[] }>(`
    SELECT LOWER(name) AS lower_name, ARRAY_AGG(id ORDER BY id) AS ids
    FROM engineers
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  `);

  if (dupGroups.length === 0) {
    console.log("✅ No duplicate engineers found. Nothing to do.");
    await pool.end();
    return;
  }

  console.log(`Found ${dupGroups.length} duplicate group(s):\n`);

  // Build list of merge operations
  type MergeOp = {
    canonicalId: number;
    duplicateIds: number[];
    counts: Map<number, FKCounts>;
    name: string;
  };

  const ops: MergeOp[] = [];

  for (const group of dupGroups) {
    const { rows: engineers } = await pool.query<Engineer>(
      "SELECT id, name, github_handle FROM engineers WHERE id = ANY($1) ORDER BY id",
      [group.ids]
    );

    // Count FK references for each engineer in the group
    const counts = new Map<number, FKCounts>();
    for (const eng of engineers) {
      counts.set(eng.id, await getFKCounts(eng.id));
    }

    // Pick canonical: most total refs, ties broken by lowest id
    const canonical = engineers.reduce((best, eng) => {
      const bestCount = counts.get(best.id)!.total;
      const engCount  = counts.get(eng.id)!.total;
      if (engCount > bestCount) return eng;
      if (engCount === bestCount && eng.id < best.id) return eng;
      return best;
    });

    const duplicates = engineers.filter(e => e.id !== canonical.id);

    ops.push({
      canonicalId:  canonical.id,
      duplicateIds: duplicates.map(d => d.id),
      counts,
      name: canonical.name,
    });

    // Print audit for this group
    console.log(`  Group: "${canonical.name}"`);
    for (const eng of engineers) {
      const c = counts.get(eng.id)!;
      const marker = eng.id === canonical.id ? "✓ KEEP" : "✗ MERGE";
      console.log(`    [${marker}] id=${eng.id} handle=${eng.github_handle}`);
      console.log(`             refs: opened_by=${c.opened_by} owner=${c.current_owner} duty_weeks=${c.duty_weeks} updates=${c.case_updates} slack=${c.slack_links} handovers=${c.handovers_from + c.handovers_to} (total=${c.total})`);
    }
    console.log(`    → Reassign all refs from [${duplicates.map(d => d.id).join(", ")}] → ${canonical.id}, then delete duplicates\n`);
  }

  if (DRY_RUN) {
    console.log("DRY RUN — no changes made. Remove --dry-run to apply.");
    await pool.end();
    return;
  }

  // Live run — execute in a single transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const op of ops) {
      for (const dupId of op.duplicateIds) {
        await client.query("UPDATE cases        SET opened_by_id     = $1 WHERE opened_by_id     = $2", [op.canonicalId, dupId]);
        await client.query("UPDATE cases        SET current_owner_id = $1 WHERE current_owner_id = $2", [op.canonicalId, dupId]);
        await client.query("UPDATE duty_weeks   SET engineer_id      = $1 WHERE engineer_id      = $2", [op.canonicalId, dupId]);
        await client.query("UPDATE case_updates SET engineer_id      = $1 WHERE engineer_id      = $2", [op.canonicalId, dupId]);
        await client.query("UPDATE slack_links  SET added_by_id      = $1 WHERE added_by_id      = $2", [op.canonicalId, dupId]);
        await client.query("UPDATE handovers    SET from_engineer_id = $1 WHERE from_engineer_id = $2", [op.canonicalId, dupId]);
        await client.query("UPDATE handovers    SET to_engineer_id   = $1 WHERE to_engineer_id   = $2", [op.canonicalId, dupId]);
        await client.query("DELETE FROM engineers WHERE id = $1", [dupId]);
        console.log(`  ✓ Merged engineer id=${dupId} → ${op.canonicalId} ("${op.name}") and deleted`);
      }
    }

    await client.query("COMMIT");
    console.log("\n✅ Done. All duplicates merged and deleted.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n❌ Error — transaction rolled back. DB unchanged.", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
