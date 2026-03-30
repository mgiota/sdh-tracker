#!/usr/bin/env bash
set -e

echo "🚀 Setting up SDH Tracker..."

# ── Root ──────────────────────────────────────────────────────────────────────
mkdir -p sdh-tracker
cd sdh-tracker

cat > .env.example << 'EOF'
GITHUB_TOKEN=ghp_your_token_here
EOF

cat > docker-compose.yml << 'EOF'
version: "3.9"

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: sdh
      POSTGRES_PASSWORD: sdhpassword
      POSTGRES_DB: sdhtracker
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sdh -d sdhtracker"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build: ./backend
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://sdh:sdhpassword@db:5432/sdhtracker
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      PORT: 3001
    ports:
      - "3001:3001"
    volumes:
      - ./backend:/app
      - /app/node_modules

  frontend:
    build: ./frontend
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      VITE_API_URL: http://localhost:3001
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules

volumes:
  pgdata:
EOF

# ── Backend ───────────────────────────────────────────────────────────────────
mkdir -p backend/src/{db,routes,services}

cat > backend/Dockerfile << 'EOF'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["npm", "run", "dev"]
EOF

cat > backend/package.json << 'EOF'
{
  "name": "sdh-tracker-backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "@types/pg": "^8.10.9",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.3.3"
  }
}
EOF

cat > backend/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
EOF

# ── backend/src/index.ts ──────────────────────────────────────────────────────
cat > backend/src/index.ts << 'EOF'
import express from "express";
import cors from "cors";
import { initDb } from "./db/client";
import casesRouter from "./routes/cases";
import { engineersRouter } from "./routes/engineers";
import { dutyRouter } from "./routes/duty";
import { handoversRouter } from "./routes/handovers";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_, res) => res.json({ status: "ok" }));

app.use("/api/cases", casesRouter);
app.use("/api/engineers", engineersRouter);
app.use("/api/duty", dutyRouter);
app.use("/api/handovers", handoversRouter);

initDb().then(() => {
  app.listen(PORT, () => console.log(`SDH backend running on :${PORT}`));
}).catch((err) => {
  console.error("Failed to initialise DB:", err);
  process.exit(1);
});
EOF

# ── backend/src/db/client.ts ──────────────────────────────────────────────────
cat > backend/src/db/client.ts << 'EOF'
import { Pool } from "pg";
import fs from "fs";
import path from "path";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initDb() {
  const schema = fs.readFileSync(
    path.join(__dirname, "schema.sql"),
    "utf8"
  );
  await pool.query(schema);
  console.log("DB schema applied");
}
EOF

