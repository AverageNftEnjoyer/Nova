// W6: HUD conversations (threads/messages/summaries), tool runs, and the agent session index + transcripts.
// All statements are idempotent (IF NOT EXISTS): the runner also applies this file on databases that recorded
// version 5 while it was still an empty stub.
//
// Secrets: no column here stores credentials. `tool_runs.input_json/output_json` are written through
// redactSecrets() by src/session/sqlite-store before insert (contract §8/§10). Message bodies are user content and
// must never be logged.
export const migration = {
  version: 5,
  name: "chat",
  sql: `
CREATE TABLE IF NOT EXISTS threads (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_threads_user_updated ON threads(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  content TEXT NOT NULL DEFAULT '',
  tool_name TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, thread_id, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(user_id, thread_id, created_at);

CREATE TABLE IF NOT EXISTS thread_summaries (
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, thread_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tool_runs (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  thread_id TEXT,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'success',
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_tool_runs_thread ON tool_runs(user_id, thread_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  session_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, session_key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);

CREATE TABLE IF NOT EXISTS session_turns (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content_json TEXT NOT NULL,
  ts INTEGER NOT NULL,
  tokens_json TEXT,
  meta_json TEXT,
  PRIMARY KEY (user_id, session_id, seq)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_session_turns_ts ON session_turns(ts);
`,
};
