-- Consolidate job-run claim checks into a single server-side function so the
-- worker does not need multiple round trips before it can begin execution.
CREATE OR REPLACE FUNCTION claim_job_run_with_limits(
  p_job_run_id TEXT,
  p_lease_token TEXT,
  p_lease_duration_ms INTEGER,
  p_global_inflight_limit INTEGER,
  p_per_user_inflight_limit INTEGER
)
RETURNS TABLE(
  ok BOOLEAN,
  reason TEXT,
  lease_token TEXT,
  job_run JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target job_runs%ROWTYPE;
  v_global_inflight INTEGER;
  v_user_inflight INTEGER;
BEGIN
  SELECT *
  INTO v_target
  FROM job_runs
  WHERE id = p_job_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'not_found'::TEXT, NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  IF v_target.status <> 'pending' THEN
    RETURN QUERY
    SELECT FALSE, ('not_pending:' || v_target.status)::TEXT, NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_global_inflight
  FROM job_runs
  WHERE status IN ('claimed', 'running');

  IF v_global_inflight >= p_global_inflight_limit THEN
    RETURN QUERY SELECT FALSE, 'global_limit'::TEXT, NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_user_inflight
  FROM job_runs
  WHERE user_id = v_target.user_id
    AND status IN ('claimed', 'running');

  IF v_user_inflight >= p_per_user_inflight_limit THEN
    RETURN QUERY SELECT FALSE, 'per_user_limit'::TEXT, NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  UPDATE job_runs
  SET status = 'claimed',
      lease_token = p_lease_token,
      lease_expires_at = now() + (p_lease_duration_ms || ' milliseconds')::interval,
      heartbeat_at = now()
  WHERE id = p_job_run_id
    AND status = 'pending'
  RETURNING *
  INTO v_target;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'claim_raced'::TEXT, NULL::TEXT, NULL::JSONB;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE, NULL::TEXT, p_lease_token, to_jsonb(v_target);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_job_run_with_limits(TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO service_role;
