const GH_API = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN;

const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels: { name: string }[];
  user: { login: string };
  created_at: string;
}

export interface GithubComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export function parseIssueUrl(url: string): { owner: string; repo: string; number: number } {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!m) throw new Error(`Invalid GitHub issue URL: ${url}`);
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

export async function fetchIssue(owner: string, repo: string, num: number): Promise<GithubIssue> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/issues/${num}`, { headers });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchComments(owner: string, repo: string, num: number): Promise<GithubComment[]> {
  const all: GithubComment[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${GH_API}/repos/${owner}/${repo}/issues/${num}/comments?per_page=100&page=${page}`,
      { headers }
    );
    if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
    const batch: GithubComment[] = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

export async function isElasticMember(login: string): Promise<boolean> {
  try {
    const res = await fetch(`${GH_API}/orgs/elastic/members/${login}`, { headers });
    return res.status === 204;
  } catch {
    return false;
  }
}
