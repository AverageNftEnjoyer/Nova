// W4: missions, mission history/telemetry/logs, dead letters, artifacts, and the durable job ledger.
// All statements are idempotent (IF NOT EXISTS) because a filled-in stub is applied by its meta marker.
// Timestamps are UTC ISO-8601 strings (nowIso()) and compare lexicographically.
// No secret-bearing columns here: mission rows/logs never hold credentials (SECRETS rule 5: redact before persisting).
export const migration = {
  version: 3,
  name: "missions",
  sql: `
CREATE TABLE IF NOT EXISTS missions (
  user_id    TEXT NOT NULL,
  id         TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  label      TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS mission_versions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  ts         TEXT NOT NULL,
  data_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mission_versions ON mission_versions(user_id, mission_id, ts);

CREATE TABLE IF NOT EXISTS mission_telemetry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  ts          TEXT NOT NULL,
  type        TEXT NOT NULL,
  mission_id  TEXT,
  schedule_id TEXT,
  run_id      TEXT,
  data_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mission_telemetry ON mission_telemetry(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_mission_telemetry_mission ON mission_telemetry(user_id, mission_id);

CREATE TABLE IF NOT EXISTS mission_run_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  ts         TEXT NOT NULL,
  run_key    TEXT,
  data_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mission_run_logs ON mission_run_logs(user_id, mission_id, id);

CREATE TABLE IF NOT EXISTS mission_journal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  ts         TEXT NOT NULL,
  data_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mission_journal ON mission_journal(user_id, mission_id, ts);

CREATE TABLE IF NOT EXISTS dead_letters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('notification','mission_run')),
  entry_id   TEXT NOT NULL,
  mission_id TEXT,
  ts         TEXT NOT NULL,
  data_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dead_letters ON dead_letters(user_id, kind, ts);
CREATE INDEX IF NOT EXISTS idx_dead_letters_mission ON dead_letters(user_id, kind, mission_id);

CREATE TABLE IF NOT EXISTS mission_artifacts (
  user_id         TEXT NOT NULL,
  artifact_ref    TEXT NOT NULL,
  conversation_id TEXT,
  mission_id      TEXT,
  run_id          TEXT,
  step_id         TEXT,
  created_at_ms   INTEGER NOT NULL,
  ttl_ms          INTEGER NOT NULL,
  data_json       TEXT NOT NULL,
  PRIMARY KEY (user_id, artifact_ref)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_mission_artifacts_recent ON mission_artifacts(user_id, created_at_ms);

CREATE TABLE IF NOT EXISTS job_runs (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  mission_id       TEXT NOT NULL,
  idempotency_key  TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','claimed','running','succeeded','failed','dead','cancelled')),
  priority         INTEGER NOT NULL DEFAULT 5,
  scheduled_for    TEXT NOT NULL,
  lease_token      TEXT,
  lease_expires_at TEXT,
  heartbeat_at     TEXT,
  attempt          INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 1,
  backoff_ms       INTEGER NOT NULL DEFAULT 0,
  source           TEXT NOT NULL DEFAULT 'scheduler',
  run_key          TEXT,
  input_snapshot   TEXT,
  output_summary   TEXT,
  error_code       TEXT,
  error_detail     TEXT,
  created_at       TEXT NOT NULL,
  started_at       TEXT,
  finished_at      TEXT,
  duration_ms      INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_runs_idem ON job_runs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_runs_pending ON job_runs(user_id, scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_job_runs_active  ON job_runs(user_id) WHERE status IN ('claimed','running');
CREATE INDEX IF NOT EXISTS idx_job_runs_inflight ON job_runs(status) WHERE status IN ('claimed','running');
CREATE INDEX IF NOT EXISTS idx_job_runs_lease   ON job_runs(lease_expires_at) WHERE status IN ('claimed','running');
CREATE INDEX IF NOT EXISTS idx_job_runs_run_key ON job_runs(user_id, run_key) WHERE run_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_runs_mission ON job_runs(user_id, mission_id);

CREATE TABLE IF NOT EXISTS scheduler_leases (
  scope       TEXT PRIMARY KEY,
  holder_id   TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_audit_events (
  id         TEXT PRIMARY KEY,
  job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  event      TEXT NOT NULL,
  actor      TEXT NOT NULL,
  ts         TEXT NOT NULL,
  metadata   TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_audit_run ON job_audit_events(job_run_id, ts);
`,
};
