-- Consolidate job-run completion into one server-side transition so the worker
-- does not compute completion timestamps or duration client-side.
CREATE OR REPLACE FUNCTION complete_job_run(
  p_job_run_id TEXT,
  p_lease_token TEXT,
  p_output_summary JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_finished_at TIMESTAMPTZ;
  v_updated INTEGER;
BEGIN
  SELECT started_at
  INTO v_started_at
  FROM job_runs
  WHERE id = p_job_run_id
    AND lease_token = p_lease_token
    AND status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  v_finished_at := now();

  UPDATE job_runs
  SET status = 'succeeded',
      finished_at = v_finished_at,
      duration_ms = GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (v_finished_at - COALESCE(v_started_at, v_finished_at))) * 1000)::INTEGER
      ),
      output_summary = p_output_summary,
      lease_token = NULL,
      lease_expires_at = NULL
  WHERE id = p_job_run_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION complete_job_run(TEXT, TEXT, JSONB) TO service_role;
