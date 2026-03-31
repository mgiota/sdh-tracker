## ADDED Requirements

### Requirement: Normalize engineer names for matching
The sync SHALL normalize names before comparison by: lowercasing, and collapsing dots, dashes, underscores, and spaces into a single token (e.g. `kevin.delemme` → `kevindelemme`, `Kevin De Lemme` → `kevindelemme`).

#### Scenario: Slack dot-separated name matches DB spaced name
- **WHEN** Slack provides `kevin.delemme` and the DB has `Kevin De Lemme`
- **THEN** both normalize to `kevindelemme` and are considered the same engineer

#### Scenario: Names that are genuinely different
- **WHEN** two names normalize to different strings
- **THEN** they are not matched

### Requirement: Reuse existing engineer on match
When the sync encounters an engineer name from Slack, it SHALL first check for a normalized match against all existing engineers. If a match is found, the existing record SHALL be reused and no new engineer is created.

#### Scenario: Match found
- **WHEN** a Slack name normalizes to match an existing engineer
- **THEN** the existing engineer's ID is used; no INSERT occurs

### Requirement: Create engineer only when no match exists
The sync SHALL only INSERT a new engineer record when no normalized match is found among existing engineers.

#### Scenario: No match found
- **WHEN** a Slack name has no normalized match in the DB
- **THEN** a new engineer record is created with the name as provided by Slack
