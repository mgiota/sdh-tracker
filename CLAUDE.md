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
- **Engineer dedup script** — `backend/scripts/dedup-engineers.ts` cleans up duplicate engineer records, supports `--dry-run`
- **Engineer fuzzy-match sync** — schedule sync normalizes names before creating engineers, preventing duplicates from Slack name format differences
- **Similar cases** — "Find similar cases" button on case detail page; searches imported non-open cases or GitHub issues (radio toggle), Claude ranks top 3 with similarity explanation; local results navigate to case detail, GitHub results open in new tab
- **AI similar cases analysis** — "Analyze similar past cases and suggest applicable solutions" suggestion in AI chat; fetches top 3 from both imported cases and GitHub in parallel, sends combined results to Claude with labels, Claude responds with pattern analysis and actionable suggestions

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

### 1. PagerDuty schedule integration
**Status:** Stub exists in `scheduleProvider.ts`, ready to implement.

**What's needed:**
- `PAGERDUTY_API_KEY` — read-only API key from pagerduty.com → User Settings → API Access
- `PAGERDUTY_SCHEDULE_ID` — from the URL at pagerduty.com/schedules/XXXXXXX
- Set `SCHEDULE_PROVIDER=pagerduty` in `.env`
- Implement the ~20 lines in `PagerDutyScheduleProvider.getSchedule()` calling `GET https://api.pagerduty.com/oncalls?schedule_ids[]=scheduleId`

---

### 2. Scan improvement — false positive filtering
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

### 3. Bidirectional Slack flow — post updates back to threads
**Not built yet.** When an engineer picks up an issue in the app, post back to the original DutyHelper thread in `actionable-obs-sdh` to acknowledge it.

**Suggested flow:**
- Engineer clicks "Acknowledge" (or status changes from `open`) → post to Slack thread: "👀 @name is looking at this"
- AI summary gets posted as a follow-up comment in the same thread so teammates have instant context
- Optionally: post on status changes (pending customer, resolved)

**Implementation notes:**
- Use `mcp__claude_ai_Slack__slack_send_message` via Claude CLI — the tool exists in the MCP but hasn't been used for writes yet
- Posts will appear as the Claude AI Slack identity, not the engineer's own account — consider mentioning the engineer by name in the message body
- Need to store the Slack thread `ts` (timestamp) when scanning so we can reply to the right thread. Currently the scan doesn't capture the thread ts — that's the first thing to add.
- New backend endpoint: `POST /api/cases/:id/acknowledge` — triggers the Slack post + sets status

---

### 4. Notification/reminder system
**Not built.** Ideas discussed:
- Cases in `pending_customer` for 3+ days with no update → nudge current owner
- End of week reminder to write handover notes
- Could use Slack MCP to post reminders to the channel

---

### 5. Google Docs integration
**Deferred.** Originally discussed as a data source but replaced by this app. Could still be useful for importing historical context from the team's existing SDH Google Doc.