import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getEngineers } from "./api";
import type { Engineer } from "./types";
import Dashboard from "./pages/Dashboard";
import CaseDetailPage from "./pages/CaseDetail";
import TeamPage from "./pages/Team";
import SchedulePage from "./pages/Schedule";
import ReportsPage from "./pages/Reports";

const STORAGE_KEY = "sdh_current_engineer";

export default function App() {
  const [engineer, setEngineer] = useState<Engineer | null>(null);
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [picking, setPicking]   = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getEngineers().then(list => {
      setEngineers(list);
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const found = list.find(e => e.id === parseInt(stored));
        if (found) { setEngineer(found); return; }
      }
      if (list.length > 0) setPicking(true);
    });
  }, []);

  function pick(e: Engineer) {
    localStorage.setItem(STORAGE_KEY, String(e.id));
    setEngineer(e);
    setPicking(false);
  }

  const nav = "px-3 py-2 rounded text-sm font-medium transition-colors";
  const active = "bg-elastic-blue text-white";
  const inactive = "text-gray-600 hover:bg-gray-100";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-lg tracking-tight text-elastic-blue">
          🛡️ SDH Tracker
        </span>
        <nav className="flex gap-1">
          <NavLink to="/"        className={({isActive}) => `${nav} ${isActive ? active : inactive}`}>Dashboard</NavLink>
          <NavLink to="/team"    className={({isActive}) => `${nav} ${isActive ? active : inactive}`}>Team</NavLink>
          <NavLink to="/schedule" className={({isActive}) => `${nav} ${isActive ? active : inactive}`}>Schedule</NavLink>
          <NavLink to="/reports"  className={({isActive}) => `${nav} ${isActive ? active : inactive}`}>Reports</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
          {engineer ? (
            <>
              <span>You are <strong>{engineer.name}</strong></span>
              <button onClick={() => setPicking(true)} className="text-elastic-blue underline text-xs">change</button>
            </>
          ) : (
            <button onClick={() => setPicking(true)} className="text-elastic-blue underline">Set your name</button>
          )}
        </div>
      </header>

      {/* Who are you modal */}
      {picking && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80">
            <h2 className="font-bold text-lg mb-1">Who are you?</h2>
            <p className="text-sm text-gray-500 mb-4">Pick your name to track your updates.</p>
            {engineers.length === 0 ? (
              <div>
                <p className="text-sm text-amber-600 mb-3">No engineers added yet.</p>
                <button
                  onClick={() => { setPicking(false); navigate("/team"); }}
                  className="w-full bg-elastic-blue text-white rounded-lg py-2 text-sm font-medium"
                >Go to Team setup</button>
              </div>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {engineers.map(e => (
                  <li key={e.id}>
                    <button
                      onClick={() => pick(e)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm flex items-center gap-2"
                    >
                      <span className="w-7 h-7 rounded-full bg-elastic-blue text-white flex items-center justify-center text-xs font-bold">
                        {e.name[0]}
                      </span>
                      <div>
                        <div className="font-medium">{e.name}</div>
                        <div className="text-gray-400 text-xs">@{e.github_handle}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 px-6 py-6 max-w-6xl mx-auto w-full">
        <Routes>
          <Route path="/"         element={<Dashboard engineer={engineer} />} />
          <Route path="/cases/:id" element={<CaseDetailPage engineer={engineer} />} />
          <Route path="/team"     element={<TeamPage onEngineerAdded={() => getEngineers().then(setEngineers)} />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/reports"  element={<ReportsPage />} />
        </Routes>
      </main>
    </div>
  );
}