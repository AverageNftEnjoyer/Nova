import "server-only"

import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { appendMissionRunDeadLetter } from "./dead-letter"
import type {
  CompleteJobInput,
  EnqueueJobInput,
  FailJobInput,
  GetPendingRunsInput,
  JobAuditEvent,
  JobLedgerStore,
  JobRun,
  PendingJobRun,
  SchedulerLeaseResult,
} from "./types"

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function concurrencyPolicy() {
  return {
    perUserInflightLimit: readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_PER_USER", 3, 1, 100),
    globalInflightLimit: readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_GLOBAL", 200, 1, 5000),
    slotTtlMs: readIntEnv("NOVA_MISSION_EXECUTION_SLOT_TTL_MS", 15 * 60_000, 30_000, 24 * 60 * 60_000),
  }
}

function generateId(prefix: string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${ts}_${rand}`
}

type FailRunRpcResult = {
  ok: boolean
  final_status: string | null
  user_id: string | null
  mission_id: string | null
  source: string | null
  next_attempt: number | null
  max_attempts: number | null
  retry_backoff_ms: number | null
  error_code: string | null
  error_detail: string | null
}

function mapClaimFailureReason(reason: string, jobRunId: string, policy: ReturnType<typeof concurrencyPolicy>) {
  if (reason === "not_found") {
    return { ok: false as const, reason: `Job run not found: ${jobRunId}` }
  }
  if (reason.startsWith("not_pending:")) {
    const status = reason.slice("not_pending:".length) || "unknown"
    return { ok: false as const, reason: `Job run ${jobRunId} is not pending (status=${status}).` }
  }
  if (reason === "global_limit") {
    return {
      ok: false as const,
      reason: `Mission execution concurrency exceeded global in-flight cap (${policy.globalInflightLimit}).`,
    }
  }
  if (reason === "per_user_limit") {
    return {
      ok: false as const,
      reason: `Mission execution concurrency exceeded per-user cap (${policy.perUserInflightLimit}).`,
    }
  }
  if (reason === "claim_raced") {
    return { ok: false as const, reason: "Failed to claim job run - may have been claimed by another worker." }
  }
  return { ok: false as const, reason: `Failed to claim job run: ${reason || "unknown claim error"}` }
}

export const jobLedger: JobLedgerStore = {
  async enqueue(input: EnqueueJobInput) {
    const db = createSupabaseAdminClient()
    const now = new Date().toISOString()

    const row: Partial<JobRun> = {
      id: input.id,
      user_id: input.user_id,
      mission_id: input.mission_id,
      idempotency_key: input.idempotency_key ?? null,
      status: "pending",
      priority: input.priority ?? 5,
      scheduled_for: input.scheduled_for ?? now,
      attempt: 0,
      max_attempts: input.max_attempts ?? 1,
      backoff_ms: 0,
      source: input.source ?? "scheduler",
      run_key: input.run_key ?? null,
      input_snapshot: input.input_snapshot ?? null,
      created_at: now,
    }

    const { error } = await db
      .from("job_runs")
      .insert(row)

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "duplicate_idempotency_key" }
      }
      return { ok: false, error: error.message }
    }

    return { ok: true }
  },

  async claimRun(input: { jobRunId: string; leaseDurationMs: number }) {
    const db = createSupabaseAdminClient()
    const policy = concurrencyPolicy()
    const leaseToken = generateId("lt")
    const { data: rpcData, error: rpcError } = await db.rpc("claim_job_run_lease_with_limits", {
      p_job_run_id: input.jobRunId,
      p_lease_token: leaseToken,
      p_lease_duration_ms: input.leaseDurationMs,
      p_global_inflight_limit: policy.globalInflightLimit,
      p_per_user_inflight_limit: policy.perUserInflightLimit,
    })

    if (rpcError) {
      return { ok: false, reason: `DB error claiming job run: ${rpcError.message}` }
    }

    const rpcResult = Array.isArray(rpcData) ? rpcData[0] : null
    if (!rpcResult) {
      return { ok: false, reason: "Failed to claim job run: empty RPC response." }
    }
    if (!rpcResult.ok) {
      return mapClaimFailureReason(String(rpcResult.reason || ""), input.jobRunId, policy)
    }

    return {
      ok: true,
      leaseToken: String(rpcResult.lease_token || leaseToken),
    }
  },

  async heartbeat(input: { jobRunId: string; leaseToken: string; leaseDurationMs: number }) {
    const db = createSupabaseAdminClient()
    const { data, error } = await db.rpc("heartbeat_job_run_lease", {
      p_job_run_id: input.jobRunId,
      p_lease_token: input.leaseToken,
      p_lease_duration_ms: input.leaseDurationMs,
    })

    if (error) return { ok: false }
    return { ok: data === true }
  },

  async startRun(input: { jobRunId: string; leaseToken: string }) {
    const db = createSupabaseAdminClient()
    const startedAt = new Date().toISOString()

    const { error } = await db
      .from("job_runs")
      .update({ status: "running", started_at: startedAt })
      .eq("id", input.jobRunId)
      .eq("lease_token", input.leaseToken)
      .eq("status", "claimed")

    return { ok: !error, startedAt: error ? null : startedAt }
  },

  async completeRun(input: CompleteJobInput) {
    const db = createSupabaseAdminClient()
    const { data, error } = await db.rpc("complete_job_run", {
      p_job_run_id: input.jobRunId,
      p_lease_token: input.leaseToken,
      p_output_summary: input.outputSummary ?? null,
    })

    if (error) return { ok: false }
    return { ok: data === true }
  },

  async failRun(input: FailJobInput) {
    const db = createSupabaseAdminClient()
    const backoffBase = readIntEnv("NOVA_SCHEDULER_RETRY_BASE_MS", 60_000, 1_000, 3_600_000)
    const backoffMax = readIntEnv("NOVA_SCHEDULER_RETRY_MAX_MS", 900_000, 10_000, 86_400_000)
    const { data: rpcData, error: rpcError } = await db.rpc("fail_job_run_with_retry", {
      p_job_run_id: input.jobRunId,
      p_lease_token: input.leaseToken,
      p_finished_at: new Date().toISOString(),
      p_started_at: input.startedAt ?? null,
      p_error_code: input.errorCode ?? null,
      p_error_detail: input.errorDetail ?? null,
      p_retry_id: generateId("jr"),
      p_backoff_base_ms: backoffBase,
      p_backoff_max_ms: backoffMax,
      p_backoff_jitter: true,
    })

    if (rpcError) return { ok: false }

    const result = (Array.isArray(rpcData) ? rpcData[0] : null) as FailRunRpcResult | null
    if (!result?.final_status) return { ok: false }

    if (result.final_status === "dead") {
      await appendMissionRunDeadLetter({
        userId: String(result.user_id || ""),
        missionId: String(result.mission_id || ""),
        jobRunId: input.jobRunId,
        attempt: Math.max(1, Number(result.next_attempt ?? 1)),
        maxAttempts: Math.max(1, Number(result.max_attempts ?? 1)),
        source: String(result.source || "scheduler") as JobRun["source"],
        status: "dead",
        reason: "max_attempts_exhausted",
        errorCode: result.error_code ?? undefined,
        errorDetail: result.error_detail ?? undefined,
        retryBackoffMs: Number(result.retry_backoff_ms ?? 0),
      }).catch((err) => {
        console.warn("[JobLedger] appendMissionRunDeadLetter failed:", err instanceof Error ? err.message : err)
      })
      return { ok: true }
    }

    if (result.final_status === "retry_enqueue_failed") {
      await appendMissionRunDeadLetter({
        userId: String(result.user_id || ""),
        missionId: String(result.mission_id || ""),
        jobRunId: input.jobRunId,
        attempt: Math.max(1, Number(result.next_attempt ?? 1)),
        maxAttempts: Math.max(1, Number(result.max_attempts ?? 1)),
        source: String(result.source || "scheduler") as JobRun["source"],
        status: "retry_enqueue_failed",
        reason: "retry_enqueue_failed",
        errorCode: result.error_code ?? "RETRY_ENQUEUE_FAILED",
        errorDetail: result.error_detail ?? undefined,
        retryBackoffMs: Number(result.retry_backoff_ms ?? 0),
      }).catch((err) => {
        console.warn("[JobLedger] appendMissionRunDeadLetter failed:", err instanceof Error ? err.message : err)
      })

      return { ok: false }
    }

    return { ok: Boolean(result.ok) }
  },

  async cancelRun(input: { jobRunId: string; userId: string }) {
    const db = createSupabaseAdminClient()

    const { error } = await db
      .from("job_runs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", input.jobRunId)
      .eq("user_id", input.userId)
      .in("status", ["pending", "claimed", "running"])

    return { ok: !error }
  },

  async reclaimExpiredLeases() {
    const db = createSupabaseAdminClient()
    const { data, error } = await db.rpc("reclaim_expired_job_leases")

    if (error) {
      console.warn("[JobLedger] reclaimExpiredLeases RPC error:", error.message)
      return 0
    }

    return (data as number) ?? 0
  },

  async cancelPendingForMission(input: { userId: string; missionId: string }) {
    const db = createSupabaseAdminClient()

    const { data, error } = await db
      .from("job_runs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("user_id", input.userId)
      .eq("mission_id", input.missionId)
      .in("status", ["pending", "claimed", "running"])
      .select("id")

    if (error || !data) return 0
    return data.length
  },

  async auditEvent(input: {
    jobRunId: string
    userId: string
    event: string
    actor: string
    metadata?: Record<string, unknown>
  }) {
    const db = createSupabaseAdminClient()

    const row: Partial<JobAuditEvent> = {
      id: generateId("ae"),
      job_run_id: input.jobRunId,
      user_id: input.userId as unknown as string,
      event: input.event,
      actor: input.actor,
      ts: new Date().toISOString(),
      metadata: input.metadata ?? null,
    }

    await db.from("job_audit_events").insert(row)
  },

  async acquireSchedulerLease(input: {
    scope: string
    holderId: string
    ttlMs: number
  }): Promise<SchedulerLeaseResult> {
    const db = createSupabaseAdminClient()

    const { data, error } = await db.rpc("acquire_scheduler_lease", {
      p_scope: input.scope,
      p_holder_id: input.holderId,
      p_ttl_ms: input.ttlMs,
    })

    if (error || !data) {
      console.warn("[JobLedger] acquireSchedulerLease RPC error:", error?.message)
      return { acquired: false, reason: "db_error" }
    }

    const row = (data as Array<{
      scope: string
      holder_id: string
      acquired_at: string
      expires_at: string
      acquired: boolean
    }>)[0]

    if (!row) {
      console.warn("[JobLedger] acquireSchedulerLease: unexpected empty result")
      return { acquired: false, reason: "db_error" }
    }

    if (!row.acquired) {
      return { acquired: false, reason: "already_held" }
    }

    return {
      acquired: true,
      scope: row.scope,
      holderId: row.holder_id,
      expiresAt: row.expires_at,
    }
  },

  async renewSchedulerLease(input: {
    scope: string
    holderId: string
    ttlMs: number
  }): Promise<{ ok: boolean }> {
    const db = createSupabaseAdminClient()

    const { data, error } = await db.rpc("renew_scheduler_lease", {
      p_scope: input.scope,
      p_holder_id: input.holderId,
      p_ttl_ms: input.ttlMs,
    })

    if (error) {
      console.warn("[JobLedger] renewSchedulerLease RPC error:", error.message)
      return { ok: false }
    }

    return { ok: data === true }
  },

  async releaseSchedulerLease(input: {
    scope: string
    holderId: string
  }): Promise<{ ok: boolean }> {
    const db = createSupabaseAdminClient()

    const { error } = await db
      .from("scheduler_leases")
      .delete()
      .eq("scope", input.scope)
      .eq("holder_id", input.holderId)

    if (error) {
      console.warn("[JobLedger] releaseSchedulerLease error:", error.message)
      return { ok: false }
    }

    return { ok: true }
  },

  async getPendingRuns(input: GetPendingRunsInput): Promise<PendingJobRun[]> {
    const db = createSupabaseAdminClient()
    const cutoff = (input.now ?? new Date()).toISOString()

    let query = db
      .from("job_runs")
      .select("id, user_id, mission_id, priority, scheduled_for, attempt, source, input_snapshot")
      .eq("status", "pending")
      .lte("scheduled_for", cutoff)
      .order("priority", { ascending: false })
      .order("scheduled_for", { ascending: true })
      .limit(input.limit)

    if (input.userIds && input.userIds.length > 0) {
      query = query.in("user_id", input.userIds)
    }

    const { data, error } = await query

    if (error || !data) {
      console.warn("[JobLedger] getPendingRuns error:", error?.message)
      return []
    }

    return data as PendingJobRun[]
  },
}
