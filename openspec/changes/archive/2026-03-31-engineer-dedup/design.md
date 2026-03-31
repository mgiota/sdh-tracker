## Context

The `engineers` table is the source of truth for SDH duty assignments. Engineers can be added manually via the Team page or auto-created by the schedule sync. When both happen for the same person, duplicate records accumulate. Foreign keys in `cases` and `duty_weeks` split across duplicates, making queries and the UI show inconsistent ownership. The team is ~10 engineers so the dataset is small, but duplicates cause real confusion on the dashboard.

## Goals / Non-Goals

**Goals:**
- Clean up existing duplicate engineer records safely, with no data loss
- Prevent new duplicates from being created by the schedule sync going forward
- Provide a dry-run mode so the cleanup can be previewed before execution

**Non-Goals:**
- Merging engineers with intentionally different names (e.g. different people who share a first name)
- UI for managing duplicates (script is sufficient for a one-off + the fuzzy match prevents recurrence)
- Changing how engineers are manually added on the Team page

## Decisions

**Canonical record selection: most cases assigned, fallback to oldest ID**
When deduplicating a group, we pick the record that has the most foreign key references (cases + duty_weeks combined). This preserves the record the app has been actively using. Ties broken by lowest ID (oldest record). Alternative considered: always prefer the manually-added record — rejected because we can't reliably distinguish manual vs sync-created records.

**Fuzzy match strategy: lowercase + dot/space/dash normalization**
Slack names come in as `kevin.delemme`; manually-added names may be `Kevin De Lemme`. Normalize both sides by lowercasing and collapsing `.`, `-`, `_`, and spaces before comparing. Exact match after normalization = same person. Alternative considered: Levenshtein distance — overkill for a 10-person team where names are either an exact normalized match or clearly different.

**Script location: `backend/scripts/dedup-engineers.ts`**
Run via `npx ts-node` from the backend directory. Reuses the existing `pool` from `db/client.ts` so no new DB connection setup needed. Alternative: standalone SQL script — rejected because we need conditional logic (picking canonical, reassigning FKs) that's cleaner in TypeScript.

**No transaction rollback on partial failure**
The script wraps the entire operation in a single DB transaction. If any step fails, the whole thing rolls back automatically. Dry-run bypasses this and just prints what would happen.

## Risks / Trade-offs

- **False positive fuzzy match** → Two different engineers with similar normalized names get merged. Mitigation: dry-run output must be reviewed before live run; team is small enough to spot this manually.
- **Script is one-shot** → If new duplicates appear before the sync fix ships, re-run the script. It's idempotent (won't touch records that aren't duplicates).

## Migration Plan

1. Run `npx ts-node scripts/dedup-engineers.ts --dry-run` and review output
2. Run `npx ts-node scripts/dedup-engineers.ts` to apply
3. Deploy the updated `scheduleSync.ts` with fuzzy-match upsert
4. No rollback needed — the sync change is additive (still creates engineers, just smarter about when)
