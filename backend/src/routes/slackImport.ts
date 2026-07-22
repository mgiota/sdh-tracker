import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import { pool } from "../db/client";
import { parseIssueUrl, fetchIssue, fetchComments, isElasticMember } from "../services/github";
import { summarizeIssue } from "../services/summarize";
import { SLACK_READ_TOOLS, CLAUDE_MODEL, looksLikePermissionDenial } from "../services/claudeUtils";
import { redact } from "../services/redact";

const router = Router();

// ── POST /api/cases/import-slack ──────────────────────────────────────────────
// Start a case investigation from a Slack thread URL.
// - Reads the thread via Claude CLI + Slack MCP
// - Extracts title, description, any GitHub issue URL mentioned
// - Creates a case (github fields are optional)
// - Auto-links the Slack thread to the case
// - Auto-summarizes (non-blocking)
router.post("/import-slack", async (req: Request, res: Response) => {
  const { slack_url, engineer_id } = req.body;
  if (!slack_url?.trim()) return res.status(400).json({ error: "slack_url required" });

  const claudePath = process.env.CLAUDE_PATH || "claude";

  // ── Step 1: Read the Slack thread ─────────────────────────────────────────
  const readPrompt = `Read the following Slack thread URL and extract its content:
${slack_url}

From the thread, extract:
1. A concise title (max 100 chars) describing the issue/topic being discussed
2. A brief description/body (plain text, 2-5 sentences summarising what the thread is about)
3. Any GitHub issue URLs mentioned (look for github.com/*/issues/* patterns)
4. The name or handle of the person who started the thread (the first message author)

Return ONLY valid JSON, no markdown, no preamble:
{
  "title": "Short descriptive title",
  "body": "2-5 sentence description of what the thread is about",
  "github_url": "https://github.com/org/repo/issues/123 or null if none found",
  "thread_author": "name or handle or null"
}`;

  let threadData: {
    title: string;
    body: string;
    github_url: string | null;
    thread_author: string | null;
  };

  try {
    const stdout = execSync(
      `${claudePath} --model ${CLAUDE_MODEL} --print --verbose --output-format text --allowedTools ${SLACK_READ_TOOLS}`,
      {
        input: readPrompt,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env },
      }
    ) as string;

    const clean = redact(stdout.replace(/```json|```/g, "").trim());
    console.log("[import-slack] Claude raw output:", clean.slice(0, 1000));

    if (looksLikePermissionDenial(clean)) {
      return res.status(403).json({
        error: "Slack MCP permission denied. Confirm Slack is connected via `claude mcp list`.",
      });
    }

    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(422).json({ error: "Could not parse thread content from Claude response." });
    }
    threadData = JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    const detail = err.stderr?.toString().trim() || err.message;
    console.error("[import-slack] Claude CLI error:", detail);
    return res.status(500).json({ error: `Failed to read Slack thread: ${detail}` });
  }

  const { title, body, github_url: ghUrl, thread_author } = threadData;
  if (!title) return res.status(422).json({ error: "Could not extract a title from the Slack thread." });

  // ── Step 2: Check for existing case (by slack_origin_url or github_url) ──
  const existingBySlack = await pool.query(
    "SELECT id FROM cases WHERE slack_origin_url = $1",
    [slack_url]
  );
  if (existingBySlack.rows.length) {
    return res.status(409).json({
      error: "Case already imported from this Slack thread",
      case_id: existingBySlack.rows[0].id,
    });
  }

  // ── Step 3: Optionally fetch GitHub issue ─────────────────────────────────
  let githubData: {
    github_url: string;
    github_issue_num: number;
    github_repo: string;
    title: string;
    body: string;
    github_author: string;
    github_labels: string[];
    comments: any[];
  } | null = null;

  if (ghUrl) {
    try {
      const parsed = parseIssueUrl(ghUrl);
      const { owner, repo, number } = parsed;

      // If this github URL is already a case, just return that existing case
      const existingByGh = await pool.query("SELECT id FROM cases WHERE github_url = $1", [ghUrl]);
      if (existingByGh.rows.length) {
        // Link the Slack thread to the existing case and return it
        const existingId = existingByGh.rows[0].id;
        await linkSlackThread(existingId, slack_url, "Originating Slack thread", engineer_id);
        // Update slack_origin_url if not set
        await pool.query(
          "UPDATE cases SET slack_origin_url = $1 WHERE id = $2 AND slack_origin_url IS NULL",
          [slack_url, existingId]
        );
        const { rows } = await pool.query(
          `SELECT c.*, e.name AS owner_name, e.github_handle AS owner_handle
           FROM cases c LEFT JOIN engineers e ON e.id = c.current_owner_id
           WHERE c.id = $1`,
          [existingId]
        );
        return res.status(200).json({ ...rows[0], _linked_existing: true });
      }

      const issue = await fetchIssue(owner, repo, number);
      const comments = await fetchComments(owner, repo, number);
      githubData = {
        github_url: ghUrl,
        github_issue_num: number,
        github_repo: `${owner}/${repo}`,
        title: issue.title,
        body: issue.body ?? "",
        github_author: issue.user.login,
        github_labels: issue.labels.map((l: any) => l.name),
        comments,
      };
    } catch (err: any) {
      console.warn("[import-slack] GitHub fetch failed (proceeding without):", err.message);
      // Non-fatal — continue with Slack-only case
    }
  }

  // ── Step 4: Find owner (duty engineer or provided engineer) ───────────────
  const dutyEng = await pool.query(
    `SELECT engineer_id FROM duty_weeks
     WHERE week_start <= CURRENT_DATE AND week_end >= CURRENT_DATE
     LIMIT 1`
  );
  const ownerId = dutyEng.rows.length
    ? dutyEng.rows[0].engineer_id
    : (engineer_id ?? null);

  // ── Step 5: Insert case ───────────────────────────────────────────────────
  const caseTitle  = githubData?.title ?? title;
  const caseBody   = githubData?.body ?? body ?? "";
  const ghUrl_     = githubData?.github_url ?? null;
  const ghNum      = githubData?.github_issue_num ?? null;
  const ghRepo     = githubData?.github_repo ?? null;
  const ghAuthor   = githubData?.github_author ?? thread_author ?? null;
  const ghLabels   = githubData?.github_labels ?? [];

  const { rows } = await pool.query(
    `INSERT INTO cases
      (github_url, github_issue_num, github_repo, slack_origin_url,
       title, body, status, github_author, github_labels,
       opened_by_id, current_owner_id)
     VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10)
     RETURNING *`,
    [ghUrl_, ghNum, ghRepo, slack_url,
     caseTitle, caseBody, ghAuthor, ghLabels,
     engineer_id ?? null, ownerId]
  );
  const caseId = rows[0].id;

  // ── Step 6: Persist GitHub comments (if any) ─────────────────────────────
  if (githubData?.comments) {
    for (const c of githubData.comments) {
      const elastic = await isElasticMember(c.user.login).catch(() => false);
      await pool.query(
        `INSERT INTO github_comments (case_id, github_id, author, body, is_elastic, posted_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (github_id) DO NOTHING`,
        [caseId, c.id, c.user.login, c.body, elastic, c.created_at]
      );
    }
  }

  // ── Step 7: Link originating Slack thread ────────────────────────────────
  await linkSlackThread(caseId, slack_url, "Originating Slack thread", engineer_id);

  // ── Step 8: Auto-summarize (non-blocking) ────────────────────────────────
  const summaryTitle    = githubData?.title ?? title;
  const summaryBody     = githubData?.body ?? body ?? "";
  const summaryComments = (githubData?.comments ?? []).map((c: any) => ({
    author: c.user?.login ?? "unknown",
    body: c.body,
    is_elastic: false,
    posted_at: c.created_at,
  }));

  summarizeIssue(summaryTitle, summaryBody, summaryComments)
    .then(async s => {
      await pool.query(
        "UPDATE cases SET ai_summary=$1, ai_summary_at=NOW() WHERE id=$2",
        [JSON.stringify(s), caseId]
      );
    })
    .catch(err => console.error("[import-slack] Summary generation failed:", err));

  // ── Step 9: Log import note ───────────────────────────────────────────────
  if (engineer_id) {
    await pool.query(
      `INSERT INTO case_updates (case_id, engineer_id, update_type, content)
       VALUES ($1,$2,'note',$3)`,
      [caseId, engineer_id, `Investigation started from Slack thread: ${slack_url}`]
    );
  }

  res.status(201).json(rows[0]);
});

// ── Helper ─────────────────────────────────────────────────────────────────
async function linkSlackThread(
  caseId: number,
  url: string,
  description: string,
  engineer_id?: number
) {
  // Check if already linked
  const existing = await pool.query(
    "SELECT id FROM slack_links WHERE case_id=$1 AND url=$2",
    [caseId, url]
  );
  if (existing.rows.length) return;

  await pool.query(
    `INSERT INTO slack_links (case_id, url, description, added_by_id)
     VALUES ($1,$2,$3,$4)`,
    [caseId, url, description, engineer_id ?? null]
  );
}

export default router;
