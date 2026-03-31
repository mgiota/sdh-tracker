## 1. Backend Endpoint

- [x] 1.1 Add `SimilarCase` type to `backend/src/routes/cases.ts` (or a shared types file): `{ id: number; title: string; github_url: string; status: string; similarity_explanation: string }`
- [x] 1.2 Add `POST /api/cases/:id/similar` route handler in `cases.ts` — fetch the current case, return 404 if not found
- [x] 1.3 Query all non-open cases (status IN resolved, pending_customer, pending_internal) excluding the current case ID
- [x] 1.4 For each candidate, build comparison text: use `ai_summary` if present, else title + first 500 chars of body
- [x] 1.5 Build Claude prompt with current case context and all candidate summaries, ask for top 3 ranked by similarity with explanation, request JSON array output
- [x] 1.6 Call Claude CLI via `execSync` with `--print --output-format text`, timeout 90s
- [x] 1.7 Parse Claude's JSON response, validate returned IDs exist in the candidate pool, filter out any invalid IDs
- [x] 1.8 Return the validated results array (empty array if none)

## 2. Frontend

- [x] 2.1 Add `SimilarCase` type to `frontend/src/types.ts`
- [x] 2.2 Add `getSimilarCases(caseId: number)` to `frontend/src/api.ts`
- [x] 2.3 Add `findingSimilar` loading state and `similarCases` / `showSimilarModal` state to `CaseDetail.tsx`
- [x] 2.4 Add "Find similar cases" button next to existing action buttons in `CaseDetail.tsx`, disabled + "Searching…" when loading
- [x] 2.5 Implement the similar cases modal: title, list of results (title link, status badge, explanation), empty state, close button and backdrop dismiss
- [x] 2.6 Wire up title link in modal to navigate to the case detail page and close the modal

## Post-archive additions

The following was built after archiving, extending the original spec:

- Added `source: "local" | "github"` param to the endpoint and `SimilarCase` type — backend searches GitHub API (via `area_repo_mappings` repos) when source is "github", using Claude to rank results
- Added radio toggle (Imported / GitHub) next to the "Find similar cases" button in the UI
- Added "Analyze similar past cases and suggest applicable solutions" suggestion to the AI chat; fetches both local and GitHub similar cases in parallel and sends combined results to Claude for pattern analysis and actionable suggestions
