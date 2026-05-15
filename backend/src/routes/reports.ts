import { Router, Request, Response } from "express";
import { execSync } from "child_process";
import { pool } from "../db/client";
import { CLAUDE_MODEL } from "../services/claudeUtils";
import { redact, redactDeep } from "../services/redact";

const router = Router();

// ── DELETE /api/reports/weekly?week_start=2024-01-08 ────────────────────────
router.delete("/weekly", async (req: Request, res: Response) => {
  try {
    const weekStart = req.query.week_start as string;
    if (!weekStart) return res.status(400).json({ error: "week_start required" });
    await pool.query("DELETE FROM weekly_reports WHERE week_start=$1", [weekStart]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/weekly?week_start=2024-01-08 ───────────────────────────
router.get("/weekly", async (req: Request, res: Response) => {
  try {
    const weekStart = (req.query.week_start as string) || getMonday(new Date());
    const weekEnd   = addDays(weekStart, 4);

    // Return cached report if exists and not requesting a refresh
    const refresh = req.query.refresh === "true";
    if (!refresh) {
      const cached = await pool.query(
        "SELECT * FROM weekly_reports WHERE week_start=$1",
        [weekStart]
      );
      if (cached.rows.length) {
        return res.json({
          ...cached.rows[0].data,
          markdown:  cached.rows[0].markdown,
          narrative: cached.rows[0].narrative,
          cached:    true,
        });
      } else {
        // No cached report and not a refresh request — return 404
        return res.status(404).json({ error: "No report found for this week" });
      }
    }

    // Who was on duty
    const duty = await pool.query(
      `SELECT d.*, e.name, e.github_handle FROM duty_weeks d
       JOIN engineers e ON e.id = d.engineer_id
       WHERE d.week_start <= $1 AND d.week_end >= $1`,
      [weekStart]
    );

    // Cases opened this week
    const opened = await pool.query(
      `SELECT c.*, e.name AS owner_name FROM cases c
       LEFT JOIN engineers e ON e.id = c.current_owner_id
       WHERE c.created_at >= $1 AND c.created_at < $2
       ORDER BY c.created_at ASC`,
      [weekStart, addDays(weekEnd, 1)]
    );

    // Cases resolved this week
    const resolved = await pool.query(
      `SELECT c.*, e.name AS owner_name FROM cases c
       LEFT JOIN engineers e ON e.id = c.current_owner_id
       WHERE c.resolved_at >= $1 AND c.resolved_at < $2
       ORDER BY c.resolved_at ASC`,
      [weekStart, addDays(weekEnd, 1)]
    );

    // Cases still open/pending (updated this week or older)
    const stillOpen = await pool.query(
      `SELECT c.*, e.name AS owner_name FROM cases c
       LEFT JOIN engineers e ON e.id = c.current_owner_id
       WHERE c.status != 'resolved'
       ORDER BY c.updated_at DESC`
    );

    // Handovers this week
    const handovers = await pool.query(
      `SELECT h.*, f.name AS from_name, t.name AS to_name, c.title AS case_title
       FROM handovers h
       LEFT JOIN engineers f ON f.id = h.from_engineer_id
       LEFT JOIN engineers t ON t.id = h.to_engineer_id
       LEFT JOIN cases c ON c.id = h.case_id
       WHERE h.week_start = $1
       ORDER BY h.created_at ASC`,
      [weekStart]
    );

    // Summaries of open cases for AI context
    const openSummaries = stillOpen.rows.map((c: any) => {
      const s = (() => { try { return c.ai_summary ? JSON.parse(c.ai_summary) : null; } catch { return null; } })();
      return `- [${c.status.toUpperCase()}] ${c.title} (${c.github_repo}#${c.github_issue_num})${s ? `: ${s.current_status}` : ""}`;
    }).join("\n");

    // Build context for AI narrative
    const context = `
WEEK: ${weekStart} to ${weekEnd}
ON DUTY: ${duty.rows[0] ? `${duty.rows[0].name} (@${duty.rows[0].github_handle})` : "Not assigned"}

CASES OPENED THIS WEEK (${opened.rows.length}):
${opened.rows.length === 0 ? "None" : opened.rows.map((c: any) => `- ${c.title} [${c.status}]`).join("\n")}

CASES RESOLVED THIS WEEK (${resolved.rows.length}):
${resolved.rows.length === 0 ? "None" : resolved.rows.map((c: any) => `- ${c.title}`).join("\n")}

STILL OPEN/PENDING (${stillOpen.rows.length}):
${stillOpen.rows.length === 0 ? "None" : openSummaries}

HANDOVERS THIS WEEK (${handovers.rows.length}):
${handovers.rows.length === 0 ? "None" : handovers.rows.map((h: any) =>
  `- ${h.case_title}: ${h.from_name} → ${h.to_name ?? "TBD"}: ${h.summary}`
).join("\n")}
    `.trim();

    // Generate AI narrative
    let narrative = "";
    try {
      const claudePath = process.env.CLAUDE_PATH || "claude";
      const prompt = `You are an SDH (Support Duty Help) engineer writing a weekly report for your team.

Based on the following data, write a concise 2-3 paragraph narrative summary of the week. 
Cover: what the main challenges were, what was resolved, what's still pending and needs attention, and any patterns you notice.
Write in first person as the engineer on duty. Be practical and specific.

${context}

Write only the narrative paragraphs, no headers, no bullet points.`;

      narrative = redact(execSync(
        `${process.env.CLAUDE_PATH || "claude"} --model ${CLAUDE_MODEL} --print --verbose --output-format text`,
        { input: prompt, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024, env: { ...process.env } }
      ) as string);
    } catch (err) {
      console.error("AI narrative failed:", err);
      narrative = "";
    }

    // Build markdown report
    const markdown = buildMarkdown({
      weekStart, weekEnd,
      duty: duty.rows[0] ?? null,
      opened: opened.rows,
      resolved: resolved.rows,
      stillOpen: stillOpen.rows,
      handovers: handovers.rows,
      narrative: narrative.trim(),
    });

    // Save to DB (upsert)
    await pool.query(
      `INSERT INTO weekly_reports (week_start, week_end, markdown, narrative, data)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (week_start) DO UPDATE SET
         markdown=EXCLUDED.markdown, narrative=EXCLUDED.narrative,
         data=EXCLUDED.data, updated_at=NOW()`,
      [weekStart, weekEnd, markdown, narrative.trim(), JSON.stringify(redactDeep({
        week_start: weekStart, week_end: weekEnd,
        duty: duty.rows[0] ?? null,
        opened: opened.rows, resolved: resolved.rows,
        still_open: stillOpen.rows, handovers: handovers.rows,
      }))]
    );

    res.json({
      week_start: weekStart,
      week_end: weekEnd,
      duty: duty.rows[0] ?? null,
      opened: opened.rows,
      resolved: resolved.rows,
      still_open: stillOpen.rows,
      handovers: handovers.rows,
      narrative: narrative.trim(),
      markdown,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function buildMarkdown(data: any): string {
  const lines: string[] = [
    `# SDH Weekly Report — ${data.weekStart} to ${data.weekEnd}`,
    "",
    `**On duty:** ${data.duty ? `${data.duty.name} (@${data.duty.github_handle})` : "Not assigned"}`,
    "",
  ];

  if (data.narrative) {
    lines.push("## Summary", "", data.narrative, "");
  }

  lines.push(
    "## Cases Opened This Week",
    "",
    data.opened.length === 0 ? "_None_" :
      data.opened.map((c: any) =>
        `- **[${c.status}]** [${c.title}](${c.github_url}) — ${c.owner_name ?? "Unassigned"}`
      ).join("\n"),
    ""
  );

  lines.push(
    "## Cases Resolved This Week",
    "",
    data.resolved.length === 0 ? "_None_" :
      data.resolved.map((c: any) =>
        `- [${c.title}](${c.github_url})`
      ).join("\n"),
    ""
  );

  lines.push(
    "## Still Open / Pending",
    "",
    data.stillOpen.length === 0 ? "_None_" :
      data.stillOpen.map((c: any) => {
        const s = (() => { try { return c.ai_summary ? JSON.parse(c.ai_summary) : null; } catch { return null; } })();
        return `- **[${c.status.replace("_", " ").toUpperCase()}]** [${c.title}](${c.github_url})${s?.next_steps ? `\n  - Next steps: ${s.next_steps}` : ""}`;
      }).join("\n"),
    ""
  );

  if (data.handovers.length > 0) {
    lines.push(
      "## Handovers",
      "",
      data.handovers.map((h: any) =>
        `- **${h.case_title}**: ${h.from_name} → ${h.to_name ?? "TBD"}\n  > ${h.summary}${h.next_steps ? `\n  > **Next steps:** ${h.next_steps}` : ""}`
      ).join("\n"),
      ""
    );
  }

  return lines.join("\n");
}

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export default router;