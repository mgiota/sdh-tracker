import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface SummaryResult {
  summary: string;
  what_was_tried: string;
  current_status: string;
  next_steps: string;
}

export async function summarizeIssue(
  title: string,
  body: string,
  comments: { author: string; body: string; is_elastic: boolean; posted_at: string }[]
): Promise<SummaryResult> {
  const thread = [
    `ISSUE TITLE: ${title}`,
    `\nISSUE DESCRIPTION:\n${body || "(no description)"}`,
    `\nCOMMENTS (${comments.length} total):`,
    ...comments.map((c, i) =>
      `\n[${i + 1}] @${c.author}${c.is_elastic ? " (Elastic)" : ""} at ${c.posted_at}:\n${c.body}`
    ),
  ].join("\n");

  const prompt = `You are an expert support engineer at Elastic. You are reading a GitHub support issue thread.

Produce a concise structured summary for an internal engineering team.

Respond ONLY with a valid JSON object in this exact format, no markdown, no preamble:
{
  "summary": "1-2 sentence description of what the issue is about",
  "what_was_tried": "Brief description of what has been attempted so far",
  "current_status": "Where things stand right now, including any blockers",
  "next_steps": "Concrete recommended next steps for the engineer picking this up"
}

Here is the issue thread:

${thread}`;

  try {
    const { stdout } = await execFileAsync("claude", [
      "--print",          // non-interactive, print output and exit
      "--output-format", "text",
      prompt,
    ], {
      timeout: 60_000,    // 60s max
      maxBuffer: 1024 * 1024,
    });

    // Strip any accidental markdown fences
    const clean = stdout.replace(/```json|```/g, "").trim();
    return JSON.parse(clean) as SummaryResult;
  } catch (err: any) {
    console.error("Claude CLI error:", err.message);
    return {
      summary: `Summarization failed: ${err.message}`,
      what_was_tried: "",
      current_status: "",
      next_steps: "",
    };
  }
}