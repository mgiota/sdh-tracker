import { Router, Request, Response } from "express";
import { spawn } from "child_process";
import { pool } from "../db/client";
import { fetchIssue, fetchComments } from "../services/github";
import { parseSlackUrl, fetchThread, formatThreadForAI, isSlackAvailable } from "../services/slack";
import { CLAUDE_MODEL } from "../services/claudeUtils";

const router = Router();

// Extract all GitHub issue URLs from a message
function extractGithubUrls(text: string): { url: string; owner: string; repo: string; number: number }[] {
  const re = /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/g;
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    results.push({ url: m[0], owner: m[1], repo: m[2], number: parseInt(m[3]) });
  }
  return results;
}

// Fetch a GitHub issue + its comments and format as readable text
async function fetchIssueContext(owner: string, repo: string, number: number): Promise<string> {
  try {
    const [issue, comments] = await Promise.all([
      fetchIssue(owner, repo, number),
      fetchComments(owner, repo, number),
    ]);
    const lines = [
      `REFERENCED ISSUE: ${owner}/${repo} #${number}`,
      `TITLE: ${issue.title}`,
      `URL: ${issue.html_url}`,
      `STATE: ${issue.state}`,
      `OPENED BY: @${issue.user.login}`,
      `\nDESCRIPTION:\n${issue.body || "(none)"}`,
      `\nCOMMENTS (${comments.length}):`,
      ...comments.map((c, i) =>
        `[${i + 1}] @${c.user.login} (${c.created_at}):\n${c.body}`
      ),
    ];
    return lines.join("\n");
  } catch (err: any) {
    return `(Could not fetch ${owner}/${repo}#${number}: ${err.message})`;
  }
}

