## ADDED Requirements

### Requirement: Find similar cases endpoint
The system SHALL expose `POST /api/cases/:id/similar` that returns up to 3 similar non-open cases for the given case ID.

#### Scenario: Successful response
- **WHEN** a valid case ID is provided
- **THEN** the endpoint returns an array of up to 3 objects with `id`, `title`, `github_url`, `status`, and `similarity_explanation`

#### Scenario: Case not found
- **WHEN** the case ID does not exist in the DB
- **THEN** the endpoint returns HTTP 404

### Requirement: Candidate pool
The endpoint SHALL query all non-open cases (status: resolved, pending_customer, pending_internal) excluding the current case as candidates for similarity comparison.

#### Scenario: Exclude current case
- **WHEN** building the candidate pool
- **THEN** the current case is never included in results

#### Scenario: Empty candidate pool
- **WHEN** no non-open cases exist (excluding current)
- **THEN** the endpoint returns an empty array

### Requirement: Summary as comparison signal
For each candidate, the endpoint SHALL use `ai_summary` as the comparison text if available, falling back to title + first 500 characters of body if `ai_summary` is null.

#### Scenario: Case has ai_summary
- **WHEN** a candidate has a non-null `ai_summary`
- **THEN** the summary text is used in the Claude prompt

#### Scenario: Case has no ai_summary
- **WHEN** a candidate has a null `ai_summary`
- **THEN** title + first 500 chars of body is used instead

### Requirement: Claude ranks similarity
The endpoint SHALL send the current case and all candidate summaries to Claude CLI in a single call, asking it to return the top 3 most similar cases as a JSON array with a `similarity_explanation` per result.

#### Scenario: Claude returns valid results
- **WHEN** Claude returns a valid JSON array with case IDs
- **THEN** each ID is validated against the DB before including in the response

#### Scenario: Claude returns hallucinated IDs
- **WHEN** Claude returns an ID that does not exist in the candidate pool
- **THEN** that result is silently filtered out

#### Scenario: Claude returns fewer than 3
- **WHEN** the candidate pool has fewer than 3 cases or Claude ranks fewer
- **THEN** only the available results are returned (no error)
