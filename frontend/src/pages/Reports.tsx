import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getWeeklyReport, deleteWeeklyReport } from "../api";

function getMonday(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // if Sunday go back 6, otherwise go to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

const STATUS_COLOR: Record<string, string> = {
  open:             "bg-blue-100 text-blue-800",
  pending_customer: "bg-amber-100 text-amber-800",
  pending_internal: "bg-purple-100 text-purple-800",
  resolved:         "bg-green-100 text-green-800",
};

export default function ReportsPage() {
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [report, setReport]       = useState<any>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [copied, setCopied]       = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Load cached report on mount and whenever week changes
  useEffect(() => {
    (async () => {
      setLoading(true); setReport(null); setError("");
      try {
        const data = await getWeeklyReport(weekStart, false);
        setReport(data);
      } catch { setReport(null); }
      finally { setLoading(false); }
    })();
  }, [weekStart]);

  async function generate(refresh = false) {
    setLoading(true); setError("");
    try {
      const data = await getWeeklyReport(weekStart, refresh);
      setReport(data);
    } catch (e: any) {
      if (refresh) setError(e.message);
      else setReport(null);
    } finally {
      setLoading(false);
    }
  }

  async function doDelete() {
    await deleteWeeklyReport(weekStart);
    setReport(null);
    setConfirmDelete(false);
  }

  function copyMarkdown() {
    navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function downloadMarkdown() {
    const blob = new Blob([report.markdown], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `sdh-report-${weekStart}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const weekEnd = addDays(weekStart, 6);

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-bold text-xl">Weekly SDH Report</h1>

      {/* Week picker */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-end gap-4">
        <div className="flex-1">
          <label className="text-xs text-gray-500 block mb-1">Week starting (Monday)</label>
          <input type="date" value={weekStart}
            onChange={e => { setWeekStart(e.target.value); setReport(null); setError(""); }}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
          <div className="text-xs text-gray-400 mt-1">{weekStart} → {weekEnd}</div>
        </div>
        <button onClick={() => generate(true)} disabled={loading}
          className="bg-elastic-blue text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
          {loading ? "Generating…" : "↻ Regenerate"}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-2xl mb-2">✨</div>
          <p className="text-sm text-gray-500">Generating report and AI narrative…</p>
          <p className="text-xs text-gray-400 mt-1">This may take up to 30 seconds</p>
        </div>
      )}

      {!loading && !report && (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center space-y-3">
          <div className="text-3xl">📋</div>
          <p className="text-sm font-medium text-gray-600">No report for this week yet</p>
          <p className="text-xs text-gray-400">Click <strong>↻ Regenerate</strong> to generate one</p>
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-gray-700">
              Report for {report.week_start} → {report.week_end}
              {report.duty && <span className="text-gray-400 font-normal"> · {report.duty.name} on duty</span>}
              {report.cached && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">cached</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={copyMarkdown}
                className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                {copied ? "✓ Copied!" : "📋 Copy Markdown"}
              </button>
              <button onClick={downloadMarkdown}
                className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                ⬇ Download .md
              </button>
              <button onClick={() => setConfirmDelete(true)}
                className="text-xs border border-red-200 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-50">
                🗑 Delete
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {([
              ["Opened",   report.opened.length,     "text-blue-600",  "bg-blue-50"],
              ["Resolved", report.resolved.length,   "text-green-600", "bg-green-50"],
              ["Pending",  report.still_open.length, "text-amber-600", "bg-amber-50"],
            ] as [string, number, string, string][]).map(([label, n, cls, bg]) => (
              <div key={label} className={`${bg} rounded-xl p-4 text-center`}>
                <div className={`text-3xl font-bold ${cls}`}>{n}</div>
                <div className="text-xs text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* AI Narrative */}
          {report.narrative && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-sm font-semibold mb-3">✨ AI Narrative</div>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{report.narrative}</p>
            </div>
          )}

          {/* Opened */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-sm mb-3">Cases Opened This Week ({report.opened.length})</h2>
            {report.opened.length === 0 ? <p className="text-sm text-gray-400">None</p> :
              <div className="space-y-2">
                {report.opened.map((c: any) => (
                  <Link key={c.id} to={`/cases/${c.id}`}
                    className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 py-1.5 -mx-2 transition-colors">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOR[c.status]}`}>
                      {c.status.replace("_", " ")}
                    </span>
                    <span className="text-sm text-gray-800 flex-1 truncate">{c.title}</span>
                    <span className="text-xs text-gray-400 shrink-0">{c.owner_name ?? "Unassigned"}</span>
                  </Link>
                ))}
              </div>
            }
          </div>

          {/* Resolved */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-sm mb-3">Cases Resolved This Week ({report.resolved.length})</h2>
            {report.resolved.length === 0 ? <p className="text-sm text-gray-400">None</p> :
              <div className="space-y-2">
                {report.resolved.map((c: any) => (
                  <Link key={c.id} to={`/cases/${c.id}`}
                    className="flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 py-1.5 -mx-2 transition-colors">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0 bg-green-100 text-green-800">resolved</span>
                    <span className="text-sm text-gray-800 flex-1 truncate">{c.title}</span>
                  </Link>
                ))}
              </div>
            }
          </div>

          {/* Still open */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="font-semibold text-sm mb-3">Still Open / Pending ({report.still_open.length})</h2>
            {report.still_open.length === 0 ? <p className="text-sm text-gray-400">None</p> :
              <div className="space-y-2">
                {report.still_open.map((c: any) => {
                  const s = (() => { try { return c.ai_summary ? JSON.parse(c.ai_summary) : null; } catch { return null; } })();
                  return (
                    <Link key={c.id} to={`/cases/${c.id}`}
                      className="block hover:bg-gray-50 rounded-lg px-2 py-2 -mx-2 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLOR[c.status]}`}>
                          {c.status.replace("_", " ")}
                        </span>
                        <span className="text-sm text-gray-800 flex-1 truncate">{c.title}</span>
                        <span className="text-xs text-gray-400 shrink-0">{c.owner_name ?? "Unassigned"}</span>
                      </div>
                      {s?.next_steps && (
                        <p className="text-xs text-gray-500 mt-1 ml-1">👉 {s.next_steps}</p>
                      )}
                    </Link>
                  );
                })}
              </div>
            }
          </div>

          {/* Handovers */}
          {report.handovers.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold text-sm mb-3">Handovers ({report.handovers.length})</h2>
              <div className="space-y-3">
                {report.handovers.map((h: any) => (
                  <div key={h.id} className="border border-amber-100 bg-amber-50/40 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">
                      <span className="font-medium text-gray-700">{h.from_name}</span>
                      {h.to_name && <> → <span className="font-medium text-gray-700">{h.to_name}</span></>}
                      <span className="text-gray-400"> · {h.case_title}</span>
                    </div>
                    <p className="text-sm text-gray-800">{h.summary}</p>
                    {h.next_steps && <p className="text-xs text-gray-500 mt-1">👉 {h.next_steps}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-lg">🗑</div>
              <p className="text-sm text-gray-700 pt-1">Delete the report for {weekStart}? This cannot be undone.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={doDelete}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}