import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import {
  getCase, updateCase, addUpdate, refreshCase, addHandover,
  getEngineers, summarizeCase, getChatHistory, summarizeSlackThread,
  deleteUpdate, deleteSlackLink, updateGithubUrl, deleteCase, getSimilarCases,
} from "../api";
import type { CaseDetail, CaseStatus, Engineer, SimilarCase } from "../types";

const STATUS_OPTS: CaseStatus[] = ["open", "pending_customer", "pending_internal", "resolved"];
const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open", pending_customer: "Pending Customer",
  pending_internal: "Pending Internal", resolved: "Resolved",
};
const STATUS_COLOR: Record<CaseStatus, string> = {
  open: "bg-blue-100 text-blue-800", pending_customer: "bg-amber-100 text-amber-800",
  pending_internal: "bg-purple-100 text-purple-800", resolved: "bg-green-100 text-green-800",
};
const UPDATE_META: Record<string, { icon: string; label: string; color: string }> = {
  note:          { icon: "📝", label: "Internal note",    color: "text-gray-600" },
  call_notes:    { icon: "📞", label: "Call outcome",     color: "text-green-700" },
  slack_link:    { icon: "🔗", label: "Slack link added", color: "text-purple-700" },
  status_change: { icon: "🔄", label: "Status changed",   color: "text-blue-700" },
  handover:      { icon: "🤝", label: "Handover written", color: "text-amber-700" },
};

type Tab = "thread" | "timeline" | "slack" | "handover";

