// W5: home notes, agent tasks, calendar reschedule overrides.
// All statements are idempotent (IF NOT EXISTS): the runner also applies this file on databases that recorded
// version 4 while it was still an empty stub.
export const migration = {
  version: 4,
  name: "local-data",
  sql: `
CREATE TABLE IF NOT EXISTS notes (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'manual',
  updated_by TEXT NOT NULL DEFAULT 'manual',
  conversation_id TEXT,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_tasks (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  progress INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  paused_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created ON agent_tasks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS calendar_overrides (
  user_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  original_time TEXT NOT NULL,
  overridden_time TEXT NOT NULL,
  overridden_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, mission_id)
) WITHOUT ROWID;
`,
};
