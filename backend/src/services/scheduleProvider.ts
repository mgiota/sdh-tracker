import { execSync } from "child_process";
import { pool } from "../db/client";
import { SLACK_READ_TOOLS, looksLikePermissionDenial } from "./claudeUtils";

export interface DutyPeriod {
  name: string;
  github_handle?: string;
  week_start: string;
  week_end: string;
}

// ── Abstract interface ────────────────────────────────────────────────────────
interface ScheduleProvider {
  getSchedule(): Promise<DutyPeriod[]>;
}

// ── Slack Provider ────────────────────────────────────────────────────────────
class SlackScheduleProvider implements ScheduleProvider {
  async getSchedule(): Promise<DutyPeriod[]> {
    const claudePath = process.env.CLAUDE_PATH || "claude";

    const today = new Date().toISOString().slice(0, 10);

    const prompt = `Today's date is ${today}.

Search the Slack channel "actionable-obs-sdh" for messages from the DutyHelper app about SDH duty schedule. Look at messages from the last 8 weeks, not just the most recent ones.

DutyHelper posts two kinds of messages that reveal the schedule:
1. Weekly rotation announcements (e.g. "Hi <@name>, you are on duty this week" or similar).
2. SDH assignment messages that mention who is "currently on duty" — example:
     @panagiota.mitsopoulou!
     I have assigned you the following SDH, as to my knowledge you are currently on duty for area::...

Extract one entry per (engineer, week). The duty week runs Monday → Friday. If only the engineer + a single date are visible, infer the Monday/Friday of that calendar week.

Respond ONLY with a JSON array, no markdown, no preamble:
[
  {
    "name": "Full Name",
    "week_start": "YYYY-MM-DD",
    "week_end": "YYYY-MM-DD"
  }
]

If you cannot find any schedule information, return an empty array: []`;

    const stdout = execSync(
      `${claudePath} --print --verbose --output-format text --allowedTools ${SLACK_READ_TOOLS}`,
      {
        input: prompt,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      }
    ) as string;

    const clean = stdout.replace(/```json|```/g, "").trim();
    console.log("[schedule-sync] Claude raw output:", clean.slice(0, 2000));

    if (looksLikePermissionDenial(clean)) {
      throw new Error(
        "Slack MCP tool permission denied. Run `claude mcp list` to confirm Slack is connected, then try again. (Raw response started with: " +
          clean.slice(0, 120).replace(/\s+/g, " ") +
          "…)"
      );
    }

    const jsonMatch = clean.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log("[schedule-sync] No JSON array found in output");
      return [];
    }

    return JSON.parse(jsonMatch[0]) as DutyPeriod[];
  }
}

// ── PagerDuty Provider (stub — ready to implement) ────────────────────────────
class PagerDutyScheduleProvider implements ScheduleProvider {
  async getSchedule(): Promise<DutyPeriod[]> {
    const apiKey    = process.env.PAGERDUTY_API_KEY;
    const scheduleId = process.env.PAGERDUTY_SCHEDULE_ID;
    if (!apiKey || !scheduleId) {
      throw new Error("PAGERDUTY_API_KEY and PAGERDUTY_SCHEDULE_ID must be set");
    }
    // TODO: implement PagerDuty API call
    // GET https://api.pagerduty.com/oncalls?schedule_ids[]=scheduleId
    throw new Error("PagerDuty provider not yet implemented");
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
function getProvider(): ScheduleProvider {
  const provider = process.env.SCHEDULE_PROVIDER ?? "slack";
  if (provider === "pagerduty") return new PagerDutyScheduleProvider();
  return new SlackScheduleProvider();
}

// ── Name normalizer for fuzzy matching ───────────────────────────────────────
function normalizeEngineerName(name: string): string {
  return name.toLowerCase().replace(/[\s.\-_]+/g, "");
}

// ── Sync to DB ────────────────────────────────────────────────────────────────
export async function syncSchedule(): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    const provider = getProvider();
    const periods  = await provider.getSchedule();

    // Load all existing engineers once for fuzzy matching
    const { rows: allEngineers } = await pool.query<{ id: number; name: string }>(
      "SELECT id, name FROM engineers"
    );

    for (const period of periods) {
      const normalizedIncoming = normalizeEngineerName(period.name);

      // Fuzzy match: normalize both sides and compare
      const match = allEngineers.find(
        e => normalizeEngineerName(e.name) === normalizedIncoming
      );

      let engineerId: number;

      if (match) {
        engineerId = match.id;
      } else {
        // No match — create new engineer
        const created = await pool.query(
          `INSERT INTO engineers (name, github_handle)
           VALUES ($1, $2) RETURNING id`,
          [period.name, period.name.toLowerCase().replace(/\s+/g, ".")]
        );
        engineerId = created.rows[0].id;
        allEngineers.push({ id: engineerId, name: period.name });
        console.log(`Auto-created engineer: ${period.name}`);
      }

      // Merge: upsert by engineer + week_start
      await pool.query(
        `INSERT INTO duty_weeks (engineer_id, week_start, week_end)
         VALUES ($1, $2, $3)
         ON CONFLICT (engineer_id, week_start) DO UPDATE SET week_end = EXCLUDED.week_end`,
        [engineerId, period.week_start, period.week_end]
      );
      synced++;
    }
  } catch (err: any) {
    errors.push(err.message);
  }

  return { synced, errors };
}