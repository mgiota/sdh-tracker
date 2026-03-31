# SDH Tracker — Claude Code Context

## What this app is

A web app for the Elastic Observability team to manage SDH (Support Duty Help) rotations. Engineers rotate weekly on SDH duty, handling customer support GitHub issues. The app provides a single source of truth replacing scattered GitHub issues, Slack threads, and Google Docs.

## Tech stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS — runs on `http://localhost:5173`
- **Backend:** Node.js + Express + TypeScript — runs on `http://localhost:3001`
- **Database:** PostgreSQL 16 via Homebrew — `postgres://sdh:sdhpassword@localhost:5432/sdhtracker`
- **AI:** Claude CLI (already authenticated, no API key needed) — used for summaries, chat, schedule sync
- **Slack:** Claude CLI's Slack MCP (`mcp__claude_ai_Slack__*` tools) — no bot token needed

## How to run

```bash
# Start Postgres (runs in background via Homebrew)
brew services start postgresql@16

# Backend (terminal 1)
cd backend && npm run dev

# Frontend (terminal 2)
cd frontend && npm run dev
```

## Project structure

```
sdh-tracker/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Express app entry point
│   │   ├── db/
│   │   │   ├── client.ts               # Postgres pool + initDb
│   │   │   └── schema.sql              # Full DB schema
│   │   ├── routes/
│   │   │   ├── cases.ts                # All case endpoints + slack summarize
│   │   │   ├── chat.ts                 # SSE streaming chat with Claude CLI
│   │   │   ├── duty.ts                 # Duty week CRUD
│   │   │   ├── engineers.ts            # Engineer CRUD
│   │   │   ├── handovers.ts            # Handover pending endpoint
│   │   │   ├── reports.ts              # Weekly report generation + caching
│   │   │   ├── scan.ts                 # Slack scan for new SDH issues
│   │   │   └── scheduleSync.ts         # POST /api/schedule/sync
│   │   └── services/
│   │       ├── github.ts               # GitHub API — fetch issues + comments
│   │       ├── scheduleProvider.ts     # Slack/PagerDuty schedule abstraction
│   │       └── summarize.ts            # Claude CLI issue summarization
├── frontend/
│   └── src/
│       ├── App.tsx                     # Router, nav, engineer picker modal
│       ├── api.ts                      # All fetch calls to backend
│       ├── types.ts                    # TypeScript interfaces
│       └── pages/
│           ├── Dashboard.tsx           # Case list, import, scan button
│           ├── CaseDetail.tsx          # Full case view with tabs + AI chat
│           ├── Schedule.tsx            # Duty schedule + Slack sync
│           ├── Team.tsx                # Engineer management
│           └── Reports.tsx             # Weekly SDH report
```

## Key features built

- **Case management** — import GitHub issues by URL, auto-assign to duty engineer
- **AI summary** — auto-generated on import, regeneratable, stored in DB
- **GitHub thread** — renders issue body + comments inline with Elastic badge
- **Timeline tab** — internal notes, call outcomes, Slack links with icons
- **Slack tab** — linked threads with AI summary accordion (via Claude MCP)
- **Handover tab** — structured handover notes between engineers
- **AI chat** — streaming chat with full case context, reads GitHub/Slack URLs automatically
- **Scan for new SDHs** — reads DutyHelper messages from `actionable-obs-sdh` Slack channel, auto-imports new issues
- **Area→repo mapping** — `area_repo_mappings` table maps Elastic area labels to GitHub repos, Claude fallback for unknowns
- **Schedule sync** — reads duty schedule from Slack via Claude MCP, runs on startup + manual button
- **Weekly report** — AI narrative + structured sections, cached in DB, copy/download as markdown
- **Delete cases** — from dashboard (hover trash) and case detail page
- **Edit GitHub URL** — fix wrong repo if Claude inferred incorrectly

## Environment variables (backend/.env)

```
DATABASE_URL=postgres://sdh:sdhpassword@localhost:5432/sdhtracker
GITHUB_TOKEN=ghp_...              # Read-only, fine-grained for elastic/sdh-* repos
CLAUDE_PATH=/usr/local/bin/claude # Path to Claude CLI
SCHEDULE_PROVIDER=slack           # 'slack' or 'pagerduty' (pagerduty stub ready)
```

