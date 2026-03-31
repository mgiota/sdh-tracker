import { useEffect, useState } from "react";
import { getDutySchedule, createDutyWeek, getEngineers, syncSchedule } from "../api";
import type { DutyWeek, Engineer } from "../types";

export default function SchedulePage() {
  const [weeks, setWeeks]         = useState<DutyWeek[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [engId, setEngId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd]     = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; errors: string[] } | null>(null);

  async function doSync() {
    setSyncing(true); setSyncResult(null);
    try {
      const result = await syncSchedule();
      setSyncResult(result);
      await load();
    } catch (e: any) {
      setSyncResult({ synced: 0, errors: [e.message] });
    } finally {
      setSyncing(false);
    }
  }

  async function load() {
    const [w, e] = await Promise.all([getDutySchedule(), getEngineers()]);
    setWeeks(w); setEngineers(e);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!engId || !start || !end) { setErr("All fields required."); return; }
    setSaving(true); setErr("");
    try {
      await createDutyWeek({ engineer_id: parseInt(engId), week_start: start, week_end: end });
      setEngId(""); setStart(""); setEnd(""); await load();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-xl">SDH Duty Schedule</h1>
        <button onClick={doSync} disabled={syncing}
          className="text-xs flex items-center gap-1.5 bg-purple-600 text-white px-3 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50">
          {syncing ? "Syncing…" : "💬 Sync from Slack"}
        </button>
      </div>
      {syncResult && (
        <div className={`rounded-xl border p-4 text-sm space-y-1 ${syncResult.errors.length ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
          {syncResult.synced > 0 && (
            <p className="text-green-700 font-medium">✓ Synced {syncResult.synced} duty period{syncResult.synced !== 1 ? "s" : ""} from Slack</p>
          )}
          {syncResult.synced === 0 && syncResult.errors.length === 0 && (
            <p className="text-gray-500">No new schedule entries found in Slack</p>
          )}
          {syncResult.errors.map((e, i) => <p key={i} className="text-amber-700">⚠️ {e}</p>)}
        </div>
      )}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-sm">Assign a duty week</h2>
        <select value={engId} onChange={e => setEngId(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue">
          <option value="">Select engineer…</option>
          {engineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Week start (Monday)</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Week end (Friday)</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
          </div>
        </div>
        {err && <p className="text-red-500 text-xs">{err}</p>}
        <button onClick={add} disabled={saving}
          className="bg-elastic-blue text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? "Saving…" : "Add to schedule"}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {weeks.length === 0 ? <p className="text-sm text-gray-400 p-5">No schedule yet.</p>
          : weeks.map(w => {
            const isNow = new Date(w.week_start) <= new Date() && new Date() <= new Date(w.week_end);
            return (
              <div key={w.id} className={`flex items-center gap-3 px-5 py-3 ${isNow ? "bg-blue-50/40" : ""}`}>
                <div className="w-8 h-8 rounded-full bg-elastic-blue text-white flex items-center justify-center font-bold text-sm shrink-0">
                  {w.name[0]}
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm flex items-center gap-2">
                    {w.name}
                    {isNow && <span className="text-xs bg-elastic-blue text-white px-1.5 py-0.5 rounded-full">This week</span>}
                  </div>
                  <div className="text-xs text-gray-400">
                  {new Date(w.week_start).toISOString().split('T')[0]} → {new Date(w.week_end).toISOString().split('T')[0]}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
