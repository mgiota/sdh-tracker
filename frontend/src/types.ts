export type CaseStatus = "open" | "pending_customer" | "pending_internal" | "resolved";
export type Priority   = "low" | "normal" | "high" | "critical";

export interface Engineer {
  id: number;
  name: string;
  github_handle: string;
  email?: string;
}

export interface Case {
  id: number;
  github_url: string;
  github_issue_num: number;
  github_repo: string;
  title: string;
  body: string;
  status: CaseStatus;
  priority: Priority;
  owner_name?: string;
  owner_handle?: string;
  current_owner_id?: number;
  github_author: string;
  github_labels: string[];
  ai_summary?: string;
  ai_summary_at?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

export interface GithubComment {
  id: number;
  github_id: number;
  author: string;
  body: string;
  is_elastic: boolean;
  posted_at: string;
}

export interface CaseUpdate {
  id: number;
  engineer_name?: string;
  update_type: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface SlackLink {
  id: number;
  url: string;
  description: string;
  added_by?: string;
  fetched_at?: string;
  ai_summary?: string;
  ai_summary_at?: string;
  created_at: string;
}

export interface Handover {
  id: number;
  from_name?: string;
  to_name?: string;
  summary: string;
  next_steps?: string;
  week_start: string;
  created_at: string;
}

export interface CaseDetail extends Case {
  github_comments: GithubComment[];
  updates: CaseUpdate[];
  slack_links: SlackLink[];
  handovers: Handover[];
}

export interface SimilarCase {
  id: number;
  title: string;
  github_url: string;
  status: string;
  similarity_explanation: string;
  source: "local" | "github";
}

export interface DutyWeek {
  id: number;
  name: string;
  github_handle: string;
  week_start: string;
  week_end: string;
}