// ── GET /api/cases/:id/chat ─────────────────────────────────────────────────
// Fetch chat history for a case
router.get("/:id/chat", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, e.name AS engineer_name
       FROM chat_messages m
       LEFT JOIN engineers e ON e.id = m.engineer_id
       WHERE m.case_id = $1
       ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/cases/:id/chat ────────────────────────────────────────────────
// Send a message — streams the response back via SSE
router.post("/:id/chat", async (req: Request, res: Response) => {
  const { message, engineer_id } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "message required" });

  try {
    // Load full case context
    const [caseRow, comments, updates, handovers, history] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id=$1", [req.params.id]),
      pool.query(
        "SELECT author, body, is_elastic, posted_at FROM github_comments WHERE case_id=$1 ORDER BY posted_at ASC",
        [req.params.id]
      ),
      pool.query(
        `SELECT u.content, u.update_type, u.created_at, e.name AS engineer_name
         FROM case_updates u LEFT JOIN engineers e ON e.id = u.engineer_id
         WHERE u.case_id=$1 ORDER BY u.created_at ASC`,
        [req.params.id]
      ),
      pool.query(
        `SELECT h.summary, h.next_steps, h.week_start, f.name AS from_name
         FROM handovers h LEFT JOIN engineers f ON f.id = h.from_engineer_id
         WHERE h.case_id=$1 ORDER BY h.created_at ASC`,
        [req.params.id]
      ),
      pool.query(
        "SELECT role, content FROM chat_messages WHERE case_id=$1 ORDER BY created_at ASC",
        [req.params.id]
      ),
    ]);

    if (!caseRow.rows.length) return res.status(404).json({ error: "Case not found" });
    const c = caseRow.rows[0];

    // Build context block
    const context = `
CASE: ${c.title}
REPO: ${c.github_repo} #${c.github_issue_num}
STATUS: ${c.status}
URL: ${c.github_url}

=== ISSUE DESCRIPTION ===
${c.body || "(none)"}

=== GITHUB THREAD (${comments.rows.length} comments) ===
${comments.rows.map((cm: any) =>
  `@${cm.author}${cm.is_elastic ? " [Elastic]" : ""} (${cm.posted_at}):\n${cm.body}`
).join("\n\n---\n\n")}

=== INTERNAL NOTES & UPDATES ===
${updates.rows.length === 0 ? "(none)" : updates.rows.map((u: any) =>
  `[${u.update_type}] ${u.engineer_name ?? "System"}: ${u.content}`
).join("\n")}

=== HANDOVER NOTES ===
${handovers.rows.length === 0 ? "(none)" : handovers.rows.map((h: any) =>
  `From ${h.from_name} (week of ${h.week_start}):\nSummary: ${h.summary}\nNext steps: ${h.next_steps ?? "—"}`
).join("\n\n")}

=== PREVIOUS CHAT HISTORY ===
${history.rows.length === 0 ? "(none)" : history.rows.map((m: any) =>
  `${m.role === "user" ? "Engineer" : "AI"}: ${m.content}`
).join("\n\n")}
    `.trim();

    // Detect any GitHub issue URLs in the message and fetch them
    const referencedUrls = extractGithubUrls(message);
    let referencedContext = "";
    if (referencedUrls.length > 0) {
      const fetched = await Promise.all(
        referencedUrls.map(({ owner, repo, number }) =>
          fetchIssueContext(owner, repo, number)
        )
      );
      referencedContext = `
=== REFERENCED GITHUB ISSUES (fetched from message) ===
${fetched.join("\n\n---\n\n")}
      `.trim();
    }

    const systemPrompt = `You are an expert Elastic support engineer assistant helping an SDH (Support Duty Help) engineer handle a customer support issue.

You have full context about the current GitHub issue thread, internal notes, and handover history below.
${referencedContext ? "\nThe engineer has also referenced external GitHub issues in their message — their full content is included below for you to reason across both.\n" : ""}
Be concise and practical. When asked about similar issues, draw on your knowledge of Elastic products (Elasticsearch, Kibana, APM, Synthetics, etc.). When asked to draft a response, match a professional but friendly tone. Always ground your answers in the context provided.

${context}
${referencedContext ? `\n${referencedContext}` : ""}`;

    // Save user message
    await pool.query(
      "INSERT INTO chat_messages (case_id, role, content, engineer_id) VALUES ($1,'user',$2,$3)",
      [req.params.id, message, engineer_id ?? null]
    );

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const claudePath = process.env.CLAUDE_PATH || "claude";
    const fullPrompt = `${systemPrompt}\n\nEngineer's question: ${message}`;

    const proc = spawn(claudePath, ["--model", CLAUDE_MODEL, "--print", "--verbose", "--dangerously-skip-permissions", "--output-format", "stream-json", fullPrompt], {
      env: { ...process.env },
    });

    let fullResponse = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          // assistant message — extract text from content array
          if (parsed.type === "assistant") {
            const text = parsed.message?.content
              ?.filter((b: any) => b.type === "text")
              ?.map((b: any) => b.text)
              ?.join("") ?? "";
            if (text) {
              fullResponse += text;
              res.write(`data: ${JSON.stringify({ text })}\n\n`);
            }
          }
          // result event — we're done
          if (parsed.type === "result") {
            // use result field as final fallback if fullResponse is empty
            if (!fullResponse && parsed.result) {
              fullResponse = parsed.result;
              res.write(`data: ${JSON.stringify({ text: parsed.result })}\n\n`);
            }
          }
        } catch {
          // not JSON, ignore
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      console.error("Claude stderr:", chunk.toString());
    });

    proc.on("close", async (code) => {
      // Save assistant response to DB
      if (fullResponse.trim()) {
        await pool.query(
          "INSERT INTO chat_messages (case_id, role, content) VALUES ($1,'assistant',$2)",
          [req.params.id, fullResponse.trim()]
        );
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    });

    proc.on("error", (err) => {
      console.error("Claude spawn error:", err);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    // Clean up if client disconnects
    req.on("close", () => proc.kill());

  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;