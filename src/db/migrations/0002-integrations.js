// Integrations storage (W3). Idempotent SQL: this migration is re-applied on databases that recorded version 2
// while it was still an empty stub, so every statement must tolerate already existing objects.
export const migration = {
  version: 2,
  name: "integrations",
  sql: `
CREATE TABLE IF NOT EXISTS integration_configs (
  user_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS integration_state (
  user_id TEXT NOT NULL,
  integration TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, integration, key)
) WITHOUT ROWID;
`,
};
