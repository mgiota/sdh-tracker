## Why

The Slack schedule sync blindly creates new engineer records whenever it sees an unknown name, causing duplicates when an engineer was already manually added. The DB already has duplicates with split foreign keys across cases and duty weeks, and the problem compounds every sync cycle.

## What Changes

- New script `backend/scripts/dedup-engineers.ts` to clean up existing duplicates in the DB
- Script supports `--dry-run` flag to preview changes without touching the DB
- Schedule sync updated to fuzzy-match engineer names before creating new records
- No new engineers created when a sufficiently close match already exists in the DB

## Capabilities

### New Capabilities
- `engineer-dedup-script`: One-off cleanup script that finds duplicate engineers, picks a canonical record (most cases assigned, fallback to oldest ID), reassigns all foreign keys (cases.opened_by_id, cases.current_owner_id, duty_weeks.engineer_id), deletes duplicates, and prints an audit log. Supports `--dry-run`.
- `engineer-fuzzy-match`: Fuzzy name matching in the schedule sync — when a Slack name comes in, match it case-insensitively against existing engineers before creating a new record. Only create when no match found.

### Modified Capabilities

## Impact

- `backend/src/routes/scheduleSync.ts` — engineer upsert logic changes
- `backend/scripts/dedup-engineers.ts` — new file
- Tables affected: `engineers`, `cases` (opened_by_id, current_owner_id), `duty_weeks` (engineer_id)
- No API or frontend changes required
