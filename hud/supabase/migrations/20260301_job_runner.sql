-- ─────────────────────────────────────────────────────────────────────────────
-- Nova Job Runner Backbone — Phase 0 Migration
-- Created: 2026-03-01
-- Purpose: Durable job execution ledger replacing in-memory execution-guard
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- job_runs: durable execution record for every mission run attempt
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_runs (
  id                TEXT        PRIMARY KEY,
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mission_id        TEXT        NOT NULL,
  idempotency_key   TEXT        UNIQUE,
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','claimed','running','succeeded','failed','dead','cancelled')),
  priority          INTEGER     NOT NULL DEFAULT 5,
  scheduled_for     TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token       TEXT,
  lease_expires_at  TIMESTAMPTZ,
  heartbeat_at      TIMESTAMPTZ,
  attempt           INTEGER     NOT NULL DEFAULT 0,
  max_attempts      INTEGER     NOT NULL DEFAULT 1,
  backoff_ms        INTEGER     NOT NULL DEFAULT 0,
  source            TEXT        NOT NULL DEFAULT 'scheduler',
  run_key           TEXT,
  input_snapshot    JSONB,
  output_summary    JSONB,
  error_code        TEXT,
  error_detail      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  duration_ms       INTEGER
);

-- Scheduler hot-path queries
CREATE INDEX IF NOT EXISTS idx_job_runs_pending
  ON job_runs(user_id, scheduled_for) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_runs_lease_expiry
  ON job_runs(lease_expires_at) WHERE status = 'claimed';

CREATE INDEX IF NOT EXISTS idx_job_runs_run_key
  ON job_runs(user_id, run_key) WHERE run_key IS NOT NULL;

-- Concurrency cap queries
CREATE INDEX IF NOT EXISTS idx_job_runs_active_per_user
  ON job_runs(user_id) WHERE status IN ('claimed', 'running');

-- RLS: users see only their own runs; service role sees all
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_runs_user_select ON job_runs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY job_runs_service_all ON job_runs FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- scheduler_leases: distributed leader election per scheduler scope
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduler_leases (
  scope       TEXT        PRIMARY KEY,   -- 'global' or 'user:{userId}'
  holder_id   TEXT        NOT NULL,      -- random instance UUID
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

ALTER TABLE scheduler_leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduler_leases_service_only ON scheduler_leases FOR ALL
  USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- job_audit_events: immutable append-only audit trail
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_audit_events (
  id          TEXT        PRIMARY KEY,
  job_run_id  TEXT        NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL,
  event       TEXT        NOT NULL,
  actor       TEXT        NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata    JSONB
);

CREATE INDEX IF NOT EXISTS idx_job_audit_run  ON job_audit_events(job_run_id, ts);
CREATE INDEX IF NOT EXISTS idx_job_audit_user ON job_audit_events(user_id, ts);

ALTER TABLE job_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_audit_user_select ON job_audit_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY job_audit_service_all ON job_audit_events FOR ALL
  USING (auth.role() = 'service_role');
