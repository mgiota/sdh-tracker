import type { Case, CaseDetail, Engineer, DutyWeek } from "./types";

const BASE = "/api";

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

// Cases
export const getCases   = ()         => req<Case[]>("/cases");
export const getCase    = (id: number) => req<CaseDetail>(`/cases/${id}`);
export const importCase = (github_url: string, engineer_id: number) =>
  req<Case>("/cases/import", { method: "POST", body: JSON.stringify({ github_url, engineer_id }) });
export const importSlackCase = (slack_url: string, engineer_id: number) =>
  req<Case>("/cases/import-slack", { method: "POST", body: JSON.stringify({ slack_url, engineer_id }) });
export const refreshCase = (id: number) =>
  req<{ new_comments: number }>(`/cases/${id}/refresh`, { method: "POST" });
export const updateCase = (id: number, patch: Record<string, unknown>) =>
  req(`/cases/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const addUpdate  = (id: number, body: Record<string, unknown>) =>
  req(`/cases/${id}/updates`, { method: "POST", body: JSON.stringify(body) });
export const addHandover = (id: number, body: Record<string, unknown>) =>
  req(`/cases/${id}/handover`, { method: "POST", body: JSON.stringify(body) });

export const summarizeCase = (id: number) =>
  req(`/cases/${id}/summarize`, { method: "POST" });

export const deleteUpdate    = (caseId: number, updateId: number) =>
  req(`/cases/${caseId}/updates/${updateId}`, { method: "DELETE" });
export const deleteSlackLink = (caseId: number, linkId: number) =>
  req(`/cases/${caseId}/slack-links/${linkId}`, { method: "DELETE" });

// Slack
export const fetchSlackThread = (caseId: number, linkId: number) =>
  req<{ fetched: number }>(`/cases/${caseId}/slack-links/${linkId}/fetch`, { method: "POST" });
export const getSlackMessages = (caseId: number, linkId: number) =>
  req<any[]>(`/cases/${caseId}/slack-links/${linkId}/messages`);

// Slack
export const summarizeSlackThread = (caseId: number, linkId: number) =>
  req<any>(`/cases/${caseId}/slack-links/${linkId}/summarize`, { method: "POST" });

export const getSimilarCases  = (id: number, source: "local" | "github" = "local") =>
  req<import("./types").SimilarCase[]>(`/cases/${id}/similar`, { method: "POST", body: JSON.stringify({ source }) });

export const deleteCase       = (id: number) =>
  req(`/cases/${id}`, { method: "DELETE" });
export const updateGithubUrl  = (id: number, github_url: string) =>
  req(`/cases/${id}/github-url`, { method: "PATCH", body: JSON.stringify({ github_url }) });

// Scan
export const scanForSDHs = (engineer_id?: number, lookback_days?: number) =>
  req<{ imported: any[]; skipped: any[]; errors: string[] }>("/scan", {
    method: "POST",
    body: JSON.stringify({ engineer_id, lookback_days }),
  });

// Schedule sync
export const syncSchedule = () =>
  req<{ synced: number; errors: string[] }>("/schedule/sync", { method: "POST" });

// Reports
export const getWeeklyReport    = (weekStart: string, refresh = false) =>
  req<any>(`/reports/weekly?week_start=${weekStart}${refresh ? "&refresh=true" : ""}`);
export const deleteWeeklyReport = (weekStart: string) =>
  req(`/reports/weekly?week_start=${weekStart}`, { method: "DELETE" });

// Chat
export const getChatHistory = (id: number) => req<any[]>(`/cases/${id}/chat`);

export const getEngineers  = ()    => req<Engineer[]>("/engineers");
export const createEngineer = (body: { name: string; github_handle: string; email?: string }) =>
  req<Engineer>("/engineers", { method: "POST", body: JSON.stringify(body) });

// Duty
export const getCurrentDuty = () => req<DutyWeek | null>("/duty/current");
export const getDutySchedule = () => req<DutyWeek[]>("/duty");
export const createDutyWeek  = (body: Record<string, unknown>) =>
  req<DutyWeek>("/duty", { method: "POST", body: JSON.stringify(body) });