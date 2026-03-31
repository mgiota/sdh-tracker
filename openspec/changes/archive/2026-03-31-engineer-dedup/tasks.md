## 1. Cleanup Script

- [x] 1.1 Create `backend/scripts/dedup-engineers.ts` and wire up DB pool from `../src/db/client`
- [x] 1.2 Query all engineers and group by lowercased name to find duplicate groups
- [x] 1.3 For each duplicate group, count FK references per engineer across `cases.opened_by_id`, `cases.current_owner_id`, and `duty_weeks.engineer_id` to determine canonical record
- [x] 1.4 Implement dry-run mode: print full audit log (canonical ID, duplicate IDs, FK counts per table) without writing to DB
- [x] 1.5 Implement live mode: wrap all FK UPDATE statements and DELETE statements in a single transaction, rollback on any error
- [x] 1.6 Print audit log in both modes confirming what was (or would be) done
- [x] 1.7 Run with `--dry-run`, review output, then run live to clean up existing duplicates

## 2. Fuzzy-Match Upsert in Schedule Sync

- [x] 2.1 Add a `normalizeEngineerName` helper in `scheduleSync.ts` that lowercases and strips dots/dashes/underscores/spaces
- [x] 2.2 Before any engineer INSERT in the sync, fetch all existing engineers and compare normalized names
- [x] 2.3 If a normalized match is found, reuse the existing engineer ID instead of inserting
- [x] 2.4 Only INSERT when no normalized match exists
- [x] 2.5 Manually trigger a schedule sync and verify no duplicate is created for an already-existing engineer
