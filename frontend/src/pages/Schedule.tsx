import { useEffect, useState } from "react";
import { getDutySchedule, createDutyWeek, getEngineers } from "../api";
import type { DutyWeek, Engineer } from "../types";

export default function SchedulePage() {
  const [weeks, setWeeks]         = useState<DutyWeek[]>([]);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [engId, setEngId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd]     = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");

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
      <h1 className="font-bold text-xl">SDH Duty Schedule</h1>
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
                  <div className="text-xs text-gray-400">{w.week_start} → {w.week_end}</div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
