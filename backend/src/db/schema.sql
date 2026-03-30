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
