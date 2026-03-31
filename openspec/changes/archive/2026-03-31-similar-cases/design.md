## Context

Cases in the DB have a title, body, and an AI-generated `ai_summary` (JSON string). Non-open cases (resolved, pending_customer, pending_internal) are the candidate pool. The team has a small number of cases so sending all summaries in a single Claude prompt is practical — no vector DB or embedding infrastructure needed.

## Goals / Non-Goals

**Goals:**
- Surface the top 3 most similar non-open cases for any given case
- Provide a 1-2 sentence explanation per result so engineers understand *why* it's similar
- Keep latency acceptable (one Claude CLI call, no streaming)

**Non-Goals:**
- Persisting similarity results (always computed fresh on demand)
- Similarity across open cases
- Semantic search / embeddings infrastructure

## Decisions

**Single Claude prompt with all summaries**
Send the current case + all non-open case summaries in one `execSync` call. For a team of ~10 engineers with weekly rotations, the candidate pool will stay small (dozens to low hundreds of cases). A single prompt is simple, reliable, and avoids multiple round-trips. Alternative considered: multiple calls scoring each candidate — rejected as slower and more complex for no benefit at this scale.

**Use `ai_summary` as the comparison signal, fallback to title + body snippet**
`ai_summary` is already structured and concise — ideal for comparison. If a case has no summary yet, fall back to title + first 500 chars of body to avoid skipping it entirely.

**Return raw JSON from Claude, parse on backend**
Claude is instructed to return a JSON array. The backend parses it and validates the IDs against the DB before returning to the client — prevents hallucinated IDs from leaking to the frontend.

**Endpoint on `cases.ts` as `POST /api/cases/:id/similar`**
POST rather than GET because the operation is expensive and non-idempotent in the sense that results change as cases accumulate. Consistent with other AI-powered endpoints in the codebase.

## Risks / Trade-offs

- **Slow response** (20-30s Claude call) → Frontend shows a clear loading state; the button is on-demand so it's acceptable
- **Hallucinated case IDs from Claude** → Backend validates all returned IDs against the DB before responding; invalid IDs are filtered out
- **No results when pool is empty** → Backend returns empty array; frontend shows friendly empty state

## Migration Plan

No DB changes. Deploy backend endpoint, then frontend changes. Fully additive — no existing behaviour changes.
