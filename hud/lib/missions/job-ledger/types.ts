/**
 * Nova Job Ledger — Types
 * Durable execution record types for the Supabase-backed job runner backbone.
 * Phase 0: replaces in-memory execution-guard.ts
 * Phase 2: adds scheduler lease types for leader election
 */

export type JobRunStatus =
  | "pending"
  | "claimed"
  | "running"
  | "succeeded"
  | "failed"
  | "dead"
  | "cancelled"

export type JobRunSource = "scheduler" | "manual" | "retry" | "webhook"

/** Mirror of the job_runs table row */
export type JobRun = {
  id: string
  user_id: string
  mission_id: string
  idempotency_key: string | null
  status: JobRunStatus
  priority: number
  scheduled_for: string
  lease_token: string | null
  lease_expires_at: string | null
  heartbeat_at: string | null
  attempt: number
  max_attempts: number
  backoff_ms: number
  source: JobRunSource
  run_key: string | null
  input_snapshot: Record<string, unknown> | null
  output_summary: Record<string, unknown> | null
  error_code: string | null
  error_detail: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
}

/** Narrow row shape needed by execution-tick pending scans. */
export type PendingJobRun = Pick<
  JobRun,
  "id" | "user_id" | "mission_id" | "priority" | "scheduled_for" | "attempt" | "source" | "input_snapshot"
>

/** Mirror of the job_audit_events table row */
export type JobAuditEvent = {
  id: string
  job_run_id: string
  user_id: string
  event: string
  actor: string
  ts: string
  metadata: Record<string, unknown> | null
}

/** Input to enqueue a new job run */
export type EnqueueJobInput = {
  id: string
  user_id: string
  mission_id: string
  idempotency_key?: string
  source?: JobRunSource
  run_key?: string
  priority?: number
  scheduled_for?: string
  max_attempts?: number
  input_snapshot?: Record<string, unknown>
}

/** Result of a claim attempt */
export type ClaimResult =
  | { ok: true; leaseToken: string }
  | { ok: false; reason: string }

/** Concurrency check result */
export type ConcurrencyCheckResult =
  | { ok: true }
  | { ok: false; reason: string }

/** Complete input */
export type CompleteJobInput = {
  jobRunId: string
  leaseToken: string
  outputSummary?: Record<string, unknown>
}

/** Fail input */
export type FailJobInput = {
  jobRunId: string
  leaseToken: string
  startedAt?: string | null
  errorCode?: string
  errorDetail?: string
}

// ─── Scheduler lease types (Phase 2) ────────────────────────────────────────

/** Result of an atomic scheduler lease acquisition attempt */
export type SchedulerLeaseResult =
  | { acquired: true; scope: string; holderId: string; expiresAt: string }
  | { acquired: false; reason: "already_held" | "db_error" }

/** Query options for fetching pending runs */
export type GetPendingRunsInput = {
  /** Max rows to return (maps to per-tick cap) */
  limit: number
  /** Cutoff time — only runs scheduled_for <= now are returned (default: now) */
  now?: Date
  /** Optional: filter to specific user IDs */
  userIds?: string[]
}

/** The main interface the execution-guard delegates to */
export interface JobLedgerStore {
  /**
   * Enqueue a new job run in status=pending.
   * Returns error if idempotency_key already exists.
   */
  enqueue(input: EnqueueJobInput): Promise<{ ok: true } | { ok: false; error: string }>

  /**
   * Atomically check per-user and global concurrency caps,
   * then transition status: pending → claimed with a lease.
   * Limits read from env vars (NOVA_MISSION_EXECUTION_MAX_INFLIGHT_*).
   */
  claimRun(input: {
    jobRunId: string
    leaseDurationMs: number
  }): Promise<ClaimResult>

  /**
   * Heartbeat: extend lease_expires_at by leaseDurationMs from now.
   * Must present matching leaseToken.
   */
  heartbeat(input: {
    jobRunId: string
    leaseToken: string
    leaseDurationMs: number
  }): Promise<{ ok: boolean }>

  /**
   * Transition claimed → running (sets started_at).
   */
  startRun(input: {
    jobRunId: string
    leaseToken: string
  }): Promise<{ ok: boolean; startedAt: string | null }>

  /**
   * Transition running → succeeded. Sets finished_at and duration_ms.
   */
  completeRun(input: CompleteJobInput): Promise<{ ok: boolean }>

  /**
   * Transition running → failed (or → dead if attempt >= max_attempts).
   * If retrying: re-enqueues with incremented attempt and backoff delay.
   */
  failRun(input: FailJobInput): Promise<{ ok: boolean }>

  /**
   * Cancel a job from any non-terminal status → cancelled.
   */
  cancelRun(input: {
    jobRunId: string
    userId: string
  }): Promise<{ ok: boolean }>

  /**
   * Reclaim stale claimed rows whose lease_expires_at has passed.
   * Transitions them back to pending so the next scheduler tick picks them up.
   * Returns count of reclaimed rows.
   */
  reclaimExpiredLeases(): Promise<number>

  /**
   * Cancel all pending/claimed runs for a given mission (used on mission DELETE).
   */
  cancelPendingForMission(input: {
    userId: string
    missionId: string
  }): Promise<number>

  /**
   * Append an audit event for a job run.
   */
  auditEvent(input: {
    jobRunId: string
    userId: string
    event: string
    actor: string
    metadata?: Record<string, unknown>
  }): Promise<void>

  // ─── Scheduler leader-election (Phase 2) ──────────────────────────────────

  /**
   * Atomically acquire the scheduler lease for `scope`.
   * Uses a PostgreSQL stored procedure (`acquire_scheduler_lease`) to do a
   * conditional INSERT ON CONFLICT ... WHERE expires_at < now().
   * Returns `acquired: true` only if this holderId now owns the lease.
   */
  acquireSchedulerLease(input: {
    scope: string
    holderId: string
    ttlMs: number
  }): Promise<SchedulerLeaseResult>

  /**
   * Renew an already-held lease. No-op if holderId doesn't match the current holder.
   * Returns ok: false if the lease was stolen by another instance.
   */
  renewSchedulerLease(input: {
    scope: string
    holderId: string
    ttlMs: number
  }): Promise<{ ok: boolean }>

  /**
   * Release the lease explicitly (e.g. on graceful shutdown).
   * Only deletes if holderId matches.
   */
  releaseSchedulerLease(input: {
    scope: string
    holderId: string
  }): Promise<{ ok: boolean }>

  // ─── Job-driven tick (Phase 2) ────────────────────────────────────────────

  /**
   * Fetch pending job runs due for execution.
   * Ordered by priority DESC, scheduled_for ASC.
   * Does NOT claim them — call claimRun() per item.
   */
  getPendingRuns(input: GetPendingRunsInput): Promise<PendingJobRun[]>
}
