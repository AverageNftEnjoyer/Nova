-- ─────────────────────────────────────────────────────────────────────────────
-- Nova Scheduler Lease Procedures — Phase 2 Migration
-- Created: 2026-03-02
-- Purpose: Atomic conditional lease acquisition for leader election.
--
-- Supabase.js .upsert() cannot express WHERE expires_at < now() in the
-- ON CONFLICT clause, so we use a SECURITY DEFINER stored procedure instead.
-- Called via: db.rpc('acquire_scheduler_lease', { p_scope, p_holder_id, p_ttl_ms })
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION acquire_scheduler_lease(
  p_scope      TEXT,
  p_holder_id  TEXT,
  p_ttl_ms     INTEGER
)
RETURNS TABLE (
  scope        TEXT,
  holder_id    TEXT,
  acquired_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  acquired     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Attempt to INSERT a new lease row.
  -- On conflict (scope already exists), only update if the existing lease is expired.
  INSERT INTO scheduler_leases (scope, holder_id, acquired_at, expires_at)
  VALUES (
    p_scope,
    p_holder_id,
    now(),
    now() + (p_ttl_ms || ' milliseconds')::interval
  )
  ON CONFLICT (scope) DO UPDATE
    SET holder_id   = EXCLUDED.holder_id,
        acquired_at = now(),
        expires_at  = now() + (p_ttl_ms || ' milliseconds')::interval
    WHERE scheduler_leases.expires_at < now();  -- only steal if expired

  -- Return the current row and whether we now own it
  RETURN QUERY
  SELECT
    sl.scope,
    sl.holder_id,
    sl.acquired_at,
    sl.expires_at,
    (sl.holder_id = p_holder_id) AS acquired
  FROM scheduler_leases sl
  WHERE sl.scope = p_scope;
END;
$$;

-- Grant execute to the service role (used by createSupabaseAdminClient)
GRANT EXECUTE ON FUNCTION acquire_scheduler_lease(TEXT, TEXT, INTEGER) TO service_role;
