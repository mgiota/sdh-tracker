import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import { pool } from "../db/client";
import { fetchIssue, fetchComments, isElasticMember } from "../services/github";
import { summarizeIssue } from "../services/summarize";

const router = Router();

// ── POST /api/scan ────────────────────────────────────────────────────────────
// Scan actionable-obs-sdh Slack channel for new SDH issues assigned to current user
router.post("/", async (req: Request, res: Response) => {
  const { engineer_id } = req.body;

  try {
    const claudePath = process.env.CLAUDE_PATH || "claude";

    // Step 1: Read DutyHelper messages from Slack
    const prompt = `Search Slack for recent messages from DutyHelper in the actionable-obs-sdh channel. Search for "I have assigned you the following SDH".

DutyHelper messages look exactly like this:

  @panagiota.mitsopoulou!
  I have assigned you the following SDH, as to my knowledge you are currently on duty for area::observability-alerting-custom_threshold:

  :warning: urgency:24h #6164 - Customer threshold rules

Key things to extract from each message:
- area_label: the "area::something" label (e.g. "area::observability-alerting-custom_threshold")
- issue_number: the number after "#" (e.g. 6164)
- title: the text after "- " on the urgency line (e.g. "Customer threshold rules")
- assignee: the @mention name (e.g. "panagiota.mitsopoulou")

There are many different area labels — extract whatever area::label appears in each message.
Extract ALL such messages from the last 7 days.

Return ONLY a JSON array, no markdown, no preamble, no explanation:
[
  {
    "area_label": "area::observability-alerting-custom_threshold",
    "issue_number": 6164,
    "title": "Customer threshold rules",
    "assignee": "panagiota.mitsopoulou"
  }
]

If no SDH assignments found, return: []`;

    const stdout = execSync(
      `${claudePath} --print --verbose --output-format text --allowedTools mcp__claude_ai_Slack__slack_search_public_and_private,mcp__claude_ai_Slack__slack_read_channel,mcp__claude_ai_Slack__slack_search_channels`,
      {
        input: prompt,
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      }
    ) as string;

    const clean = stdout.replace(/```json|```/g, "").trim();
    console.log("[scan] Claude raw output:", clean.slice(0, 2000));
    const jsonMatch = clean.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[scan] No JSON array found in output");
      return res.json({ imported: [], skipped: [], errors: [] });
    }

    const assignments: { area_label: string; issue_number: number; title: string; assignee: string }[] =
      JSON.parse(jsonMatch[0]);

    const imported: any[] = [];
    const skipped: any[]  = [];
    const errors: string[] = [];

    // Step 2: Find current duty engineer
    const dutyEng = await pool.query(
      `SELECT engineer_id FROM duty_weeks
       WHERE week_start <= CURRENT_DATE AND week_end >= CURRENT_DATE
       LIMIT 1`
    );
    const ownerId = dutyEng.rows.length ? dutyEng.rows[0].engineer_id : (engineer_id ?? null);

    for (const a of assignments) {
      try {
        // Step 3: Resolve repo from mapping table
        let repo: string | null = null;

        const mapping = await pool.query(
          "SELECT github_repo FROM area_repo_mappings WHERE LOWER(area_label) = LOWER($1)",
          [a.area_label]
        );

        if (mapping.rows.length) {
          repo = mapping.rows[0].github_repo;
        } else {
          // Fallback: ask Claude to infer the repo
          repo = await inferRepo(a.area_label, a.title, claudePath);
          if (repo) {
            // Save inferred mapping for next time
            await pool.query(
              `INSERT INTO area_repo_mappings (area_label, github_repo)
               VALUES ($1, $2) ON CONFLICT (area_label) DO NOTHING`,
              [a.area_label, repo]
            );
          }
        }

        if (!repo) {
          errors.push(`Could not determine repo for ${a.area_label} #${a.issue_number}`);
          continue;
        }

        const github_url = `https://github.com/${repo}/issues/${a.issue_number}`;

        // Step 4: Skip if already imported
        const existing = await pool.query("SELECT id FROM cases WHERE github_url=$1", [github_url]);
        if (existing.rows.length) {
          skipped.push({ github_url, reason: "Already imported" });
          continue;
        }

        // Step 5: Fetch from GitHub and import
        const [owner, repoName] = repo.split("/");
        const issue    = await fetchIssue(owner, repoName, a.issue_number);
        const comments = await fetchComments(owner, repoName, a.issue_number);

        const { rows } = await pool.query(
          `INSERT INTO cases
            (github_url, github_issue_num, github_repo, title, body, status,
             github_author, github_labels, opened_by_id, current_owner_id)
           VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9)
           RETURNING *`,
          [github_url, a.issue_number, repo, issue.title, issue.body ?? "",
           issue.user.login, issue.labels.map((l: any) => l.name),
           engineer_id ?? null, ownerId]
        );
        const caseId = rows[0].id;

        for (const c of comments) {
          const elastic = await isElasticMember(c.user.login).catch(() => false);
          await pool.query(
            `INSERT INTO github_comments (case_id, github_id, author, body, is_elastic, posted_at)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (github_id) DO NOTHING`,
            [caseId, c.id, c.user.login, c.body, elastic, c.created_at]
          );
        }

        // Auto-summarize (non-blocking)
        summarizeIssue(issue.title, issue.body ?? "", comments.map((c: any) => ({
          author: c.user.login, body: c.body, is_elastic: false, posted_at: c.created_at
        }))).then(async s => {
          await pool.query(
            "UPDATE cases SET ai_summary=$1, ai_summary_at=NOW() WHERE id=$2",
            [JSON.stringify(s), caseId]
          );
        }).catch(() => {});

        imported.push({ github_url, title: issue.title, case_id: caseId });
      } catch (err: any) {
        errors.push(`#${a.issue_number}: ${err.message}`);
      }
    }

    res.json({ imported, skipped, errors });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/scan/mappings ────────────────────────────────────────────────────
router.get("/mappings", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM area_repo_mappings ORDER BY area_label ASC"
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/scan/mappings ────────────────────────────────────────────────────
router.put("/mappings", async (req: Request, res: Response) => {
  const { area_label, github_repo } = req.body;
  if (!area_label || !github_repo)
    return res.status(400).json({ error: "area_label and github_repo required" });
  try {
    await pool.query(
      `INSERT INTO area_repo_mappings (area_label, github_repo)
       VALUES ($1, $2) ON CONFLICT (area_label) DO UPDATE SET github_repo = EXCLUDED.github_repo`,
      [area_label, github_repo]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: ask Claude to infer the repo ─────────────────────────────────────
async function inferRepo(areaLabel: string, issueTitle: string, claudePath: string): Promise<string | null> {
  try {
    const prompt = `Given this Elastic SDH area label and issue title, what is the most likely GitHub repository?

Area label: ${areaLabel}
Issue title: ${issueTitle}

Known repos: elastic/sdh-kibana, elastic/sdh-synthetics, elastic/sdh-apm

Respond with ONLY the repo in format "owner/repo", nothing else. Example: elastic/sdh-kibana`;

    const stdout = execSync(
      `${claudePath} --print --output-format text`,
      {
        input: prompt,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      }
    ) as string;

    const match = stdout.trim().match(/elastic\/sdh-[\w-]+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

export default router;