## Why

When working on a support case, engineers have no way to know if a similar issue was handled before — institutional knowledge is lost and the same debugging steps get repeated. Adding a "Find similar cases" button surfaces relevant past cases instantly using Claude to rank and explain similarities.

## What Changes

- New backend endpoint `POST /api/cases/:id/similar` that queries non-open cases and asks Claude to rank the top 3 most similar to the current case
- New "Find similar cases" button on the case detail page
- Modal displaying the top 3 results with title, status badge, and Claude's similarity explanation

## Capabilities

### New Capabilities
- `similar-cases-endpoint`: Backend endpoint that fetches candidate cases, builds a Claude prompt, and returns ranked similar cases with explanations
- `similar-cases-ui`: Frontend button + modal on the case detail page showing the ranked results

### Modified Capabilities

## Impact

- `backend/src/routes/cases.ts` — new endpoint added
- `frontend/src/pages/CaseDetail.tsx` — button and modal added
- `frontend/src/api.ts` — new `getSimilarCases` function
- `frontend/src/types.ts` — new `SimilarCase` type
- No DB schema changes required
- No new dependencies required