## Claude CLI usage pattern

All AI calls use `execSync` with prompt via stdin:

```typescript
const stdout = execSync(
  `${claudePath} --print --verbose --output-format text --allowedTools mcp__claude_ai_Slack__slack_read_thread,...`,
  { input: prompt, encoding: "utf8", timeout: 60_000, env: { ...process.env } }
) as string;
```

Chat uses streaming via `spawn` with `--output-format stream-json`.

---

## TODO list

### 1. Engineer sync — duplicate prevention
**Problem:** If an engineer is manually added on the Team page before Slack sync runs, the sync creates a duplicate (different ID, same name).

**Option A (recommended):** Slack sync should never auto-create engineers. Instead, flag unknown names as "pending" and show them on the Schedule page for a human to confirm or map to an existing engineer.

**Option B:** Keep auto-create but add a "Merge engineers" tool on the Team page to clean up duplicates.

**Option C:** Show a warning on the Team page: *"Engineers are auto-synced from Slack — manual adding may cause duplicates."* Recommend only using manual add for engineers who never appear in DutyHelper.

---

### 2. Similar cases feature
**Not built yet.** When on a case detail page, a button that searches all resolved cases for similar issues and shows ranked matches with explanation of similarity — powered by Claude comparing current issue against past ones.

**Suggested approach:** Send current case title + body + AI summary to Claude along with all resolved case summaries, ask it to rank by similarity and explain why.

---

### 3. PagerDuty schedule integration
**Status:** Stub exists in `scheduleProvider.ts`, ready to implement.

**What's needed:**
- `PAGERDUTY_API_KEY` — read-only API key from pagerduty.com → User Settings → API Access
- `PAGERDUTY_SCHEDULE_ID` — from the URL at pagerduty.com/schedules/XXXXXXX
- Set `SCHEDULE_PROVIDER=pagerduty` in `.env`
- Implement the ~20 lines in `PagerDutyScheduleProvider.getSchedule()` calling `GET https://api.pagerduty.com/oncalls?schedule_ids[]=scheduleId`

---

### 4. Area→repo mapping — expand the table
**Current entries:**
- `area::observability-alerting-metrics` → `elastic/sdh-kibana`
- `area::synthetics` → `elastic/sdh-synthetics`

**TODO:** Add more mappings as you encounter new area labels. Claude fallback infers the repo when mapping is missing, but explicit mappings are more reliable.

```sql
INSERT INTO area_repo_mappings (area_label, github_repo) VALUES
  ('area::your-label', 'elastic/sdh-yourrepo')
ON CONFLICT (area_label) DO NOTHING;
```

---

### 5. Team page — GitHub handle cleanup
Auto-created engineers from Slack sync have placeholder handles (`kevin.delemme` format). These should be updated with real GitHub handles so the "Elastic" badge shows correctly on GitHub thread comments.

---

### 6. Scan improvement — false positive filtering
The scan occasionally picks up non-SDH issues (e.g. "test issue" #267 was imported). Consider adding a filter — only import issues where DutyHelper explicitly assigns them to the current duty engineer, or issues with `urgency:` label.

## Scan — DutyHelper message format

The real DutyHelper message format in `actionable-obs-sdh`:

```
@panagiota.mitsopoulou!
I have assigned you the following SDH, as to my knowledge you are currently on duty for area::observability-alerting-custom_threshold:

:warning: urgency:24h #6164 - Customer threshold rules
```

Key parsing notes:
- Assignee is a `@mention` (not a plain name)
- The `area::label` appears on the second line (before the colon)
- Issue number and title are on the urgency line: `urgency:Xh #NUMBER - Title`
- Many different area labels exist — extract whatever appears, don't hardcode them
- The scan prompt searches for "I have assigned you the following SDH" to find these messages

---

### 7. Notification/reminder system
**Not built.** Ideas discussed:
- Cases in `pending_customer` for 3+ days with no update → nudge current owner
- End of week reminder to write handover notes
- Could use Slack MCP to post reminders to the channel

---

### 8. Google Docs integration
**Deferred.** Originally discussed as a data source but replaced by this app. Could still be useful for importing historical context from the team's existing SDH Google Doc.