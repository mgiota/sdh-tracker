## ADDED Requirements

### Requirement: Identify duplicate engineers
The script SHALL find all groups of engineers in the `engineers` table that share the same name (case-insensitive).

#### Scenario: Duplicates found
- **WHEN** two or more engineers have the same name (case-insensitive)
- **THEN** they are grouped together for deduplication

#### Scenario: No duplicates found
- **WHEN** all engineer names are unique
- **THEN** the script exits with a message "No duplicates found" and makes no changes

### Requirement: Select canonical record
For each duplicate group, the script SHALL select one record as canonical using: most total foreign key references (cases.opened_by_id + cases.current_owner_id + duty_weeks.engineer_id combined), with ties broken by lowest ID.

#### Scenario: One engineer has more references
- **WHEN** one duplicate has more FK references than the others
- **THEN** that record is selected as canonical

#### Scenario: Tie in references
- **WHEN** two duplicates have the same number of FK references
- **THEN** the one with the lower (older) ID is selected as canonical

### Requirement: Reassign foreign keys
The script SHALL update all FK references pointing to non-canonical duplicates to point to the canonical record, across tables: `cases.opened_by_id`, `cases.current_owner_id`, `duty_weeks.engineer_id`.

#### Scenario: FK reassignment
- **WHEN** a case or duty week references a non-canonical duplicate
- **THEN** its FK is updated to reference the canonical engineer ID

### Requirement: Delete duplicate records
After FK reassignment, the script SHALL delete all non-canonical duplicate engineer records.

#### Scenario: Delete after reassignment
- **WHEN** all FKs have been reassigned away from a duplicate
- **THEN** the duplicate engineer record is deleted from the `engineers` table

### Requirement: Audit log
The script SHALL print a clear audit log describing every action taken (or that would be taken in dry-run mode), including: which engineers were merged, which record was kept as canonical, how many FKs were reassigned per table, and which records were deleted.

#### Scenario: Audit output
- **WHEN** the script runs (live or dry-run)
- **THEN** each merge group is printed with canonical ID, duplicate IDs, and FK counts

### Requirement: Dry-run mode
The script SHALL support a `--dry-run` CLI flag. In dry-run mode it prints the full audit log but makes no changes to the database.

#### Scenario: Dry-run flag provided
- **WHEN** the script is invoked with `--dry-run`
- **THEN** all planned actions are printed and no DB writes occur

#### Scenario: No dry-run flag
- **WHEN** the script is invoked without `--dry-run`
- **THEN** changes are applied inside a single DB transaction; on any error the transaction is rolled back

### Requirement: Atomic execution
All DB writes (FK updates + deletes) SHALL be wrapped in a single transaction so a partial failure leaves the DB unchanged.

#### Scenario: Error mid-execution
- **WHEN** an error occurs during FK reassignment or deletion
- **THEN** the entire transaction is rolled back and the DB is left in its original state
