// Model to use for all Claude CLI calls. Override via CLAUDE_MODEL env var.
// Default is claude-sonnet-4-6 (standard context, no extra usage required).
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// Comma-separated list of read-only Slack MCP tools we allow Claude CLI to use
// when invoked from the backend. Includes search + read variants so Claude
// doesn't fail by reaching for an unallowed sibling tool.
export const SLACK_READ_TOOLS = [
  "mcp__claude_ai_Slack__slack_search_public_and_private",
  "mcp__claude_ai_Slack__slack_search_public",
  "mcp__claude_ai_Slack__slack_search_channels",
  "mcp__claude_ai_Slack__slack_read_channel",
  "mcp__claude_ai_Slack__slack_read_thread",
  "mcp__claude_ai_Slack__slack_read_user_profile",
].join(",");

// Detect when Claude returned a permission-request message instead of a result.
// Claude's `--print` mode can't prompt the user, so denied tools surface as text.
export function looksLikePermissionDenial(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(need|require|grant|approve)\b/.test(t) &&
    /\bpermission\b/.test(t) &&
    /\bslack\b/.test(t)
  );
}

// Fuzzy-match incoming names against engineer records.
// Handles "Panagiota Mitsopoulou" vs "panagiota.mitsopoulou" vs "panagiota-mitsopoulou".
export function normalizeEngineerName(name: string): string {
  return name.toLowerCase().replace(/[\s.\-_]+/g, "");
}
