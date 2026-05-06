# SDH Tracker

A web app for the Elastic Observability team to manage **SDH (Support Duty Help)** rotations. Engineers rotate weekly on SDH duty, handling customer support GitHub issues. This app is the single source of truth, replacing scattered GitHub issues, Slack threads, and Google Docs.

## Features

- **Case management** — import GitHub issues by URL, auto-assigned to the duty engineer
- **AI summaries** — auto-generated on import, regeneratable, stored in DB
- **GitHub thread** — issue body + comments rendered inline with Elastic badges
- **Timeline, Slack, Handover tabs** — internal notes, call outcomes, linked Slack threads with AI summaries, structured handover notes
- **AI chat** — streaming chat with full case context, reads GitHub/Slack URLs automatically
- **Scan for new SDHs** — reads DutyHelper messages from `actionable-obs-sdh` Slack channel and auto-imports new issues
- **Schedule sync** — pulls duty schedule from Slack on startup and on demand
- **Weekly reports** — AI narrative + structured sections, cached per week, exportable as markdown
- **Similar cases** — find similar past cases (local DB or GitHub) ranked by Claude

## Prerequisites

You need all of these installed and working before starting the app.

### 1. Node.js 18+

```bash
node --version    # should be v18 or newer
```

If missing, install via [nvm](https://github.com/nvm-sh/nvm) or `brew install node`.

### 2. PostgreSQL 16

The app expects Postgres running locally on port `5432`.

```bash
brew install postgresql@16
brew services start postgresql@16
```

Create the database and user:

```bash
psql postgres <<SQL
CREATE USER sdh WITH PASSWORD 'sdhpassword';
CREATE DATABASE sdhtracker OWNER sdh;
GRANT ALL PRIVILEGES ON DATABASE sdhtracker TO sdh;
SQL
```

The schema is applied automatically on backend startup — no migrations to run.

### 3. Claude CLI (authenticated)

The app uses the Claude CLI for all AI calls (summaries, chat, schedule sync, scan). It must be installed **and** signed in to your Elastic Claude account, because the Slack integration goes through Claude's built-in Slack MCP.

Install: see [https://docs.claude.com/en/docs/claude-code/setup](https://docs.claude.com/en/docs/claude-code/setup).

Then sign in:

```bash
claude
# follow the browser flow to log into your Elastic Claude account
```

Verify the binary path:

```bash
which claude
# e.g. /usr/local/bin/claude  — put this in CLAUDE_PATH below
```

**Slack MCP:** the first time the app calls a Slack tool, Claude may prompt you to authorize the Slack MCP connection. Run any Claude command interactively first (e.g. `claude` and ask it to read a Slack channel) so the connection is approved before the backend starts using it.

### 4. GitHub token

Create a fine-grained personal access token with **read-only** access to the `elastic` repos you import issues from (typically `kibana`, `elasticsearch`, and the `sdh-*` repos). Token settings:

- **Repository access:** the repos you need
- **Permissions:** Issues = Read, Metadata = Read, Pull requests = Read

Save the token — you'll add it to `.env` in the next step.

## Setup

```bash
# 1. clone
git clone <repo-url> sdh-tracker
cd sdh-tracker

# 2. backend
cd backend
npm install
cp .env.example .env  # if present, otherwise create it (see below)

# 3. frontend
cd ../frontend
npm install
```

### Backend environment (`backend/.env`)

```env
DATABASE_URL=postgres://sdh:sdhpassword@localhost:5432/sdhtracker
GITHUB_TOKEN=ghp_your_token_here
CLAUDE_PATH=/usr/local/bin/claude
SCHEDULE_PROVIDER=slack
PORT=3001
```

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Local Postgres connection string. Match the user/db you created above. |
| `GITHUB_TOKEN` | Fine-grained read-only token (see above). |
| `CLAUDE_PATH` | Output of `which claude`. |
| `SCHEDULE_PROVIDER` | `slack` (default). `pagerduty` is stubbed but not implemented. |
| `PORT` | Backend port. Frontend expects `3001`. |

## Run

Open two terminals:

```bash
# terminal 1 — backend
cd backend
npm run dev
# → http://localhost:3001
```

```bash
# terminal 2 — frontend
cd frontend
npm run dev
# → http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser. On first load you'll be asked to pick your name from the engineer list — this is stored in `localStorage` and identifies you as the current user (no auth, internal tool).

## Verifying it works

1. **Backend health:** `curl http://localhost:3001/api/engineers` should return JSON.
2. **Schedule sync:** the backend logs `Schedule sync complete` shortly after startup. If you see Slack errors, run `claude` interactively first to approve the Slack MCP.
3. **Import a case:** paste a GitHub issue URL on the dashboard. After ~10s the AI summary should appear on the case detail page.
4. **AI chat:** open a case → Chat tab → ask "summarize this case." You should see a streaming response.

## Project structure

```
sdh-tracker/
├── backend/
│   ├── src/
│   │   ├── index.ts                # Express entry point
│   │   ├── db/                     # Postgres pool + schema
│   │   ├── routes/                 # cases, chat, duty, engineers, scan, reports, scheduleSync
│   │   └── services/               # github, scheduleProvider, summarize
│   └── scripts/dedup-engineers.ts  # cleanup utility (`npx ts-node scripts/dedup-engineers.ts --dry-run`)
└── frontend/
    └── src/
        ├── App.tsx                 # router + nav + engineer picker
        ├── api.ts                  # all backend fetch calls
        └── pages/                  # Dashboard, CaseDetail, Schedule, Team, Reports
```

For deeper context on **why** the app is built this way (Slack MCP vs bot, Claude CLI vs API, no auth, etc.) see [DECISIONS.md](DECISIONS.md). For ongoing development context see [CLAUDE.md](CLAUDE.md).

## Troubleshooting

**"connect ECONNREFUSED 127.0.0.1:5432"** — Postgres isn't running. `brew services start postgresql@16`.

**"role 'sdh' does not exist"** — you skipped the `CREATE USER` step in [Prerequisites](#2-postgresql-16).

**Schedule sync errors / empty schedule** — the Slack MCP isn't authorized for this Claude install. Run `claude` interactively, ask it to read a public channel, and approve the prompt.

**AI calls hang or time out** — confirm `claude --version` runs from your shell. The backend uses the `CLAUDE_PATH` from `.env`; if it's wrong, AI calls will silently fail.

**GitHub 404 on import** — your `GITHUB_TOKEN` doesn't have access to that repo. Add the repo to the token's repository access list.

**Port already in use** — change `PORT` in `backend/.env`, and update the proxy target in `frontend/vite.config.ts` to match.

## Limitations

- Desktop only (no mobile layout)
- No authentication — designed for a small trusted team
- Slack writes (posting back to threads) not implemented yet — see [CLAUDE.md](CLAUDE.md) TODOs
- PagerDuty schedule provider is stubbed
