import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCases, getCurrentDuty, importCase, importSlackCase, scanForSDHs, deleteCase } from "../api";
import type { Case, CaseStatus, DutyWeek, Engineer } from "../types";

const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open", pending_customer: "Pending Customer",
  pending_internal: "Pending Internal", resolved: "Resolved",
};
const STATUS_COLOR: Record<CaseStatus, string> = {
  open: "bg-blue-100 text-blue-800", pending_customer: "bg-amber-100 text-amber-800",
  pending_internal: "bg-purple-100 text-purple-800", resolved: "bg-green-100 text-green-800",
};
const PRIORITY_COLOR: Record<string, string> = {
  low: "bg-gray-100 text-gray-600", normal: "bg-sky-100 text-sky-700",
  high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "just now";
}

export default function Dashboard({ engineer }: { engineer: Engineer | null }) {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  async function doDelete(id: number) {
    await deleteCase(id);
    setCases(prev => prev.filter(c => c.id !== id));
    setConfirmDelete(null);
  }

  const navigate = useNavigate();
  const [scanning, setScanning]   = useState(false);
  const [scanLookback, setScanLookback] = useState(7);
  const [scanResult, setScanResult] = useState<{ imported: any[]; skipped: any[]; errors: string[] } | null>(null);

  async function handleScan() {
    setScanning(true); setScanResult(null);
    try {
      const result = await scanForSDHs(engineer?.id, scanLookback);
      setScanResult(result);
      if (result.imported.length > 0) {
        const updated = await getCases();
        setCases(updated);
      }
    } catch (e: any) {
      setScanResult({ imported: [], skipped: [], errors: [e.message] });
    } finally {
      setScanning(false);
    }
  }

  const [cases, setCases]   = useState<Case[]>([]);
  const [duty, setDuty]     = useState<DutyWeek | null>(null);
  const [filter, setFilter] = useState<CaseStatus | "all">("all");
  const [importTab, setImportTab] = useState<"github" | "slack">("github");
  const [ghUrl, setGhUrl]   = useState("");
  const [slackUrl, setSlackUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([getCases(), getCurrentDuty()]).then(([c, d]) => {
      setCases(c); setDuty(d); setLoading(false);
    });
  }, []);

  async function handleImport() {
    if (!ghUrl.trim()) return;
    if (!engineer) { setImportErr("Please select your name first (top right)."); return; }
    setImporting(true); setImportErr("");
    try {
      const c = await importCase(ghUrl.trim(), engineer.id);
      setCases(prev => [c, ...prev]);
      setGhUrl("");
      navigate(`/cases/${c.id}`);
    } catch (e: any) {
      setImportErr(e.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleSlackImport() {
    if (!slackUrl.trim()) return;
    if (!engineer) { setImportErr("Please select your name first (top right)."); return; }
    setImporting(true); setImportErr("");
    try {
      const c = await importSlackCase(slackUrl.trim(), engineer.id);
      setCases(prev => [c, ...prev]);
      setSlackUrl("");
      navigate(`/cases/${c.id}`);
    } catch (e: any) {
      // 409 = already imported — navigate to existing case
      if (e.message?.includes("already imported") || e.message?.includes("409")) {
        const match = e.message.match(/case_id["\s:]+(\d+)/);
        if (match) { navigate(`/cases/${match[1]}`); return; }
      }
      setImportErr(e.message);
    } finally {
      setImporting(false);
    }
  }

  const filtered = filter === "all" ? cases : cases.filter(c => c.status === filter);
  const openCount     = cases.filter(c => c.status === "open").length;
  const pendingCount  = cases.filter(c => c.status === "pending_customer" || c.status === "pending_internal").length;
  const resolvedCount = cases.filter(c => c.status === "resolved").length;

  return (
    <div className="space-y-6">

      {/* ── Page header with SDH board link ── */}
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-xl">Dashboard</h1>
        <div className="flex items-center gap-2">
          <a href="https://github.com/orgs/elastic/projects/1650/views/1" target="_blank" rel="noreferrer"
            className="text-xs flex items-center gap-1.5 bg-gray-900 text-white px-3 py-2 rounded-lg hover:bg-gray-700 transition-colors">
            <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            SDH Project Board ↗
          </a>
          <button onClick={() => navigate("/reports")}
            className="text-xs flex items-center gap-1.5 bg-elastic-blue text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            📊 Weekly Report
          </button>
          <div className="flex items-stretch rounded-lg overflow-hidden">
            <button onClick={handleScan} disabled={scanning}
              className="text-xs flex items-center gap-1.5 bg-elastic-green text-white px-3 py-2 hover:bg-teal-600 disabled:opacity-50 transition-colors">
              {scanning ? "Scanning…" : "🔍 Scan for new SDHs"}
            </button>
            <select
              value={scanLookback}
              onChange={e => setScanLookback(parseInt(e.target.value, 10))}
              disabled={scanning}
              title="How far back to look for DutyHelper messages"
              className="text-xs bg-elastic-green text-white border-l border-teal-700 px-2 hover:bg-teal-600 disabled:opacity-50 cursor-pointer focus:outline-none">
              <option value={7}>7d</option>
              <option value={14}>14d</option>
              <option value={30}>30d</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Scan result banner ── */}
      {scanResult && (
        <div className={`rounded-xl border p-4 text-sm ${
          scanResult.errors.length > 0 ? "bg-red-50 border-red-200" :
          scanResult.imported.length > 0 ? "bg-green-50 border-green-200" :
          "bg-gray-50 border-gray-200"
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              {scanResult.imported.length > 0 && (
                <div className="text-green-800 font-medium">
                  Imported {scanResult.imported.length} new case{scanResult.imported.length !== 1 ? "s" : ""}:
                  {scanResult.imported.map((i: any) => (
                    <span key={i.case_id} className="ml-2 font-normal">{i.title}</span>
                  ))}
                </div>
              )}
              {scanResult.skipped.length > 0 && (
                <div className="text-gray-600">
                  {scanResult.skipped.length} already imported (skipped)
                </div>
              )}
              {scanResult.errors.length > 0 && (
                <div className="text-red-700">
                  {scanResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              {scanResult.imported.length === 0 && scanResult.skipped.length === 0 && scanResult.errors.length === 0 && (
                <div className="text-gray-600">No new SDH assignments found in Slack.</div>
              )}
            </div>
            <button onClick={() => setScanResult(null)} className="text-gray-400 hover:text-gray-600 shrink-0">✕</button>
          </div>
        </div>
      )}

      {/* ── Duty banner ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-elastic-blue text-white flex items-center justify-center font-bold text-lg">
          {duty ? duty.name[0] : "?"}
        </div>
        <div>
          <div className="font-semibold text-sm">
            {duty ? `${duty.name} is on SDH duty this week` : "No one assigned to SDH this week"}
          </div>
          {duty && (
            <div className="text-xs text-gray-400">
              {duty.week_start.split('T')[0]} → {duty.week_end.split('T')[0]} · @{duty.github_handle}
            </div>
          )}
        </div>
        <div className="ml-auto flex gap-4 text-center">
          {([["open", openCount, "text-blue-600"], ["pending", pendingCount, "text-amber-600"], ["resolved", resolvedCount, "text-green-600"]] as const).map(([label, n, cls]) => (
            <div key={label}>
              <div className={`text-2xl font-bold ${cls}`}>{n}</div>
              <div className="text-xs text-gray-400 capitalize">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Import ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        {/* Tab header */}
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => { setImportTab("github"); setImportErr(""); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              importTab === "github"
                ? "bg-elastic-blue text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}>
            GitHub Issue
          </button>
          <button
            onClick={() => { setImportTab("slack"); setImportErr(""); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              importTab === "slack"
                ? "bg-purple-600 text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}>
            💬 Start from Slack Thread
          </button>
        </div>

        {importTab === "github" ? (
          <div className="flex gap-2">
            <input
              value={ghUrl}
              onChange={e => setGhUrl(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleImport()}
              placeholder="https://github.com/elastic/sdh-synthetics/issues/123"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue"
            />
            <button onClick={handleImport} disabled={importing || !ghUrl.trim()}
              className="bg-elastic-blue text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={slackUrl}
                onChange={e => setSlackUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSlackImport()}
                placeholder="https://elastic.slack.com/archives/C.../p..."
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button onClick={handleSlackImport} disabled={importing || !slackUrl.trim()}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap">
                {importing ? "Reading thread…" : "Start Investigation"}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Claude will read the Slack thread, extract the issue, and auto-link any GitHub issue found in the thread.
            </p>
          </div>
        )}

        {importErr && <p className="text-red-500 text-xs mt-2">{importErr}</p>}
      </div>

      {/* ── Filter tabs ── */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "open", "pending_customer", "pending_internal", "resolved"] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filter === s ? "bg-elastic-blue text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {s === "all" ? `All (${cases.length})` : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* ── Cases list ── */}
      {loading ? (
        <div className="text-sm text-gray-400 text-center py-12">Loading cases…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-12">
          {filter === "all" ? "No cases yet — import one above." : `No ${STATUS_LABEL[filter as CaseStatus]} cases.`}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id} className="group relative bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-elastic-blue transition-colors">
              <Link to={`/cases/${c.id}`} className="block">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{c.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {c.github_repo && c.github_issue_num
                        ? <>{c.github_repo} #{c.github_issue_num} · </>
                        : <span className="text-purple-400">💬 Slack · </span>
                      }
                      updated {timeAgo(c.updated_at)}
                      {c.owner_name && ` · ${c.owner_name}`}
                    </div>
                    {c.github_labels?.length > 0 && (
                      <div className="flex gap-1 mt-1.5 flex-wrap">
                        {c.github_labels.map(l => (
                          <span key={l} className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{l}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-2 shrink-0">
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status]}`}>
                        {STATUS_LABEL[c.status]}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLOR[c.priority]}`}>
                        {c.priority}
                      </span>
                    </div>
                    <button
                      onClick={e => { e.preventDefault(); setConfirmDelete(c.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-400 text-xs leading-none mt-1">
                      ✕
                    </button>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
      {/* Confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 text-lg">🗑</div>
              <p className="text-sm text-gray-700 pt-1">Delete this case permanently? All notes and updates will be lost.</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => doDelete(confirmDelete)}
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