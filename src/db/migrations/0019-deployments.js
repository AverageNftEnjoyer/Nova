// Canonical Deployments domain. Mission rows remain the immutable/versioned definition spine and job_runs remain
// the leased-attempt spine; these tables add a user-facing aggregate, replayable events and safe side-effect fencing.
export const migration = {
  version: 19,
  name: "deployments",
  sql: `
CREATE TABLE IF NOT EXISTS deployments (
  user_id               TEXT NOT NULL,
  id                    TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('task','automation')),
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','ready','active','paused','archived')),
  title                 TEXT NOT NULL,
  outcome               TEXT NOT NULL,
  acceptance_json       TEXT NOT NULL DEFAULT '[]',
  plan_json             TEXT,
  config_json           TEXT NOT NULL DEFAULT '{}',
  mission_id            TEXT,
  revision              INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_deployments_updated ON deployments(user_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_mission ON deployments(user_id, mission_id) WHERE mission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS deployment_runs (
  user_id               TEXT NOT NULL,
  id                    TEXT NOT NULL,
  deployment_id         TEXT NOT NULL,
  deployment_revision   INTEGER NOT NULL,
  job_run_id            TEXT,
  agent_task_id          TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','queued','running','paused','succeeded','failed','cancelled','dead')),
  permission_mode       TEXT NOT NULL DEFAULT 'default',
  cost_budget_usd       REAL,
  token_budget          INTEGER,
  cancellation_requested_at TEXT,
  created_at            TEXT NOT NULL,
  started_at            TEXT,
  finished_at           TEXT,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, deployment_id) REFERENCES deployments(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_runs_job ON deployment_runs(job_run_id) WHERE job_run_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployment_runs_task ON deployment_runs(user_id, agent_task_id) WHERE agent_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deployment_runs_deployment ON deployment_runs(user_id, deployment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deployment_runs_status ON deployment_runs(user_id, status, updated_at);

CREATE TABLE IF NOT EXISTS deployment_steps (
  user_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  step_id       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempt       INTEGER NOT NULL DEFAULT 0,
  input_json    TEXT,
  output_json   TEXT,
  error         TEXT,
  started_at    TEXT,
  finished_at   TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, run_id, step_id),
  FOREIGN KEY (user_id, run_id) REFERENCES deployment_runs(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS deployment_events (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  run_id        TEXT,
  type          TEXT NOT NULL,
  actor         TEXT NOT NULL,
  ts            TEXT NOT NULL,
  data_json     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_deployment_events_replay ON deployment_events(user_id, seq);
CREATE INDEX IF NOT EXISTS idx_deployment_events_run ON deployment_events(user_id, run_id, seq);

CREATE TABLE IF NOT EXISTS deployment_attachments (
  user_id       TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  path          TEXT NOT NULL,
  name          TEXT NOT NULL,
  size_bytes    INTEGER,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, deployment_id, attachment_id),
  FOREIGN KEY (user_id, deployment_id) REFERENCES deployments(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS deployment_effects (
  user_id       TEXT NOT NULL,
  run_id        TEXT NOT NULL,
  effect_key    TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('reserved','committed','failed')),
  lease_token   TEXT,
  result_json   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, run_id, effect_key),
  FOREIGN KEY (user_id, run_id) REFERENCES deployment_runs(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS deployment_legacy_links (
  user_id       TEXT NOT NULL,
  legacy_type   TEXT NOT NULL CHECK (legacy_type IN ('mission','agent_task')),
  legacy_id     TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  run_id        TEXT,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, legacy_type, legacy_id),
  FOREIGN KEY (user_id, deployment_id) REFERENCES deployments(user_id, id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_deployment_legacy_target ON deployment_legacy_links(user_id, deployment_id);
`,
};
