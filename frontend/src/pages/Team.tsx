import { useEffect, useState } from "react";
import { getEngineers, createEngineer } from "../api";
import type { Engineer } from "../types";

export default function TeamPage({ onEngineerAdded }: { onEngineerAdded: () => void }) {
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [name, setName]     = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail]   = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");

  async function load() { setEngineers(await getEngineers()); }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name.trim() || !handle.trim()) { setErr("Name and GitHub handle are required."); return; }
    setSaving(true); setErr("");
    try {
      await createEngineer({ name: name.trim(), github_handle: handle.trim(), email: email.trim() || undefined });
      setName(""); setHandle(""); setEmail(""); await load(); onEngineerAdded();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h1 className="font-bold text-xl">Team</h1>
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-sm">Add engineer</h2>
        <div className="grid grid-cols-2 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue col-span-2" />
          <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="GitHub handle (no @)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (optional)"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
        </div>
        {err && <p className="text-red-500 text-xs">{err}</p>}
        <button onClick={add} disabled={saving}
          className="bg-elastic-blue text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? "Adding…" : "Add engineer"}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {engineers.length === 0 ? <p className="text-sm text-gray-400 p-5">No engineers yet.</p>
          : engineers.map(e => (
            <div key={e.id} className="flex items-center gap-3 px-5 py-3">
              <div className="w-8 h-8 rounded-full bg-elastic-blue text-white flex items-center justify-center font-bold text-sm shrink-0">
                {e.name[0]}
              </div>
              <div>
                <div className="font-medium text-sm">{e.name}</div>
                <div className="text-xs text-gray-400">@{e.github_handle}{e.email ? ` · ${e.email}` : ""}</div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
