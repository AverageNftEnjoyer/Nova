-- Consolidate the job-run failure path into one server-side transition so the
-- worker does not need separate read/update/insert round trips on retries.
CREATE OR REPLACE FUNCTION fail_job_run_with_retry(
  p_job_run_id TEXT,
  p_lease_token TEXT,
  p_finished_at TIMESTAMPTZ,
  p_started_at TIMESTAMPTZ DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL,
  p_error_detail TEXT DEFAULT NULL,
  p_retry_id TEXT DEFAULT NULL,
  p_backoff_base_ms INTEGER DEFAULT 60000,
  p_backoff_max_ms INTEGER DEFAULT 900000,
  p_backoff_jitter BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
  ok BOOLEAN,
  final_status TEXT,
  user_id TEXT,
  mission_id TEXT,
  source TEXT,
  next_attempt INTEGER,
  max_attempts INTEGER,
  retry_backoff_ms INTEGER,
  error_code TEXT,
  error_detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target job_runs%ROWTYPE;
  v_finished_at TIMESTAMPTZ;
  v_started_at TIMESTAMPTZ;
  v_duration_ms INTEGER;
  v_next_attempt INTEGER;
  v_retry_backoff_ms INTEGER;
  v_max_attempts INTEGER;
  v_retry_error_detail TEXT;
BEGIN
  SELECT *
  INTO v_target
  FROM job_runs
  WHERE id = p_job_run_id
    AND lease_token = p_lease_token
    AND status IN ('claimed', 'running')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      FALSE,
      'not_found_or_stale_lease'::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::TEXT,
      NULL::INTEGER,
      NULL::INTEGER,
      NULL::INTEGER,
      p_error_code,
      p_error_detail;
    RETURN;
  END IF;

  v_finished_at := COALESCE(p_finished_at, now());
  v_started_at := COALESCE(p_started_at, v_target.started_at, v_finished_at);
  v_duration_ms := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_finished_at - v_started_at)) * 1000)::INTEGER);
  v_next_attempt := COALESCE(v_target.attempt, 0) + 1;
  v_max_attempts := GREATEST(1, COALESCE(v_target.max_attempts, 1));

  IF v_next_attempt >= v_max_attempts THEN
    UPDATE job_runs
    SET status = 'dead',
        finished_at = v_finished_at,
        duration_ms = v_duration_ms,
        backoff_ms = COALESCE(v_target.backoff_ms, 0),
        error_code = p_error_code,
        error_detail = p_error_detail,
        lease_token = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_run_id;

    RETURN QUERY
    SELECT
      TRUE,
      'dead'::TEXT,
      v_target.user_id::TEXT,
      v_target.mission_id,
      v_target.source,
      v_next_attempt,
      v_max_attempts,
      COALESCE(v_target.backoff_ms, 0),
      p_error_code,
      p_error_detail;
    RETURN;
  END IF;

  v_retry_backoff_ms := LEAST(
    ROUND(
      (p_backoff_base_ms * POWER(2::NUMERIC, GREATEST(0, v_next_attempt - 1)))
      * (CASE WHEN p_backoff_jitter THEN (0.9 + random() * 0.2) ELSE 1 END)
    )::INTEGER,
    p_backoff_max_ms
  );

  BEGIN
    UPDATE job_runs
    SET status = 'failed',
        finished_at = v_finished_at,
        duration_ms = v_duration_ms,
        backoff_ms = v_retry_backoff_ms,
        error_code = p_error_code,
        error_detail = p_error_detail,
        lease_token = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_run_id;

    INSERT INTO job_runs (
      id,
      user_id,
      mission_id,
      status,
      priority,
      scheduled_for,
      attempt,
      max_attempts,
      backoff_ms,
      source,
      run_key,
      input_snapshot,
      created_at
    )
    VALUES (
      p_retry_id,
      v_target.user_id,
      v_target.mission_id,
      'pending',
      COALESCE(v_target.priority, 5),
      v_finished_at + (v_retry_backoff_ms || ' milliseconds')::interval,
      v_next_attempt,
      v_target.max_attempts,
      v_retry_backoff_ms,
      'retry',
      v_target.run_key,
      v_target.input_snapshot,
      v_finished_at
    );
  EXCEPTION WHEN OTHERS THEN
    v_retry_error_detail := 'Retry enqueue failed for ' || p_job_run_id || ': ' || SQLERRM;

    UPDATE job_runs
    SET status = 'dead',
        finished_at = v_finished_at,
        duration_ms = v_duration_ms,
        backoff_ms = v_retry_backoff_ms,
        error_code = 'RETRY_ENQUEUE_FAILED',
        error_detail = v_retry_error_detail,
        lease_token = NULL,
        lease_expires_at = NULL
    WHERE id = p_job_run_id;

    RETURN QUERY
    SELECT
      FALSE,
      'retry_enqueue_failed'::TEXT,
      v_target.user_id::TEXT,
      v_target.mission_id,
      v_target.source,
      v_next_attempt,
      v_max_attempts,
      v_retry_backoff_ms,
      'RETRY_ENQUEUE_FAILED'::TEXT,
      v_retry_error_detail;
    RETURN;
  END;

  RETURN QUERY
  SELECT
    TRUE,
    'failed'::TEXT,
    v_target.user_id::TEXT,
    v_target.mission_id,
    v_target.source,
    v_next_attempt,
    v_max_attempts,
    v_retry_backoff_ms,
    p_error_code,
    p_error_detail;
END;
$$;

GRANT EXECUTE ON FUNCTION fail_job_run_with_retry(
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  INTEGER,
  BOOLEAN
) TO service_role;
