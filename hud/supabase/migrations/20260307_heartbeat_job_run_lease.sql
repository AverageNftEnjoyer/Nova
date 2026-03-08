-- Server-side heartbeat renewal so lease extension uses the database clock
-- instead of JavaScript time on the worker.
CREATE OR REPLACE FUNCTION heartbeat_job_run_lease(
  p_job_run_id TEXT,
  p_lease_token TEXT,
  p_lease_duration_ms INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE job_runs
  SET heartbeat_at = now(),
      lease_expires_at = now() + (p_lease_duration_ms || ' milliseconds')::interval
  WHERE id = p_job_run_id
    AND lease_token = p_lease_token
    AND status IN ('claimed', 'running');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION heartbeat_job_run_lease(TEXT, TEXT, INTEGER) TO service_role;
