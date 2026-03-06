import "server-only"

import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { computeRetryDelayMs } from "../retry-policy"
import { appendMissionRunDeadLetter } from "./dead-letter"
import type {
  EnqueueJobInput,
  FinishJobInput,
  GetPendingRunsInput,
  JobAuditEvent,
  JobLedgerStore,
  JobRun,
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

    const { data, error } = await db
      .from("job_runs")
      .insert(row)
      .select("*")
      .single()

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: "duplicate_idempotency_key" }
      }
      return { ok: false, error: error.message }
    }

    return { ok: true, jobRun: data as JobRun }
  },

  async claimRun(input: { jobRunId: string; leaseDurationMs: number }) {
    const db = createSupabaseAdminClient()
    const policy = concurrencyPolicy()
    const leaseToken = generateId("lt")
    const { data: rpcData, error: rpcError } = await db.rpc("claim_job_run_with_limits", {
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
      jobRun: rpcResult.job_run as JobRun,
    }
  },

  async heartbeat(input: { jobRunId: string; leaseToken: string; leaseDurationMs: number }) {
    const db = createSupabaseAdminClient()
    const now = new Date()
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs).toISOString()

    const { error } = await db
      .from("job_runs")
      .update({ heartbeat_at: now.toISOString(), lease_expires_at: leaseExpiresAt })
      .eq("id", input.jobRunId)
      .eq("lease_token", input.leaseToken)
      .in("status", ["claimed", "running"])

    return { ok: !error }
  },

  async startRun(input: { jobRunId: string; leaseToken: string }) {
    const db = createSupabaseAdminClient()

    const { error } = await db
      .from("job_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", input.jobRunId)
      .eq("lease_token", input.leaseToken)
      .eq("status", "claimed")

    return { ok: !error }
  },

  async completeRun(input: FinishJobInput) {
    const db = createSupabaseAdminClient()

    const { data: row } = await db
      .from("job_runs")
      .select("started_at")
      .eq("id", input.jobRunId)
      .single()

    const finishedAt = new Date()
    const startedAt = row?.started_at ? new Date(row.started_at) : finishedAt
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    const { error } = await db
      .from("job_runs")
      .update({
        status: "succeeded",
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        output_summary: input.outputSummary ?? null,
        lease_token: null,
        lease_expires_at: null,
      })
      .eq("id", input.jobRunId)
      .eq("lease_token", input.leaseToken)

    return { ok: !error }
  },

  async failRun(input: FinishJobInput) {
    const db = createSupabaseAdminClient()

    const { data: row } = await db
      .from("job_runs")
      .select("started_at, attempt, max_attempts, backoff_ms, user_id, mission_id, source, run_key, input_snapshot, priority")
      .eq("id", input.jobRunId)
      .single()

    if (!row) return { ok: false }

    const finishedAt = new Date()
    const startedAt = row.started_at ? new Date(row.started_at) : finishedAt
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    const nextAttempt = (row.attempt ?? 0) + 1
    const isDead = nextAttempt >= (row.max_attempts ?? 1)

    const backoffBase = readIntEnv("NOVA_SCHEDULER_RETRY_BASE_MS", 60_000, 1_000, 3_600_000)
    const backoffMax = readIntEnv("NOVA_SCHEDULER_RETRY_MAX_MS", 900_000, 10_000, 86_400_000)
    const nextBackoffMs = computeRetryDelayMs(nextAttempt, backoffBase, backoffMax, true)

    const { error: failErr } = await db
      .from("job_runs")
      .update({
        status: isDead ? "dead" : "failed",
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        backoff_ms: isDead ? row.backoff_ms ?? 0 : nextBackoffMs,
        error_code: input.errorCode ?? null,
        error_detail: input.errorDetail ?? null,
        lease_token: null,
        lease_expires_at: null,
      })
      .eq("id", input.jobRunId)
      .eq("lease_token", input.leaseToken)

    if (failErr) return { ok: false }

    if (isDead) {
      await appendMissionRunDeadLetter({
        userId: String(row.user_id || ""),
        missionId: String(row.mission_id || ""),
        jobRunId: input.jobRunId,
        attempt: nextAttempt,
        maxAttempts: Math.max(1, Number(row.max_attempts ?? 1)),
        source: String(row.source || "scheduler") as JobRun["source"],
        status: "dead",
        reason: "max_attempts_exhausted",
        errorCode: input.errorCode ?? undefined,
        errorDetail: input.errorDetail ?? undefined,
        retryBackoffMs: row.backoff_ms ?? 0,
      }).catch((err) => {
        console.warn("[JobLedger] appendMissionRunDeadLetter failed:", err instanceof Error ? err.message : err)
      })
      return { ok: true }
    }

    const retryId = generateId("jr")
    const scheduledFor = new Date(Date.now() + nextBackoffMs).toISOString()
    const { error: retryInsertErr } = await db.from("job_runs").insert({
      id: retryId,
      user_id: row.user_id,
      mission_id: row.mission_id,
      status: "pending",
      priority: Number.isFinite(Number(row.priority)) ? Number(row.priority) : 5,
      scheduled_for: scheduledFor,
      attempt: nextAttempt,
      max_attempts: row.max_attempts,
      backoff_ms: nextBackoffMs,
      source: "retry",
      run_key: row.run_key ?? null,
      input_snapshot: row.input_snapshot ?? null,
      created_at: finishedAt.toISOString(),
    })

    if (retryInsertErr) {
      const enqueueFailureDetail = `Retry enqueue failed for ${input.jobRunId}: ${retryInsertErr.message}`
      const { error: markDeadErr } = await db
        .from("job_runs")
        .update({
          status: "dead",
          error_code: "RETRY_ENQUEUE_FAILED",
          error_detail: enqueueFailureDetail,
        })
        .eq("id", input.jobRunId)
        .eq("status", "failed")
      if (markDeadErr) {
        console.warn("[JobLedger] Failed to mark job run dead after retry enqueue failure:", markDeadErr.message)
      }

      await appendMissionRunDeadLetter({
        userId: String(row.user_id || ""),
        missionId: String(row.mission_id || ""),
        jobRunId: input.jobRunId,
        attempt: nextAttempt,
        maxAttempts: Math.max(1, Number(row.max_attempts ?? 1)),
        source: String(row.source || "scheduler") as JobRun["source"],
        status: "retry_enqueue_failed",
        reason: "retry_enqueue_failed",
        errorCode: "RETRY_ENQUEUE_FAILED",
        errorDetail: enqueueFailureDetail,
        retryBackoffMs: nextBackoffMs,
      }).catch((err) => {
        console.warn("[JobLedger] appendMissionRunDeadLetter failed:", err instanceof Error ? err.message : err)
      })

      return { ok: false }
    }

    return { ok: true }
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

  async getPendingRuns(input: GetPendingRunsInput): Promise<JobRun[]> {
    const db = createSupabaseAdminClient()
    const cutoff = (input.now ?? new Date()).toISOString()

    let query = db
      .from("job_runs")
      .select("*")
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

    return data as JobRun[]
  },
}
