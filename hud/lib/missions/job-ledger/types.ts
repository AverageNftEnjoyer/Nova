/**
 * Nova Job Ledger — Types
 * Durable execution record types for the Supabase-backed job runner backbone.
 * Phase 0: replaces in-memory execution-guard.ts
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
  | { ok: true; leaseToken: string; jobRun: JobRun }
  | { ok: false; reason: string }

/** Concurrency check result */
export type ConcurrencyCheckResult =
  | { ok: true }
  | { ok: false; reason: string }

/** Complete/fail input */
export type FinishJobInput = {
  jobRunId: string
  leaseToken: string
  outputSummary?: Record<string, unknown>
  errorCode?: string
  errorDetail?: string
}

/** The main interface the execution-guard delegates to */
export interface JobLedgerStore {
  /**
   * Enqueue a new job run in status=pending.
   * Returns error if idempotency_key already exists.
   */
  enqueue(input: EnqueueJobInput): Promise<{ ok: true; jobRun: JobRun } | { ok: false; error: string }>

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
  }): Promise<{ ok: boolean }>

  /**
   * Transition running → succeeded. Sets finished_at and duration_ms.
   */
  completeRun(input: FinishJobInput): Promise<{ ok: boolean }>

  /**
   * Transition running → failed (or → dead if attempt >= max_attempts).
   * If retrying: re-enqueues with incremented attempt and backoff delay.
   */
  failRun(input: FinishJobInput): Promise<{ ok: boolean }>

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
}
