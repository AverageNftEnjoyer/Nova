-- ─────────────────────────────────────────────────────────────────────────────
-- Nova Scheduler Stored Procedures — Phase 2 V2
-- Created: 2026-03-02
--
-- Fixes two clock-skew bugs where JavaScript Date.now() was used for
-- time comparisons that should use PostgreSQL's server-side now().
--
-- 1. renew_scheduler_lease   — replaces JS-side Date.now() expiry computation
-- 2. reclaim_expired_job_leases — replaces JS-side now() comparison for lease expiry
-- 3. idx_job_runs_inflight   — global status index for concurrency count query
-- ─────────────────────────────────────────────────────────────────────────────

-- Renew a scheduler lease server-side so expiry is always relative to Postgres
-- clock, not JavaScript clock. Returns TRUE if the holderId owned the lease
-- and the renewal succeeded; FALSE if the lease was already stolen.
CREATE OR REPLACE FUNCTION renew_scheduler_lease(
  p_scope      TEXT,
  p_holder_id  TEXT,
  p_ttl_ms     INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE scheduler_leases
  SET expires_at = now() + (p_ttl_ms || ' milliseconds')::interval
  WHERE scope     = p_scope
    AND holder_id = p_holder_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- Reclaim expired job-run leases entirely server-side so the comparison uses
-- Postgres now() rather than a JavaScript-supplied timestamp (avoids clock skew).
-- Returns the number of rows transitioned back to pending.
CREATE OR REPLACE FUNCTION reclaim_expired_job_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE job_runs
  SET status          = 'pending',
      lease_token     = NULL,
      lease_expires_at = NULL,
      heartbeat_at    = NULL
  WHERE status          = 'claimed'
    AND lease_expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Global inflight index: speeds up the COUNT(*) WHERE status IN ('claimed','running')
-- query used by claimRun() to enforce the global concurrency cap.
CREATE INDEX IF NOT EXISTS idx_job_runs_inflight
  ON job_runs(status)
  WHERE status IN ('claimed', 'running');

GRANT EXECUTE ON FUNCTION renew_scheduler_lease(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION reclaim_expired_job_leases() TO service_role;
