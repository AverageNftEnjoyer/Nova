-- ─────────────────────────────────────────────────────────────────────────────
-- Nova Execution Tick Phase 4 — Running Status Reclaim Fix
-- Created: 2026-03-03
-- Purpose: Extend reclaim_expired_job_leases() to also reclaim 'running' rows
--          whose lease has expired. Phase 4 adds heartbeat support so a running
--          row with an expired lease is genuinely abandoned (no heartbeat = dead
--          worker). Without this fix, a crashed worker stuck in 'running' state
--          would never be reclaimed and its mission would not retry.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reclaim_expired_job_leases()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE job_runs
  SET status           = 'pending',
      lease_token      = NULL,
      lease_expires_at = NULL,
      heartbeat_at     = NULL
  WHERE status IN ('claimed', 'running')
    AND lease_expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Re-grant execute permission (function signature unchanged — REPLACE handles it,
-- but explicit GRANT is idempotent and ensures the permission is always set).
GRANT EXECUTE ON FUNCTION reclaim_expired_job_leases() TO service_role;

-- Update the partial index to cover both statuses so lease-expiry scans
-- remain fast when reclaiming 'running' rows.
DROP INDEX IF EXISTS idx_job_runs_lease_expiry;
CREATE INDEX IF NOT EXISTS idx_job_runs_lease_expiry
  ON job_runs(lease_expires_at)
  WHERE status IN ('claimed', 'running');
