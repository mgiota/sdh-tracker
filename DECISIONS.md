# SDH Tracker — Design Decisions

## Why no Docker for backend?
We started with Docker Compose but moved the backend to run locally because Claude CLI needs to be installed and authenticated on the host machine to use Slack MCP. The CLI can't easily run inside a Docker container without mounting credentials. Database and frontend still run in Docker if needed, but currently everything runs locally via Homebrew + npm.

## Why Slack MCP instead of a Slack bot token?
The Elastic workspace requires admin approval to install Slack apps. Rather than wait for approval, we use Claude CLI's built-in Slack MCP connection (already authenticated via claude.ai). This gives read access to channels and threads without any token setup. The tradeoff is that AI calls are slightly slower since they go through Claude CLI.

If a Slack bot token becomes available later, the code can be updated to call the Slack API directly — but the MCP approach works well enough and requires zero infrastructure.

## Why execSync for AI calls instead of streaming everywhere?
Most AI calls (summarization, schedule sync, scan) use `execSync` with stdin because they're one-shot requests where we wait for the full response. Only the chat endpoint uses `spawn` with SSE streaming because the user needs to see the response word-by-word. `execSync` is simpler and more reliable for non-interactive calls.

## Why Claude CLI instead of Anthropic API directly?
The team is on an Elastic Enterprise Claude plan. Claude CLI is already authenticated — no API key management needed. The colleague who built kibana-manager used the same approach. If an API key becomes available later, `summarize.ts` already has the structure to swap it in.

## Why store AI summaries as JSON strings in TEXT columns?
Simpler than adding JSONB columns for each summary type. The summaries are always parsed on read, so the storage format doesn't matter for queries. If we need to query summary fields later, we can migrate to JSONB.

## Why localStorage for current engineer identity?
The app is an internal tool for a trusted team of ~10 engineers. Full auth adds complexity with no real security benefit. Each engineer picks their name on first visit and it's stored in localStorage. No passwords, no sessions.

## Why Slack sync on startup?
The schedule needs to be fresh when engineers start their day. Running on startup means the dashboard always shows accurate duty info without requiring a manual sync. The sync is non-blocking (fire-and-forget) so it doesn't slow down startup.

## Why keep manual GitHub URL import alongside Slack scan?
The Slack scan covers the main workflow (DutyHelper assignments), but engineers sometimes need to import:
- Related issues from other repos for reference
- Historical issues not in DutyHelper messages
- Issues from other teams they're helping with

Both inputs are valuable and complementary.

## Why area→repo mapping table instead of hardcoding?
Elastic has many area labels and they change over time. A DB table means new mappings can be added without code changes — just a SQL INSERT. Claude fallback handles unknown labels automatically, and the inferred mapping gets saved for next time.

## Why weekly reports are cached?
Generating a report takes 20-30 seconds (Claude CLI call). Caching means subsequent views are instant. Engineers can regenerate when needed (end of week, after new cases are resolved). The cache is per week_start date so each week's report is independent.

## What was deliberately not built
- **Google Docs integration** — replaced by this app itself
- **Full Slack message fetching** (showing thread inline) — Claude MCP reads threads on demand via chat, which is more useful than storing raw messages
- **Authentication** — internal tool, trusted team, localStorage identity is sufficient
- **Mobile layout** — engineers use this on desktop during work hours