# ── backend/src/db/schema.sql ─────────────────────────────────────────────────
cat > backend/src/db/schema.sql << 'EOF'
CREATE TABLE IF NOT EXISTS engineers (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  github_handle VARCHAR(100) UNIQUE NOT NULL,
  email         VARCHAR(200),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duty_weeks (
  id          SERIAL PRIMARY KEY,
  engineer_id INTEGER REFERENCES engineers(id),
  week_start  DATE NOT NULL,
  week_end    DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cases (
  id                SERIAL PRIMARY KEY,
  github_url        TEXT NOT NULL UNIQUE,
  github_issue_num  INTEGER NOT NULL,
  github_repo       VARCHAR(200) NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  status            VARCHAR(50) NOT NULL DEFAULT 'open',
  priority          VARCHAR(20) DEFAULT 'normal',
  opened_by_id      INTEGER REFERENCES engineers(id),
  current_owner_id  INTEGER REFERENCES engineers(id),
  github_author     VARCHAR(100),
  github_labels     TEXT[],
  ai_summary        TEXT,
  ai_summary_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS github_comments (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  github_id   BIGINT UNIQUE NOT NULL,
  author      VARCHAR(100),
  body        TEXT,
  is_elastic  BOOLEAN DEFAULT FALSE,
  posted_at   TIMESTAMPTZ,
  fetched_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_updates (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  engineer_id INTEGER REFERENCES engineers(id),
  update_type VARCHAR(50) NOT NULL,
  content     TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slack_links (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  description TEXT,
  added_by_id INTEGER REFERENCES engineers(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS handovers (
  id               SERIAL PRIMARY KEY,
  case_id          INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  from_engineer_id INTEGER REFERENCES engineers(id),
  to_engineer_id   INTEGER REFERENCES engineers(id),
  summary          TEXT NOT NULL,
  next_steps       TEXT,
  week_start       DATE NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cases_status      ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_owner       ON cases(current_owner_id);
CREATE INDEX IF NOT EXISTS idx_case_updates_case ON case_updates(case_id);
CREATE INDEX IF NOT EXISTS idx_handovers_case    ON handovers(case_id);
CREATE INDEX IF NOT EXISTS idx_duty_week_start   ON duty_weeks(week_start);
EOF

# ── backend/src/services/github.ts ───────────────────────────────────────────
cat > backend/src/services/github.ts << 'EOF'
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
EOF

# ── backend/src/routes/cases.ts ───────────────────────────────────────────────
cat > backend/src/routes/cases.ts << 'EOF'
import { Router, Request, Response } from "express";
import { pool } from "../db/client";
import { parseIssueUrl, fetchIssue, fetchComments, isElasticMember } from "../services/github";

const router = Router();

router.get("/", async (_, res: Response) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, e.name AS owner_name, e.github_handle AS owner_handle
      FROM cases c
      LEFT JOIN engineers e ON e.id = c.current_owner_id
      ORDER BY c.updated_at DESC
    `);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/import", async (req: Request, res: Response) => {
  const { github_url, engineer_id } = req.body;
  if (!github_url) return res.status(400).json({ error: "github_url required" });
  try {
    const { owner, repo, number } = parseIssueUrl(github_url);
    const repoPath = `${owner}/${repo}`;
    const existing = await pool.query("SELECT id FROM cases WHERE github_url = $1", [github_url]);
    if (existing.rows.length) {
      return res.status(409).json({ error: "Case already imported", case_id: existing.rows[0].id });
    }
    const issue = await fetchIssue(owner, repo, number);
    const comments = await fetchComments(owner, repo, number);
    const { rows } = await pool.query(
      `INSERT INTO cases
        (github_url, github_issue_num, github_repo, title, body, status,
         github_author, github_labels, opened_by_id, current_owner_id)
       VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$8)
       RETURNING *`,
      [github_url, number, repoPath, issue.title, issue.body ?? "",
       issue.user.login, issue.labels.map((l) => l.name), engineer_id ?? null]
    );
    const caseId = rows[0].id;
    for (const c of comments) {
      const elastic = await isElasticMember(c.user.login).catch(() => false);
      await pool.query(
        `INSERT INTO github_comments (case_id, github_id, author, body, is_elastic, posted_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (github_id) DO NOTHING`,
        [caseId, c.id, c.user.login, c.body, elastic, c.created_at]
      );
    }
    if (engineer_id) {
      await pool.query(
        `INSERT INTO case_updates (case_id, engineer_id, update_type, content)
         VALUES ($1,$2,'note',$3)`,
        [caseId, engineer_id, `Case imported from GitHub issue #${number}`]
      );
    }
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, e.name AS owner_name, e.github_handle AS owner_handle
       FROM cases c LEFT JOIN engineers e ON e.id = c.current_owner_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const [comments, updates, slackLinks, handovers] = await Promise.all([
      pool.query("SELECT * FROM github_comments WHERE case_id=$1 ORDER BY posted_at ASC", [req.params.id]),
      pool.query(
        `SELECT u.*, e.name AS engineer_name FROM case_updates u
         LEFT JOIN engineers e ON e.id = u.engineer_id
         WHERE u.case_id=$1 ORDER BY u.created_at ASC`, [req.params.id]
      ),
      pool.query(
        `SELECT s.*, e.name AS added_by FROM slack_links s
         LEFT JOIN engineers e ON e.id = s.added_by_id
         WHERE s.case_id=$1 ORDER BY s.created_at ASC`, [req.params.id]
      ),
      pool.query(
        `SELECT h.*, f.name AS from_name, t.name AS to_name
         FROM handovers h
         LEFT JOIN engineers f ON f.id = h.from_engineer_id
         LEFT JOIN engineers t ON t.id = h.to_engineer_id
         WHERE h.case_id=$1 ORDER BY h.created_at ASC`, [req.params.id]
      ),
    ]);
    res.json({
      ...rows[0],
      github_comments: comments.rows,
      updates: updates.rows,
      slack_links: slackLinks.rows,
      handovers: handovers.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  const { status, current_owner_id, priority, engineer_id } = req.body;
  try {
    const prev = await pool.query("SELECT status FROM cases WHERE id=$1", [req.params.id]);
    if (!prev.rows.length) return res.status(404).json({ error: "Not found" });
    await pool.query(
      `UPDATE cases SET
        status = COALESCE($1, status),
        current_owner_id = COALESCE($2, current_owner_id),
        priority = COALESCE($3, priority),
        updated_at = NOW(),
        resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE id = $4`,
      [status ?? null, current_owner_id ?? null, priority ?? null, req.params.id]
    );
    if (status && status !== prev.rows[0].status && engineer_id) {
      await pool.query(
        `INSERT INTO case_updates (case_id, engineer_id, update_type, content, metadata)
         VALUES ($1,$2,'status_change',$3,$4)`,
        [req.params.id, engineer_id, `Status changed to ${status}`,
         JSON.stringify({ old_status: prev.rows[0].status, new_status: status })]
      );
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/refresh", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const { github_repo, github_issue_num } = rows[0];
    const [owner, repo] = github_repo.split("/");
    const comments = await fetchComments(owner, repo, github_issue_num);
    let newCount = 0;
    for (const c of comments) {
      const elastic = await isElasticMember(c.user.login).catch(() => false);
      const r = await pool.query(
        `INSERT INTO github_comments (case_id, github_id, author, body, is_elastic, posted_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (github_id) DO NOTHING`,
        [req.params.id, c.id, c.user.login, c.body, elastic, c.created_at]
      );
      if (r.rowCount) newCount++;
    }
    await pool.query("UPDATE cases SET updated_at=NOW() WHERE id=$1", [req.params.id]);
    res.json({ new_comments: newCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/updates", async (req: Request, res: Response) => {
  const { engineer_id, update_type, content, metadata } = req.body;
  if (!engineer_id || !update_type || !content)
    return res.status(400).json({ error: "engineer_id, update_type, content required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_updates (case_id, engineer_id, update_type, content, metadata)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, engineer_id, update_type, content, metadata ? JSON.stringify(metadata) : null]
    );
    await pool.query("UPDATE cases SET updated_at=NOW() WHERE id=$1", [req.params.id]);
    if (update_type === "slack_link" && metadata?.url) {
      await pool.query(
        `INSERT INTO slack_links (case_id, url, description, added_by_id) VALUES ($1,$2,$3,$4)`,
        [req.params.id, metadata.url, content, engineer_id]
      );
    }
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/handover", async (req: Request, res: Response) => {
  const { from_engineer_id, to_engineer_id, summary, next_steps, week_start } = req.body;
  if (!from_engineer_id || !summary || !week_start)
    return res.status(400).json({ error: "from_engineer_id, summary, week_start required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO handovers (case_id, from_engineer_id, to_engineer_id, summary, next_steps, week_start)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.id, from_engineer_id, to_engineer_id ?? null, summary, next_steps ?? null, week_start]
    );
    await pool.query(
      `INSERT INTO case_updates (case_id, engineer_id, update_type, content)
       VALUES ($1,$2,'handover','Handover notes written')`,
      [req.params.id, from_engineer_id]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
EOF

# ── backend/src/routes/engineers.ts ──────────────────────────────────────────
cat > backend/src/routes/engineers.ts << 'EOF'
import { Router } from "express";
import { pool } from "../db/client";

export const engineersRouter = Router();

engineersRouter.get("/", async (_, res) => {
  const { rows } = await pool.query("SELECT * FROM engineers ORDER BY name");
  res.json(rows);
});

engineersRouter.post("/", async (req, res) => {
  const { name, github_handle, email } = req.body;
  if (!name || !github_handle)
    return res.status(400).json({ error: "name and github_handle required" });
  try {
    const { rows } = await pool.query(
      "INSERT INTO engineers (name, github_handle, email) VALUES ($1,$2,$3) RETURNING *",
      [name, github_handle, email ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
EOF

# ── backend/src/routes/duty.ts ────────────────────────────────────────────────
cat > backend/src/routes/duty.ts << 'EOF'
import { Router } from "express";
import { pool } from "../db/client";

export const dutyRouter = Router();

dutyRouter.get("/current", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, e.name, e.github_handle FROM duty_weeks d
     JOIN engineers e ON e.id = d.engineer_id
     WHERE week_start <= CURRENT_DATE AND week_end >= CURRENT_DATE
     LIMIT 1`
  );
  res.json(rows[0] ?? null);
});

dutyRouter.get("/", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT d.*, e.name, e.github_handle FROM duty_weeks d
     JOIN engineers e ON e.id = d.engineer_id
     ORDER BY week_start DESC`
  );
  res.json(rows);
});

dutyRouter.post("/", async (req, res) => {
  const { engineer_id, week_start, week_end, notes } = req.body;
  if (!engineer_id || !week_start || !week_end)
    return res.status(400).json({ error: "engineer_id, week_start, week_end required" });
  try {
    const { rows } = await pool.query(
      "INSERT INTO duty_weeks (engineer_id, week_start, week_end, notes) VALUES ($1,$2,$3,$4) RETURNING *",
      [engineer_id, week_start, week_end, notes ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
EOF

# ── backend/src/routes/handovers.ts ──────────────────────────────────────────
cat > backend/src/routes/handovers.ts << 'EOF'
import { Router } from "express";
import { pool } from "../db/client";

export const handoversRouter = Router();

handoversRouter.get("/pending", async (_, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.status, c.github_url,
            e.name AS owner_name,
            (SELECT created_at FROM handovers h WHERE h.case_id = c.id ORDER BY created_at DESC LIMIT 1)
              AS last_handover_at
     FROM cases c
     LEFT JOIN engineers e ON e.id = c.current_owner_id
     WHERE c.status != 'resolved'
     ORDER BY c.updated_at DESC`
  );
  res.json(rows);
});
EOF

# ── Frontend ──────────────────────────────────────────────────────────────────
mkdir -p frontend/src/pages

cat > frontend/Dockerfile << 'EOF'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
EOF

cat > frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SDH Tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

cat > frontend/package.json << 'EOF'
{
  "name": "sdh-tracker-frontend",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "react-markdown": "^9.0.1"
  },
  "devDependencies": {
    "@types/react": "^18.2.55",
    "@types/react-dom": "^18.2.19",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.35",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3",
    "vite": "^5.1.0"
  }
}
EOF

cat > frontend/vite.config.ts << 'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
EOF

cat > frontend/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
EOF

cat > frontend/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        elastic: {
          blue:  "#0077CC",
          pink:  "#F04E98",
          green: "#00BFB3",
        },
      },
    },
  },
  plugins: [],
};
EOF

cat > frontend/postcss.config.js << 'EOF'
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
EOF

cat > frontend/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-gray-50 text-gray-900;
}
EOF

cat > frontend/src/main.tsx << 'EOF'
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
EOF

cat > frontend/src/types.ts << 'EOF'
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

export interface DutyWeek {
  id: number;
  name: string;
  github_handle: string;
  week_start: string;
  week_end: string;
}
EOF

cat > frontend/src/api.ts << 'EOF'
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

export const getCases    = ()          => req<Case[]>("/cases");
export const getCase     = (id: number) => req<CaseDetail>(`/cases/${id}`);
export const importCase  = (github_url: string, engineer_id: number) =>
  req<Case>("/cases/import", { method: "POST", body: JSON.stringify({ github_url, engineer_id }) });
export const refreshCase = (id: number) =>
  req<{ new_comments: number }>(`/cases/${id}/refresh`, { method: "POST" });
export const updateCase  = (id: number, patch: Record<string, unknown>) =>
  req(`/cases/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
export const addUpdate   = (id: number, body: Record<string, unknown>) =>
  req(`/cases/${id}/updates`, { method: "POST", body: JSON.stringify(body) });
export const addHandover = (id: number, body: Record<string, unknown>) =>
  req(`/cases/${id}/handover`, { method: "POST", body: JSON.stringify(body) });

export const getEngineers   = ()     => req<Engineer[]>("/engineers");
export const createEngineer = (body: { name: string; github_handle: string; email?: string }) =>
  req<Engineer>("/engineers", { method: "POST", body: JSON.stringify(body) });

export const getCurrentDuty  = ()    => req<DutyWeek | null>("/duty/current");
export const getDutySchedule = ()    => req<DutyWeek[]>("/duty");
export const createDutyWeek  = (body: Record<string, unknown>) =>
  req<DutyWeek>("/duty", { method: "POST", body: JSON.stringify(body) });
EOF

# App.tsx
cat > frontend/src/App.tsx << 'EOF'
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { getEngineers } from "./api";
import type { Engineer } from "./types";
import Dashboard from "./pages/Dashboard";
import CaseDetailPage from "./pages/CaseDetail";
import TeamPage from "./pages/Team";
import SchedulePage from "./pages/Schedule";

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
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-lg tracking-tight text-elastic-blue">🛡️ SDH Tracker</span>
        <nav className="flex gap-1">
          <NavLink to="/"         className={({isActive}) => `${nav} ${isActive ? active : inactive}`}>Dashboard</NavLink>
          <NavLink to="/team"     className={({isActive}) => `${nav} ${isActive ? active : inactive}`}>Team</NavLink>
          <NavLink to="/schedule" className={({isActive}) => `${nav} ${isActive ? active : inactive}`}>Schedule</NavLink>
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

      {picking && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80">
            <h2 className="font-bold text-lg mb-1">Who are you?</h2>
            <p className="text-sm text-gray-500 mb-4">Pick your name to track your updates.</p>
            {engineers.length === 0 ? (
              <div>
                <p className="text-sm text-amber-600 mb-3">No engineers added yet.</p>
                <button onClick={() => { setPicking(false); navigate("/team"); }}
                  className="w-full bg-elastic-blue text-white rounded-lg py-2 text-sm font-medium">
                  Go to Team setup
                </button>
              </div>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {engineers.map(e => (
                  <li key={e.id}>
                    <button onClick={() => pick(e)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 text-sm flex items-center gap-2">
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
          <Route path="/"          element={<Dashboard engineer={engineer} />} />
          <Route path="/cases/:id" element={<CaseDetailPage engineer={engineer} />} />
          <Route path="/team"      element={<TeamPage onEngineerAdded={() => getEngineers().then(setEngineers)} />} />
          <Route path="/schedule"  element={<SchedulePage />} />
        </Routes>
      </main>
    </div>
  );
}
EOF

# Pages - Dashboard
cat > frontend/src/pages/Dashboard.tsx << 'EOF'
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getCases, getCurrentDuty, importCase } from "../api";
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
  const [cases, setCases]   = useState<Case[]>([]);
  const [duty, setDuty]     = useState<DutyWeek | null>(null);
  const [filter, setFilter] = useState<CaseStatus | "all">("all");
  const [ghUrl, setGhUrl]   = useState("");
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
    } catch (e: any) {
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
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-elastic-blue text-white flex items-center justify-center font-bold text-lg">
          {duty ? duty.name[0] : "?"}
        </div>
        <div>
          <div className="font-semibold text-sm">
            {duty ? `${duty.name} is on SDH duty this week` : "No one assigned to SDH this week"}
          </div>
          {duty && <div className="text-xs text-gray-400">{duty.week_start} → {duty.week_end} · @{duty.github_handle}</div>}
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

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-sm mb-3">Import GitHub Issue</h2>
        <div className="flex gap-2">
          <input value={ghUrl} onChange={e => setGhUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleImport()}
            placeholder="https://github.com/elastic/sdh-synthetics/issues/123"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue" />
          <button onClick={handleImport} disabled={importing || !ghUrl.trim()}
            className="bg-elastic-blue text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {importing ? "Importing…" : "Import"}
          </button>
        </div>
        {importErr && <p className="text-red-500 text-xs mt-2">{importErr}</p>}
      </div>

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

      {loading ? (
        <div className="text-sm text-gray-400 text-center py-12">Loading cases…</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-12">
          {filter === "all" ? "No cases yet — import one above." : `No ${STATUS_LABEL[filter as CaseStatus]} cases.`}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <Link key={c.id} to={`/cases/${c.id}`}
              className="block bg-white rounded-xl border border-gray-200 px-5 py-4 hover:border-elastic-blue transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{c.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {c.github_repo} #{c.github_issue_num} · updated {timeAgo(c.updated_at)}
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
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status]}`}>
                    {STATUS_LABEL[c.status]}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLOR[c.priority]}`}>
                    {c.priority}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
EOF

# Pages - CaseDetail
cat > frontend/src/pages/CaseDetail.tsx << 'EOF'
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { getCase, updateCase, addUpdate, refreshCase, addHandover, getEngineers } from "../api";
import type { CaseDetail, CaseStatus, Engineer } from "../types";

const STATUS_OPTS: CaseStatus[] = ["open", "pending_customer", "pending_internal", "resolved"];
const STATUS_LABEL: Record<CaseStatus, string> = {
  open: "Open", pending_customer: "Pending Customer",
  pending_internal: "Pending Internal", resolved: "Resolved",
};
const STATUS_COLOR: Record<CaseStatus, string> = {
  open: "bg-blue-100 text-blue-800", pending_customer: "bg-amber-100 text-amber-800",
  pending_internal: "bg-purple-100 text-purple-800", resolved: "bg-green-100 text-green-800",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

type Tab = "thread" | "timeline" | "handover";

export default function CaseDetailPage({ engineer }: { engineer: Engineer | null }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [tab, setTab] = useState<Tab>("thread");
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [note, setNote]         = useState("");
  const [slackUrl, setSlackUrl] = useState("");
  const [slackDesc, setSlackDesc] = useState("");
  const [callNotes, setCallNotes] = useState("");
  const [handoverSummary, setHandoverSummary] = useState("");
  const [handoverNext, setHandoverNext]       = useState("");
  const [handoverTo, setHandoverTo]           = useState("");
  const [saving, setSaving]       = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load() { setC(await getCase(Number(id))); }

  useEffect(() => { load(); getEngineers().then(setEngineers); }, [id]);

  async function changeStatus(status: CaseStatus) {
    if (!engineer || !c) return;
    await updateCase(c.id, { status, engineer_id: engineer.id }); load();
  }
  async function changeOwner(eid: string) {
    if (!c) return;
    await updateCase(c.id, { current_owner_id: parseInt(eid), engineer_id: engineer?.id }); load();
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
    await addUpdate(c.id, { engineer_id: engineer.id, update_type: "slack_link",
      content: slackDesc || "Slack thread", metadata: { url: slackUrl } });
    setSlackUrl(""); setSlackDesc(""); await load(); setSaving(false);
  }
  async function submitHandover() {
    if (!handoverSummary.trim() || !engineer || !c) return;
    setSaving(true);
    const today = new Date().toISOString().split("T")[0];
    await addHandover(c.id, { from_engineer_id: engineer.id,
      to_engineer_id: handoverTo ? parseInt(handoverTo) : undefined,
      summary: handoverSummary, next_steps: handoverNext, week_start: today });
    setHandoverSummary(""); setHandoverNext(""); setHandoverTo(""); await load(); setSaving(false);
  }
  async function doRefresh() {
    if (!c) return; setRefreshing(true);
    const { new_comments } = await refreshCase(c.id);
    await load(); setRefreshing(false);
    alert(`Refreshed — ${new_comments} new comment(s) fetched.`);
  }

  if (!c) return <div className="text-sm text-gray-400 py-12 text-center">Loading…</div>;

  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-elastic-blue text-elastic-blue" : "border-transparent text-gray-500 hover:text-gray-800"}`;

  return (
    <div className="space-y-4">
      <button onClick={() => navigate("/")} className="text-sm text-elastic-blue hover:underline">← Back to dashboard</button>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h1 className="font-bold text-lg leading-tight">{c.title}</h1>
            <div className="text-xs text-gray-400 mt-1">{c.github_repo} #{c.github_issue_num} · opened by @{c.github_author}</div>
          </div>
          <a href={c.github_url} target="_blank" rel="noreferrer" className="text-xs text-elastic-blue underline shrink-0">View on GitHub ↗</a>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Status</label>
            <div className="flex gap-1">
              {STATUS_OPTS.map(s => (
                <button key={s} onClick={() => changeStatus(s)}
                  className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${c.status === s ? STATUS_COLOR[s] : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
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
          <button onClick={doRefresh} disabled={refreshing}
            className="ml-auto text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            {refreshing ? "Refreshing…" : "↻ Refresh from GitHub"}
          </button>
        </div>
        {c.slack_links.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1">Slack threads</div>
            <div className="flex flex-wrap gap-2">
              {c.slack_links.map(s => (
                <a key={s.id} href={s.url} target="_blank" rel="noreferrer"
                   className="text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-full hover:bg-purple-100">
                  🔗 {s.description}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-100">
          <button className={tabCls("thread")}   onClick={() => setTab("thread")}>GitHub Thread ({c.github_comments.length})</button>
          <button className={tabCls("timeline")} onClick={() => setTab("timeline")}>Timeline ({c.updates.length})</button>
          <button className={tabCls("handover")} onClick={() => setTab("handover")}>Handovers ({c.handovers.length})</button>
        </div>
        <div className="p-5">
          {tab === "thread" && (
            <div className="space-y-4">
              <div className="border border-gray-100 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm">@{c.github_author}</span>
                  <span className="text-xs text-gray-400">opened issue</span>
                  {c.github_labels?.map(l => <span key={l} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{l}</span>)}
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
          {tab === "timeline" && (
            <div className="space-y-5">
              <div className="space-y-3">
                {c.updates.length === 0 && <p className="text-sm text-gray-400">No updates yet.</p>}
                {c.updates.map(u => (
                  <div key={u.id} className="flex gap-3">
                    <div className="w-1.5 self-stretch bg-gray-100 rounded-full shrink-0 ml-1" />
                    <div className="flex-1 pb-3">
                      <div className="text-xs text-gray-400 mb-0.5">
                        <span className="font-medium text-gray-700">{u.engineer_name ?? "System"}</span>
                        {" · "}{u.update_type.replace("_", " ")}{" · "}{fmt(u.created_at)}
                      </div>
                      <p className="text-sm text-gray-800">{u.content}</p>
                    </div>
                  </div>
                ))}
              </div>
              <hr className="border-gray-100" />
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Add internal note</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                  placeholder="What happened, what you tried, what's blocking you…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue resize-none" />
                <button onClick={submitNote} disabled={saving || !note.trim()}
                  className="bg-elastic-blue text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">Save note</button>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500">Log customer call outcome</label>
                <textarea value={callNotes} onChange={e => setCallNotes(e.target.value)} rows={3}
                  placeholder="Who was on the call, what was discussed, decisions made…"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-elastic-blue resize-none" />
                <button onClick={submitCallNotes} disabled={saving || !callNotes.trim()}
                  className="bg-elastic-green text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">Save call notes</button>
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
                  className="bg-purple-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">Add Slack link</button>
              </div>
            </div>
          )}
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
                  className="bg-amber-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50">Submit handover</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
EOF

# Pages - Team
cat > frontend/src/pages/Team.tsx << 'EOF'
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
EOF

# Pages - Schedule
cat > frontend/src/pages/Schedule.tsx << 'EOF'
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
EOF

echo ""
echo "✅ SDH Tracker scaffold created in ./sdh-tracker"
echo ""
echo "Next steps:"
echo "  1. cd sdh-tracker"
echo "  2. cp .env.example .env"
echo "  3. Edit .env and add your GitHub token (https://github.com/settings/tokens)"
echo "  4. docker compose up db backend"
echo "  5. Test backend: curl http://localhost:3001/health"
echo "  6. docker compose up frontend   (or 'docker compose up' for everything)"
echo "  7. Open http://localhost:5173"
echo ""
echo "First-time setup in the app:"
echo "  1. Go to Team → add all 10 engineers"
echo "  2. Go to Schedule → assign duty weeks"
echo "  3. Back on Dashboard → paste a GitHub issue URL and import"
echo ""
echo "To create a GitHub token, you only need 'read:org' and 'repo' (read) scopes."
