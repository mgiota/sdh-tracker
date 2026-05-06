import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import { pool } from "../db/client";
import { parseIssueUrl, fetchIssue, fetchComments, isElasticMember } from "../services/github";
import { summarizeIssue } from "../services/summarize";

const router = Router();

// ── GET /api/cases ─────────────────────────────────────────────────────────
router.get("/", async (_, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, e.name AS owner_name, e.github_handle AS owner_handle
      FROM cases c
      LEFT JOIN engineers e ON e.id = c.current_owner_id
      ORDER BY c.updated_at DESC
    `);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/import ──────────────────────────────────────────────────
router.post("/import", async (req: Request, res: Response) => {
  const { github_url, engineer_id } = req.body;
  if (!github_url) return res.status(400).json({ error: "github_url required" });
  try {
    const { owner, repo, number } = parseIssueUrl(github_url);
    const repoPath = `${owner}/${repo}`;
    const existing = await pool.query("SELECT id FROM cases WHERE github_url = $1", [github_url]);
    if (existing.rows.length) {
      return res.status(409).json({ error: "Case already imported", case_id: existing.rows[0].id });
    }
    const issue = await fetchIssue(owner, repo, number);
    const comments = await fetchComments(owner, repo, number);
    // Find current duty engineer
    const dutyEng = await pool.query(
      `SELECT engineer_id FROM duty_weeks
       WHERE week_start <= CURRENT_DATE AND week_end >= CURRENT_DATE
       LIMIT 1`
    );
    const ownerId = dutyEng.rows.length ? dutyEng.rows[0].engineer_id : (engineer_id ?? null);

    const { rows } = await pool.query(
      `INSERT INTO cases
        (github_url, github_issue_num, github_repo, title, body, status,
         github_author, github_labels, opened_by_id, current_owner_id)
       VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9)
       RETURNING *`,
      [github_url, number, repoPath, issue.title, issue.body ?? "",
       issue.user.login, issue.labels.map((l) => l.name), engineer_id ?? null, ownerId]
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

    // Auto-generate AI summary (non-blocking)
    summarizeIssue(issue.title, issue.body ?? "", comments.map(c => ({
      author: c.user.login, body: c.body, is_elastic: false, posted_at: c.created_at
    }))).then(async s => {
      await pool.query(
        "UPDATE cases SET ai_summary=$1, ai_summary_at=NOW() WHERE id=$2",
        [JSON.stringify(s), caseId]
      );
    }).catch(err => console.error("Summary generation failed:", err));

    if (engineer_id) {
      await pool.query(
        `INSERT INTO case_updates (case_id, engineer_id, update_type, content)
         VALUES ($1,$2,'note',$3)`,
        [caseId, engineer_id, `Case imported from GitHub issue #${number}`]
      );
    }
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/cases/:id ──────────────────────────────────────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, e.name AS owner_name, e.github_handle AS owner_handle
       FROM cases c LEFT JOIN engineers e ON e.id = c.current_owner_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const [comments, updates, slackLinks, handovers] = await Promise.all([
      pool.query("SELECT * FROM github_comments WHERE case_id=$1 ORDER BY posted_at ASC", [req.params.id]),
      pool.query(
        `SELECT u.*, e.name AS engineer_name FROM case_updates u
         LEFT JOIN engineers e ON e.id = u.engineer_id
         WHERE u.case_id=$1 ORDER BY u.created_at ASC`, [req.params.id]
      ),
      pool.query(
        `SELECT s.*, e.name AS added_by FROM slack_links s
         LEFT JOIN engineers e ON e.id = s.added_by_id
         WHERE s.case_id=$1 ORDER BY s.created_at ASC`, [req.params.id]
      ),
      pool.query(
        `SELECT h.*, f.name AS from_name, t.name AS to_name
         FROM handovers h
         LEFT JOIN engineers f ON f.id = h.from_engineer_id
         LEFT JOIN engineers t ON t.id = h.to_engineer_id
         WHERE h.case_id=$1 ORDER BY h.created_at ASC`, [req.params.id]
      ),
    ]);
    res.json({
      ...rows[0],
      github_comments: comments.rows,
      updates: updates.rows,
      slack_links: slackLinks.rows,
      handovers: handovers.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/cases/:id ────────────────────────────────────────────────────
router.patch("/:id", async (req: Request, res: Response) => {
  const { status, current_owner_id, priority, engineer_id } = req.body;
  try {
    const prev = await pool.query("SELECT status FROM cases WHERE id=$1", [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: "Not found" });
    await pool.query(
      `UPDATE cases SET
        status = COALESCE($1, status),
        current_owner_id = COALESCE($2, current_owner_id),
        priority = COALESCE($3, priority),
        updated_at = NOW(),
        resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE id = $4`,
      [status ?? null, current_owner_id ?? null, priority ?? null, req.params.id]
    );
    if (status && status !== prev.rows[0].status && engineer_id) {
      await pool.query(
        `INSERT INTO case_updates (case_id, engineer_id, update_type, content, metadata)
         VALUES ($1,$2,'status_change',$3,$4)`,
        [req.params.id, engineer_id, `Status changed to ${status}`,
         JSON.stringify({ old_status: prev.rows[0].status, new_status: status })]
      );
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/:id/refresh ─────────────────────────────────────────────
router.post("/:id/refresh", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const { github_repo, github_issue_num } = rows[0];
    const [owner, repo] = github_repo.split("/");
    const comments = await fetchComments(owner, repo, github_issue_num);
    let newCount = 0;
    for (const c of comments) {
      const elastic = await isElasticMember(c.user.login).catch(() => false);
      const r = await pool.query(
        `INSERT INTO github_comments (case_id, github_id, author, body, is_elastic, posted_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (github_id) DO NOTHING`,
        [req.params.id, c.id, c.user.login, c.body, elastic, c.created_at]
      );
      if (r.rowCount) newCount++;
    }
    await pool.query("UPDATE cases SET updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ new_comments: newCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/:id/updates ─────────────────────────────────────────────
router.post("/:id/updates", async (req: Request, res: Response) => {
  const { engineer_id, update_type, content, metadata } = req.body;
  if (!engineer_id || !update_type || !content)
    return res.status(400).json({ error: "engineer_id, update_type, content required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_updates (case_id, engineer_id, update_type, content, metadata)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, engineer_id, update_type, content, metadata ? JSON.stringify(metadata) : null]
    );
    await pool.query("UPDATE cases SET updated_at=NOW() WHERE id=$1", [req.params.id]);

    // If it's a slack_link, insert into slack_links (deduplicated) and auto-summarize
    if (update_type === "slack_link" && metadata?.url) {
      const slackInsert = await pool.query(
        `INSERT INTO slack_links (case_id, url, description, added_by_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (case_id, url) DO NOTHING
         RETURNING id`,
        [req.params.id, metadata.url, content, engineer_id]
      );
      if (slackInsert.rows.length) {
        const linkId = slackInsert.rows[0].id;
        const baseUrl = `http://localhost:${process.env.PORT || 3001}`;
        fetch(`${baseUrl}/api/cases/${req.params.id}/slack-links/${linkId}/summarize`, {
          method: "POST",
        }).catch(err => console.error("Auto-summarize slack failed:", err));
      }
    }

    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/cases/:id ────────────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT id FROM cases WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    await pool.query("DELETE FROM cases WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/cases/:id/github-url ─────────────────────────────────────────
router.patch("/:id/github-url", async (req: Request, res: Response) => {
  const { github_url } = req.body;
  if (!github_url) return res.status(400).json({ error: "github_url required" });
  try {
    const { owner, repo, number } = parseIssueUrl(github_url);
    await pool.query(
      `UPDATE cases SET github_url=$1, github_repo=$2, github_issue_num=$3, updated_at=NOW() WHERE id=$4`,
      [github_url, `${owner}/${repo}`, number, req.params.id]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/:id/summarize ───────────────────────────────────────────
router.post("/:id/summarize", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const c = rows[0];
    const comments = await pool.query(
      "SELECT author, body, is_elastic, posted_at FROM github_comments WHERE case_id=$1 ORDER BY posted_at ASC",
      [req.params.id]
    );
    const result = await summarizeIssue(c.title, c.body ?? "", comments.rows);
    const summaryText = JSON.stringify(result);
    await pool.query(
      "UPDATE cases SET ai_summary=$1, ai_summary_at=NOW() WHERE id=$2",
      [summaryText, req.params.id]
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/cases/:id/updates/:updateId ─────────────────────────────────
router.delete("/:id/updates/:updateId", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_updates WHERE id=$1 AND case_id=$2",
      [req.params.updateId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    // Only allow deleting notes and call_notes
    if (!["note", "call_notes"].includes(rows[0].update_type)) {
      return res.status(403).json({ error: "This update type cannot be deleted" });
    }
    await pool.query("DELETE FROM case_updates WHERE id=$1", [req.params.updateId]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/cases/:id/slack-links/:linkId ────────────────────────────────
router.delete("/:id/slack-links/:linkId", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM slack_links WHERE id=$1 AND case_id=$2",
      [req.params.linkId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    await pool.query("DELETE FROM slack_links WHERE id=$1", [req.params.linkId]);
    // Also remove the corresponding case_update entry
    await pool.query(
      "DELETE FROM case_updates WHERE case_id=$1 AND update_type='slack_link' AND metadata->>'url'=$2",
      [req.params.id, rows[0].url]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/:id/slack-links/:linkId/summarize ───────────────────────
router.post("/:id/slack-links/:linkId/summarize", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM slack_links WHERE id=$1 AND case_id=$2",
      [req.params.linkId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Slack link not found" });
    const link = rows[0];

    const claudePath = process.env.CLAUDE_PATH || "claude";
    const prompt = `Please read this Slack thread and provide a concise summary of what was discussed, any decisions made, and any action items.

Slack thread: ${link.url}

Respond ONLY with a JSON object in this format, no markdown, no preamble:
{
  "summary": "2-3 sentence overview of the discussion",
  "decisions": "Any decisions or conclusions reached (or 'None' if none)",
  "action_items": ["action item 1", "action item 2"]
}

For action_items: return an array of short, specific action items (each as a plain string). Use an empty array [] if there are none.`;

    const stdout = execSync(
      `${claudePath} --print --verbose --output-format text --allowedTools mcp__claude_ai_Slack__slack_read_thread,mcp__claude_ai_Slack__slack_read_channel`,
      {
        input: prompt,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      }
    ) as string;

    const clean = stdout.replace(/```json|```/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    const summary = jsonMatch ? jsonMatch[0] : JSON.stringify({ summary: clean, decisions: "", action_items: "" });

    await pool.query(
      "UPDATE slack_links SET ai_summary=$1, ai_summary_at=NOW() WHERE id=$2",
      [summary, req.params.linkId]
    );

    res.json(JSON.parse(summary));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/:id/similar ─────────────────────────────────────────────
interface SimilarCase {
  id: number;
  title: string;
  github_url: string;
  status: string;
  similarity_explanation: string;
  source: "local" | "github";
}

router.post("/:id/similar", async (req: Request, res: Response) => {
  const source: "local" | "github" = req.body.source ?? "local";
  try {
    const { rows: current } = await pool.query(
      "SELECT id, title, body, ai_summary, github_url FROM cases WHERE id=$1",
      [req.params.id]
    );
    if (!current.length) return res.status(404).json({ error: "Not found" });
    const c = current[0];
    const claudePath = process.env.CLAUDE_PATH || "claude";
    const currentText = c.ai_summary
      ? c.ai_summary
      : `${c.title}\n${(c.body ?? "").slice(0, 500)}`;

    if (source === "github") {
      // ── GitHub search path ──────────────────────────────────────────────────
      const { rows: mappings } = await pool.query(
        "SELECT DISTINCT github_repo FROM area_repo_mappings"
      );
      const repoFilter = mappings.map((r: any) => `repo:${r.github_repo}`).join(" ");
      const query = encodeURIComponent(`${c.title} ${repoFilter} is:issue`);
      const ghRes = await fetch(
        `https://api.github.com/search/issues?q=${query}&per_page=10`,
        { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" } }
      );
      const ghData = await ghRes.json() as { items?: any[] };
      const ghItems = (ghData.items ?? [])
        .filter((i: any) => i.html_url !== c.github_url)
        .slice(0, 10);

      if (!ghItems.length) return res.json([]);

      const candidateSummaries = ghItems.map((i: any, idx: number) =>
        `IDX:${idx} | ${i.title}\n${(i.body ?? "").slice(0, 400)}`
      ).join("\n\n---\n\n");

      const prompt = `You are helping an engineer find similar GitHub issues to a current support case.

Current case:
Title: ${c.title}
${currentText}

GitHub issues to compare against:
${candidateSummaries}

Return the top 3 most similar GitHub issues, ranked by similarity.
For each, provide a 1-2 sentence explanation of why it is similar.

Return ONLY a JSON array using the IDX numbers, no markdown, no preamble:
[
  {
    "idx": 0,
    "similarity_explanation": "Both involve SLO filter configuration issues with wildcard patterns."
  }
]

If no issues are similar, return: []`;

      const stdout = execSync(`${claudePath} --print --output-format text`, {
        input: prompt, encoding: "utf8", timeout: 90_000,
        maxBuffer: 1024 * 1024, env: { ...process.env },
      }) as string;

      const clean = stdout.replace(/```json|```/g, "").trim();
      const jsonMatch = clean.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return res.json([]);

      const ranked: { idx: number; similarity_explanation: string }[] = JSON.parse(jsonMatch[0]);
      const results: SimilarCase[] = ranked
        .filter(r => r.idx >= 0 && r.idx < ghItems.length)
        .slice(0, 3)
        .map(r => {
          const item = ghItems[r.idx];
          return {
            id: item.number,
            title: item.title,
            github_url: item.html_url,
            status: item.state,
            similarity_explanation: r.similarity_explanation,
            source: "github" as const,
          };
        });

      return res.json(results);
    }

    // ── Local search path ─────────────────────────────────────────────────────
    const { rows: candidates } = await pool.query(
      `SELECT id, title, body, github_url, status, ai_summary
       FROM cases
       WHERE status IN ('resolved','pending_customer','pending_internal')
         AND id != $1`,
      [req.params.id]
    );

    if (!candidates.length) return res.json([]);

    const candidateSummaries = candidates.map((cand: any) => {
      const text = cand.ai_summary
        ? cand.ai_summary
        : `${cand.title}\n${(cand.body ?? "").slice(0, 500)}`;
      return `ID:${cand.id} | ${cand.title}\n${text}`;
    }).join("\n\n---\n\n");

    const prompt = `You are helping an engineer find similar past support cases.

Current case:
Title: ${c.title}
${currentText}

Past cases to compare against:
${candidateSummaries}

Return the top 3 most similar past cases to the current case, ranked by similarity.
For each, provide a 1-2 sentence explanation of why it is similar.

Return ONLY a JSON array, no markdown, no preamble:
[
  {
    "id": 42,
    "similarity_explanation": "Both involve SLO filter configuration issues with wildcard patterns."
  }
]

If no cases are similar, return: []`;

    const stdout = execSync(`${claudePath} --print --output-format text`, {
      input: prompt, encoding: "utf8", timeout: 90_000,
      maxBuffer: 1024 * 1024, env: { ...process.env },
    }) as string;

    const clean = stdout.replace(/```json|```/g, "").trim();
    const jsonMatch = clean.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return res.json([]);

    const ranked: { id: number; similarity_explanation: string }[] = JSON.parse(jsonMatch[0]);
    const candidateMap = new Map(candidates.map((cand: any) => [cand.id, cand]));
    const results: SimilarCase[] = ranked
      .filter(r => candidateMap.has(r.id))
      .slice(0, 3)
      .map(r => {
        const cand = candidateMap.get(r.id)!;
        return {
          id: cand.id,
          title: cand.title,
          github_url: cand.github_url,
          status: cand.status,
          similarity_explanation: r.similarity_explanation,
          source: "local" as const,
        };
      });

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/:id/handover ────────────────────────────────────────────
router.post("/:id/handover", async (req: Request, res: Response) => {
  const { from_engineer_id, to_engineer_id, summary, next_steps, week_start } = req.body;
  if (!from_engineer_id || !summary || !week_start)
    return res.status(400).json({ error: "from_engineer_id, summary, week_start required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO handovers (case_id, from_engineer_id, to_engineer_id, summary, next_steps, week_start)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, from_engineer_id, to_engineer_id ?? null, summary, next_steps ?? null, week_start]
    );
    await pool.query(
      `INSERT INTO case_updates (case_id, engineer_id, update_type, content)
       VALUES ($1,$2,'handover','Handover notes written')`,
      [req.params.id, from_engineer_id]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;