const SIMILAR_CASES_SUGGESTION = "Analyze similar past cases and suggest applicable solutions";
const SUGGESTIONS = [
  SIMILAR_CASES_SUGGESTION,
  "What's the most likely root cause?",
  "Draft a response to the customer",
  "What Elastic docs are relevant?",
  "Summarize for the next engineer",
  "Paste a related GitHub issue URL to compare",
];

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function CaseDetailPage({ engineer }: { engineer: Engineer | null }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [c, setC]                 = useState<CaseDetail | null>(null);
  const [tab, setTab]             = useState<Tab>("thread");
  const [engineers, setEngineers] = useState<Engineer[]>([]);

  const [note, setNote]                       = useState("");
  const [slackUrl, setSlackUrl]               = useState("");
  const [slackDesc, setSlackDesc]             = useState("");
  const [callNotes, setCallNotes]             = useState("");
  const [handoverSummary, setHandoverSummary] = useState("");
  const [handoverNext, setHandoverNext]       = useState("");
  const [handoverTo, setHandoverTo]           = useState("");

  const [saving, setSaving]           = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [editingUrl, setEditingUrl]   = useState(false);
  const [newGithubUrl, setNewGithubUrl] = useState("");

  const [expandedSummaries, setExpandedSummaries] = useState<Record<number, boolean>>({});
  const [summarizingSlack, setSummarizingSlack]   = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog]         = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [findingSimilar, setFindingSimilar]       = useState(false);
  const [similarCases, setSimilarCases]           = useState<SimilarCase[] | null>(null);
  const [showSimilarModal, setShowSimilarModal]   = useState(false);
  const [similarSource, setSimilarSource]         = useState<"local" | "github">("local");

  const [chatOpen, setChatOpen]               = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [chatHistory, setChatHistory]         = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput]             = useState("");
  const [chatLoading, setChatLoading]         = useState(false);
  const [streamingMsg, setStreamingMsg]       = useState("");
  const chatBottomRef                         = useRef<HTMLDivElement>(null);

  async function load() { setC(await getCase(Number(id))); }

  useEffect(() => {
    load();
    getEngineers().then(setEngineers);
    getChatHistory(Number(id)).then(setChatHistory);
  }, [id]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, streamingMsg]);

  function openConfirm(message: string, onConfirm: () => void) {
    setConfirmDialog({ message, onConfirm });
  }

  async function changeStatus(status: CaseStatus) {
    if (!engineer || !c) return;
    await updateCase(c.id, { status, engineer_id: engineer.id });
    load();
  }

  async function changeOwner(eid: string) {
    if (!c) return;
    await updateCase(c.id, { current_owner_id: parseInt(eid), engineer_id: engineer?.id });
    load();
  }

  async function submitNote() {
    if (!note.trim() || !engineer || !c) return;
    setSaving(true);
    await addUpdate(c.id, { engineer_id: engineer.id, update_type: "note", content: note });
    setNote(""); await load(); setSaving(false);
  }

  async function submitCallNotes() {
    if (!callNotes.trim() || !engineer || !c) return;
    setSaving(true);
    await addUpdate(c.id, { engineer_id: engineer.id, update_type: "call_notes", content: callNotes });
    setCallNotes(""); await load(); setSaving(false);
  }

  async function submitSlack() {
    if (!slackUrl.trim() || !engineer || !c) return;
    setSaving(true);
    await addUpdate(c.id, {
      engineer_id: engineer.id, update_type: "slack_link",
      content: slackDesc || "Slack thread", metadata: { url: slackUrl },
    });
    setSlackUrl(""); setSlackDesc(""); await load(); setSaving(false);
  }

  async function submitHandover() {
    if (!handoverSummary.trim() || !engineer || !c) return;
    setSaving(true);
    const today = new Date().toISOString().split("T")[0];
    await addHandover(c.id, {
      from_engineer_id: engineer.id,
      to_engineer_id: handoverTo ? parseInt(handoverTo) : undefined,
      summary: handoverSummary, next_steps: handoverNext, week_start: today,
    });
    setHandoverSummary(""); setHandoverNext(""); setHandoverTo("");
    await load(); setSaving(false);
  }

  async function doRefresh() {
    if (!c) return;
    setRefreshing(true);
    const { new_comments } = await refreshCase(c.id);
    await load();
    setRefreshing(false);
    alert(`Refreshed — ${new_comments} new comment(s) fetched.`);
  }

  async function doSummarize() {
    if (!c) return;
    setSummarizing(true);
    await summarizeCase(c.id);
    await load();
    setSummarizing(false);
  }

  async function analyzeWithSimilarCases() {
    if (!c) return;
    setChatOpen(true);
    setShowSuggestions(false);
    setChatLoading(true);
    setChatHistory(h => [...h, { role: "user", content: SIMILAR_CASES_SUGGESTION }]);
    try {
      const [localSimilar, githubSimilar] = await Promise.all([
        getSimilarCases(c.id, "local").catch(() => []),
        getSimilarCases(c.id, "github").catch(() => []),
      ]);

      const allSimilar = [...localSimilar, ...githubSimilar];

      if (!allSimilar.length) {
        await sendChat("Find similar past cases and suggest applicable solutions. Note: no similar cases were found in either the imported cases database or GitHub.");
        return;
      }

      const format = (sc: typeof allSimilar[0], i: number) =>
        `${i + 1}. [${sc.source === "local" ? "Imported" : "GitHub"}] "${sc.title}" (status: ${sc.status})\n   Why similar: ${sc.similarity_explanation}\n   URL: ${sc.github_url}`;

      const summaries = allSimilar.map(format).join("\n\n");
      const msg = `I found ${allSimilar.length} similar case(s) (${localSimilar.length} imported, ${githubSimilar.length} from GitHub):\n\n${summaries}\n\nBased on these similar cases, what patterns do you see? What solutions or approaches from these cases might be applicable to the current one?`;
      await sendChat(msg);
    } catch {
      await sendChat("Analyze similar past cases and suggest applicable solutions based on your knowledge of this case.");
    }
  }

  async function doFindSimilar() {
    if (!c) return;
    setFindingSimilar(true);
    setShowSimilarModal(true);
    setSimilarCases(null);
    try {
      const results = await getSimilarCases(c.id, similarSource);
      setSimilarCases(results);
    } catch (e: any) {
      setSimilarCases([]);
    } finally {
      setFindingSimilar(false);
    }
  }

  async function doSummarizeSlack(linkId: number) {
    setSummarizingSlack(linkId);
    try {
      await summarizeSlackThread(Number(id), linkId);
      await load();
      setExpandedSummaries(e => ({ ...e, [linkId]: true }));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSummarizingSlack(null);
    }
  }

  async function doDeleteUpdate(updateId: number, label: string) {
    openConfirm(`Delete this ${label}? This cannot be undone.`, async () => {
      await deleteUpdate(Number(id), updateId);
      await load();
    });
  }

  async function doDeleteSlackLink(linkId: number) {
    openConfirm("Remove this Slack thread link? This cannot be undone.", async () => {
      await deleteSlackLink(Number(id), linkId);
      await load();
    });
  }

  async function doDeleteCase() {
    openConfirm("Delete this case permanently? All notes, updates and handovers will be lost.", async () => {
      await deleteCase(Number(id));
      navigate("/");
    });
  }

  async function doUpdateGithubUrl() {
    if (!newGithubUrl.trim() || !c) return;
    await updateGithubUrl(c.id, newGithubUrl.trim());
    setEditingUrl(false);
    setNewGithubUrl("");
    await load();
  }

  async function sendChat(overrideMsg?: string) {
    const userMsg = overrideMsg ?? chatInput.trim();
    if (!userMsg || chatLoading) return;
    if (!overrideMsg) setChatInput("");
    setChatHistory(h => [...h, { role: "user", content: userMsg }]);
    setChatLoading(true);
    setStreamingMsg("");

    const res = await fetch(`/api/cases/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: userMsg, engineer_id: engineer?.id }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter(l => l.startsWith("data: "));
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.done) {
            setChatHistory(h => [...h, { role: "assistant", content: full }]);
            setStreamingMsg("");
          } else if (parsed.error) {
            setChatHistory(h => [...h, { role: "assistant", content: `Error: ${parsed.error}` }]);
            setStreamingMsg("");
          } else if (parsed.text) {
            full += parsed.text;
            setStreamingMsg(full);
          }
        } catch { /* ignore */ }
      }
    }
    setChatLoading(false);
  }

  if (!c) return <div className="text-sm text-gray-400 py-12 text-center">Loading…</div>;

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t ? "border-elastic-blue text-elastic-blue" : "border-transparent text-gray-500 hover:text-gray-800"
    }`;

  const hasGithubUrl = /https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+/.test(chatInput);
  const hasSlackUrl  = /https?:\/\/[a-z]+\.slack\.com\/archives\//.test(chatInput);

  const aiSummaryParsed = (() => {
    try { return c.ai_summary ? JSON.parse(c.ai_summary) : null; } catch { return null; }
  })();

  return (
    <div className="space-y-4">
      <button onClick={() => navigate("/")} className="text-sm text-elastic-blue hover:underline">
        ← Back to dashboard
      </button>

      {/* ── Header card ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-bold text-lg leading-tight">{c.title}</h1>
              {c.slack_origin_url && !c.github_url && (
                <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                  💬 Slack origin
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {c.github_repo && c.github_issue_num
                ? <>{c.github_repo} #{c.github_issue_num} · opened by @{c.github_author}</>
                : c.github_author
                  ? <>opened by @{c.github_author} · from Slack</>
                  : <>Started from Slack thread</>
              }
            </div>
          </div>
          {c.slack_origin_url && (
            <a href={c.slack_origin_url} target="_blank" rel="noreferrer"
              className="text-xs text-purple-600 underline shrink-0">View in Slack ↗</a>
          )}
          {c.github_url && (
            <a href={c.github_url} target="_blank" rel="noreferrer"
              className="text-xs text-elastic-blue underline shrink-0">View on GitHub ↗</a>
          )}
          <button onClick={() => { setEditingUrl(true); setNewGithubUrl(c.github_url ?? ""); }}
            className="text-xs text-gray-400 hover:text-gray-600 shrink-0" title={c.github_url ? "Edit GitHub URL" : "Link a GitHub issue"}>
            {c.github_url ? "✏️ Edit URL" : "🔗 Link GitHub issue"}
          </button>
          <button onClick={doDeleteCase}
            className="text-xs text-gray-400 hover:text-red-400 transition-colors shrink-0">🗑 Delete case</button>
        </div>
        {editingUrl && (
          <div className="flex gap-2">
            <input value={newGithubUrl} onChange={e => setNewGithubUrl(e.target.value)}
              placeholder="https://github.com/elastic/sdh-kibana/issues/123"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
            <button onClick={doUpdateGithubUrl}
              className="bg-elastic-blue text-white px-3 py-1.5 rounded-lg text-xs font-medium">Save</button>
            <button onClick={() => setEditingUrl(false)}
              className="border border-gray-200 px-3 py-1.5 rounded-lg text-xs text-gray-500">Cancel</button>
          </div>
        )}
        <div className="flex flex-wrap gap-3 items-center">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Status</label>
            <div className="flex gap-1">
              {STATUS_OPTS.map(s => (
                <button key={s} onClick={() => changeStatus(s)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                    c.status === s ? STATUS_COLOR[s] : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Owner</label>
            <select value={c.current_owner_id ?? ""} onChange={e => changeOwner(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue">
              <option value="">Unassigned</option>
              {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              {(["local", "github"] as const).map(s => (
                <label key={s} className="flex items-center gap-1 cursor-pointer">
                  <input type="radio" name="similarSource" value={s}
                    checked={similarSource === s}
                    onChange={() => setSimilarSource(s)}
                    className="accent-elastic-blue" />
                  {s === "local" ? "Imported" : "GitHub"}
                </label>
              ))}
            </div>
            <button onClick={doFindSimilar} disabled={findingSimilar}
              className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              {findingSimilar ? "Searching…" : "🔍 Find similar cases"}
            </button>
            {c.github_url && (
              <button onClick={doRefresh} disabled={refreshing}
                className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {refreshing ? "Refreshing…" : "↻ Refresh from GitHub"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── AI Summary ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">✨ AI Summary</span>
            {c.ai_summary_at && <span className="text-xs text-gray-400">· {fmt(c.ai_summary_at)}</span>}
          </div>
          <button onClick={doSummarize} disabled={summarizing}
            className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {summarizing ? "Generating…" : "↻ Regenerate"}
          </button>
        </div>
        {!aiSummaryParsed ? (
          <p className="text-sm text-gray-400 italic">
            {summarizing ? "Generating summary…" : "No summary yet — click Regenerate to generate one."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {([
              ["🔍 What it's about", aiSummaryParsed.summary],
              ["🔧 What was tried",  aiSummaryParsed.what_was_tried],
              ["⚠️ Current status",  aiSummaryParsed.current_status],
              ["👉 Next steps",      aiSummaryParsed.next_steps],
            ] as [string, string][]).map(([label, value]) => value ? (
              <div key={label} className="space-y-1">
                <div className="text-xs font-medium text-gray-500">{label}</div>
                <p className="text-sm text-gray-800">{value}</p>
              </div>
            ) : null)}
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-100">
          <button className={tabCls("thread")}   onClick={() => setTab("thread")}>
            {c.github_url ? `GitHub Thread (${c.github_comments.length})` : "Issue"}
          </button>
          <button className={tabCls("timeline")} onClick={() => setTab("timeline")}>
            Timeline ({c.updates.length})
          </button>
          <button className={tabCls("slack")}    onClick={() => setTab("slack")}>
            Slack ({c.slack_links.length})
          </button>
          <button className={tabCls("handover")} onClick={() => setTab("handover")}>
            Handovers ({c.handovers.length})
          </button>
        </div>

        <div className="p-5">

          {/* ── GitHub Thread / Issue body ── */}
          {tab === "thread" && (
            <div className="space-y-4">
              {!c.github_url && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center gap-3 text-sm">
                  <span className="text-purple-500">💬</span>
                  <div className="flex-1 text-purple-800">
                    This case started from a Slack thread.
                    {c.slack_origin_url && (
                      <a href={c.slack_origin_url} target="_blank" rel="noreferrer"
                        className="ml-1 underline font-medium">View original thread ↗</a>
                    )}
                  </div>
                  <button onClick={() => { setEditingUrl(true); setNewGithubUrl(""); }}
                    className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 shrink-0">
                    🔗 Link GitHub issue
                  </button>
                </div>
              )}
              <div className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  {c.github_author && <span className="font-medium text-sm">@{c.github_author}</span>}
                  <span className="text-xs text-gray-400">{c.github_url ? "opened issue" : "Slack thread summary"}</span>
                  {c.github_labels?.map(l => (
                    <span key={l} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{l}</span>
                  ))}
                </div>
                <div className="prose prose-sm max-w-none text-gray-700">
                  <ReactMarkdown>{c.body || "_No description provided._"}</ReactMarkdown>
                </div>
              </div>
              {c.github_comments.map(cm => (
                <div key={cm.id} className={`border rounded-lg p-4 ${cm.is_elastic ? "border-elastic-blue/30 bg-blue-50/30" : "border-gray-100"}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium text-sm">@{cm.author}</span>
                    {cm.is_elastic && <span className="text-xs bg-elastic-blue text-white px-1.5 py-0.5 rounded">Elastic</span>}
                    <span className="text-xs text-gray-400 ml-auto">{fmt(cm.posted_at)}</span>
                  </div>
                  <div className="prose prose-sm max-w-none text-gray-700">
                    <ReactMarkdown>{cm.body}</ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Timeline ── */}
          {tab === "timeline" && (
            <div className="space-y-5">
              <div className="space-y-3">
                {c.updates.length === 0 && <p className="text-sm text-gray-400">No updates yet.</p>}
                {c.updates.map(u => {
                  const meta = UPDATE_META[u.update_type] ?? { icon: "•", label: u.update_type.replace("_", " "), color: "text-gray-600" };
                  const deletable = ["note", "call_notes"].includes(u.update_type);
                  return (
                    <div key={u.id} className="flex gap-3 group">
                      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-sm mt-0.5">
                        {meta.icon}
                      </div>
                      <div className="flex-1 pb-3">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-500 font-medium">{u.engineer_name ?? "System"}</span>
                          <span className="text-xs text-gray-400">· {fmt(u.created_at)}</span>
                          {deletable && (
                            <button onClick={() => doDeleteUpdate(u.id, meta.label)}
                              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 text-xs px-1">
                              🗑
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-gray-800">{u.content}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <hr className="border-gray-100" />
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Add internal note</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                  placeholder="What happened, what you tried, what's blocking you…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue resize-none" />
                <button onClick={submitNote} disabled={saving || !note.trim()}
                  className="bg-elastic-blue text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">
                  Save note
                </button>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Log customer call outcome</label>
                <textarea value={callNotes} onChange={e => setCallNotes(e.target.value)} rows={3}
                  placeholder="Who was on the call, what was discussed, decisions made…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue resize-none" />
                <button onClick={submitCallNotes} disabled={saving || !callNotes.trim()}
                  className="bg-elastic-green text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">
                  Save call notes
                </button>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Add Slack thread link</label>
                <input value={slackUrl} onChange={e => setSlackUrl(e.target.value)}
                  placeholder="https://elastic.slack.com/archives/…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
                <input value={slackDesc} onChange={e => setSlackDesc(e.target.value)}
                  placeholder="Short description (e.g. 'Customer triage thread')"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
                <button onClick={submitSlack} disabled={saving || !slackUrl.trim()}
                  className="bg-purple-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">
                  Add Slack link
                </button>
              </div>
            </div>
          )}

          {/* ── Slack Threads ── */}
          {tab === "slack" && (
            <div className="space-y-4">
              {c.slack_links.length === 0 && (
                <p className="text-sm text-gray-400">No Slack threads linked yet — add one in the Timeline tab.</p>
              )}
              {c.slack_links.map(link => {
                const parsed = (() => {
                  try { return link.ai_summary ? JSON.parse(link.ai_summary) : null; } catch { return null; }
                })();
                const expanded = expandedSummaries[link.id] ?? false;
                return (
                  <div key={link.id} className="border border-purple-100 rounded-xl overflow-hidden">
                    <div className="p-4 flex items-start gap-3">
                      <div className="w-8 h-8 rounded bg-purple-100 flex items-center justify-center shrink-0 text-base">💬</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-gray-800">{link.description}</div>
                        <a href={link.url} target="_blank" rel="noreferrer"
                          className="text-xs text-purple-500 hover:underline truncate block mt-0.5">{link.url}</a>
                        <div className="text-xs text-gray-400 mt-0.5">Added {fmt(link.created_at)}</div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <a href={link.url} target="_blank" rel="noreferrer"
                          className="text-xs border border-purple-200 text-purple-700 px-3 py-1.5 rounded-lg hover:bg-purple-50">
                          Open ↗
                        </a>
                        <button onClick={() => { setChatOpen(true); setChatInput(`Please read and summarize this Slack thread in the context of this case: ${link.url}`); }}
                          className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700">
                          💬 Ask AI
                        </button>
                        <button onClick={() => doDeleteSlackLink(link.id)}
                          className="text-xs border border-red-200 text-red-400 px-2 py-1.5 rounded-lg hover:bg-red-50">
                          🗑
                        </button>
                      </div>
                    </div>
                    <div className="border-t border-purple-50">
                      <button onClick={() => setExpandedSummaries(e => ({ ...e, [link.id]: !expanded }))}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-purple-700 hover:bg-purple-50 transition-colors">
                        <span className="flex items-center gap-1.5">
                          ✨ AI Summary
                          {link.ai_summary_at && <span className="text-gray-400 font-normal">· {fmt(link.ai_summary_at)}</span>}
                          {summarizingSlack === link.id && <span className="text-gray-400 font-normal">· Generating…</span>}
                          {!link.ai_summary && summarizingSlack !== link.id && <span className="text-gray-400 font-normal">· Not yet generated</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <button onClick={e => { e.stopPropagation(); doSummarizeSlack(link.id); }}
                            disabled={summarizingSlack === link.id}
                            className="text-purple-500 hover:text-purple-700 disabled:opacity-50">
                            {summarizingSlack === link.id ? "…" : "↻"}
                          </button>
                          <span>{expanded ? "▲" : "▼"}</span>
                        </div>
                      </button>
                      {expanded && (
                        <div className="px-4 pb-4 space-y-3 bg-purple-50/30">
                          {!parsed ? (
                            <p className="text-xs text-gray-400 italic pt-2">
                              {summarizingSlack === link.id ? "Generating…" : "Click ↻ to generate a summary."}
                            </p>
                          ) : (
                            <div className="space-y-2 pt-2">
                              {([
                                ["📝 Summary",   parsed.summary],
                                ["✅ Decisions", parsed.decisions],
                              ] as [string, string][]).map(([label, value]) => value && value !== "None" ? (
                                <div key={label}>
                                  <div className="text-xs font-medium text-gray-500 mb-0.5">{label}</div>
                                  <p className="text-sm text-gray-800">{value}</p>
                                </div>
                              ) : null)}
                              {(() => {
                                const items = parsed.action_items;
                                if (!items || items === "None" || (Array.isArray(items) && items.length === 0)) return null;
                                const list: string[] = Array.isArray(items)
                                  ? items
                                  : items.split(/\n|(?:\d+\.\s)/).map((s: string) => s.trim()).filter(Boolean);
                                return (
                                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                                    <div className="text-xs font-semibold text-amber-700 mb-1.5">👉 Action items</div>
                                    <ul className="space-y-1">
                                      {list.map((item, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-amber-900">
                                          <span className="mt-0.5 shrink-0 h-4 w-4 rounded border border-amber-400 bg-white" />
                                          {item}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Handover ── */}
          {tab === "handover" && (
            <div className="space-y-5">
              {c.handovers.length === 0 && <p className="text-sm text-gray-400">No handovers yet.</p>}
              {c.handovers.map(h => (
                <div key={h.id} className="border border-amber-100 bg-amber-50/40 rounded-lg p-4">
                  <div className="text-xs text-gray-400 mb-1">
                    <span className="font-medium text-gray-700">{h.from_name ?? "?"}</span>
                    {h.to_name && <> → <span className="font-medium text-gray-700">{h.to_name}</span></>}
                    {" · "}{h.week_start}
                  </div>
                  <p className="text-sm text-gray-800 mb-1"><strong>Summary:</strong> {h.summary}</p>
                  {h.next_steps && <p className="text-sm text-gray-800"><strong>Next steps:</strong> {h.next_steps}</p>}
                </div>
              ))}
              <hr className="border-gray-100" />
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 block">Write handover note</label>
                <select value={handoverTo} onChange={e => setHandoverTo(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue">
                  <option value="">Handing over to… (optional)</option>
                  {engineers.filter(e => e.id !== engineer?.id).map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
                <textarea value={handoverSummary} onChange={e => setHandoverSummary(e.target.value)} rows={3}
                  placeholder="Where things stand — what's been tried, what happened on calls, current blockers…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue resize-none" />
                <textarea value={handoverNext} onChange={e => setHandoverNext(e.target.value)} rows={2}
                  placeholder="Next steps for the incoming engineer…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue resize-none" />
                <button onClick={submitHandover} disabled={saving || !handoverSummary.trim()}
                  className="bg-amber-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">
                  Submit handover
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Confirm dialog ── */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-lg">🗑</div>
              <p className="text-sm text-gray-700 pt-1">{confirmDialog.message}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Similar cases modal ── */}
      {showSimilarModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowSimilarModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-[560px] max-h-[80vh] overflow-y-auto space-y-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-base">Similar cases</h2>
              <button onClick={() => setShowSimilarModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            {findingSimilar || similarCases === null ? (
              <div className="text-sm text-gray-400 py-8 text-center">Searching for similar cases…</div>
            ) : similarCases.length === 0 ? (
              <div className="text-sm text-gray-400 py-8 text-center">No similar cases found yet.</div>
            ) : (
              <div className="space-y-3">
                {similarCases.map(sc => (
                  <div key={sc.id} className="border border-gray-200 rounded-xl p-4 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      {sc.source === "github" ? (
                        <a href={sc.github_url} target="_blank" rel="noreferrer"
                          className="text-sm font-medium text-elastic-blue hover:underline text-left">
                          {sc.title} ↗
                        </a>
                      ) : (
                        <button
                          onClick={() => { setShowSimilarModal(false); navigate(`/cases/${sc.id}`); }}
                          className="text-sm font-medium text-elastic-blue hover:underline text-left">
                          {sc.title}
                        </button>
                      )}
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-gray-100 text-gray-600">
                        {sc.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{sc.similarity_explanation}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Floating Ask AI button ── */}
      <button onClick={() => setChatOpen(o => !o)}
        className="fixed bottom-6 right-6 bg-elastic-blue text-white px-4 py-3 rounded-full shadow-lg font-medium text-sm flex items-center gap-2 hover:bg-blue-700 transition-colors z-40">
        {chatOpen ? "✕ Close AI" : "✨ Ask AI"}
      </button>

      {/* ── Chat panel ── */}
      {chatOpen && (
        <div className="fixed bottom-20 right-6 w-96 h-[560px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col z-40">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="font-semibold text-sm">✨ AI Assistant</span>
            <span className="text-xs text-gray-400 truncate flex-1">— {c.title}</span>
            <button onClick={() => setShowSuggestions(s => !s)}
              className="text-xs text-elastic-blue hover:underline shrink-0">
              {showSuggestions ? "Hide hints" : "💡 Hints"}
            </button>
          </div>
          {showSuggestions && (
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 space-y-1">
              {SUGGESTIONS.map(q => (
                <button key={q} onClick={() => {
                  if (q === SIMILAR_CASES_SUGGESTION) { analyzeWithSimilarCases(); }
                  else { setChatInput(q); setShowSuggestions(false); }
                }}
                  className="block w-full text-left bg-white hover:bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-600">
                  "{q}"
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {chatHistory.length === 0 && !streamingMsg && (
              <div className="text-xs text-gray-400 text-center pt-8">
                <p>I have full context about this case.</p>
                <p className="mt-1">Click <strong>💡 Hints</strong> above for suggested questions.</p>
              </div>
            )}
            {chatHistory.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-elastic-blue text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-800 rounded-bl-sm"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {streamingMsg && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm bg-gray-100 text-gray-800 whitespace-pre-wrap">
                  {streamingMsg}
                  <span className="inline-block w-1.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse rounded-sm" />
                </div>
              </div>
            )}
            {chatLoading && !streamingMsg && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-gray-400">
                  Thinking…
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          <div className="px-3 py-3 border-t border-gray-100 space-y-2">
            {(hasGithubUrl || hasSlackUrl) && (
              <div className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                <span>{hasSlackUrl ? "💬" : "🔗"}</span>
                <span>{hasSlackUrl ? "Slack thread detected — I'll read it via MCP" : "GitHub issue detected — I'll fetch and read it automatically"}</span>
              </div>
            )}
            <div className="flex gap-2">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
                placeholder="Ask anything, or paste a GitHub/Slack URL…"
                disabled={chatLoading}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue disabled:opacity-50" />
              <button onClick={() => sendChat()} disabled={chatLoading || !chatInput.trim()}
                className="bg-elastic-blue text-white px-3 py-2 rounded-xl text-sm font-medium disabled:opacity-50">
                ↑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}