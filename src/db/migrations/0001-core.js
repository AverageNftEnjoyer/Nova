// Migrations are append-only once merged. SQL lives in a JS string so bundlers never need fs access.
export const migration = {
  version: 1,
  name: "core",
  sql: `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv_state (
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, namespace, key)
) WITHOUT ROWID;
`,
};
