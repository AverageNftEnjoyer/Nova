import "server-only"

import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type {
  ClaimResult,
  EnqueueJobInput,
  FinishJobInput,
  JobAuditEvent,
  JobLedgerStore,
  JobRun,
} from "./types"

// ─── env helpers ────────────────────────────────────────────────────────────

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

// ─── id helpers ─────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${ts}_${rand}`
}

// ─── store implementation ────────────────────────────────────────────────────

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
      // Unique constraint violation on idempotency_key → not an error, just a dup
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
    const now = new Date()
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs).toISOString()
    const leaseToken = generateId("lt")

    // Check global inflight count (claimed + running)
    const { count: globalCount, error: globalErr } = await db
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .in("status", ["claimed", "running"])

    if (globalErr) return { ok: false, reason: `DB error checking global inflight: ${globalErr.message}` }
    if ((globalCount ?? 0) >= policy.globalInflightLimit) {
      return {
        ok: false,
        reason: `Mission execution concurrency exceeded global in-flight cap (${policy.globalInflightLimit}).`,
      }
    }

    // Fetch the target run to get user_id for per-user check
    const { data: target, error: fetchErr } = await db
      .from("job_runs")
      .select("user_id, status, attempt, max_attempts")
      .eq("id", input.jobRunId)
      .single()

    if (fetchErr || !target) {
      return { ok: false, reason: `Job run not found: ${input.jobRunId}` }
    }
    if (target.status !== "pending") {
      return { ok: false, reason: `Job run ${input.jobRunId} is not pending (status=${target.status}).` }
    }

    // Check per-user inflight count
    const { count: userCount, error: userErr } = await db
      .from("job_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", target.user_id)
      .in("status", ["claimed", "running"])

    if (userErr) return { ok: false, reason: `DB error checking user inflight: ${userErr.message}` }
    if ((userCount ?? 0) >= policy.perUserInflightLimit) {
      return {
        ok: false,
        reason: `Mission execution concurrency exceeded per-user cap (${policy.perUserInflightLimit}).`,
      }
    }

    // Atomic claim: UPDATE WHERE status = 'pending' to prevent races
    const { data: claimed, error: claimErr } = await db
      .from("job_runs")
      .update({
        status: "claimed",
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        heartbeat_at: now.toISOString(),
      })
      .eq("id", input.jobRunId)
      .eq("status", "pending") // optimistic lock
      .select("*")
      .single()

    if (claimErr || !claimed) {
      return { ok: false, reason: "Failed to claim job run — may have been claimed by another worker." }
    }

    return { ok: true, leaseToken, jobRun: claimed as JobRun }
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

    // Fetch started_at to compute duration
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
      .select("started_at, attempt, max_attempts, backoff_ms, user_id, mission_id, source, run_key, input_snapshot")
      .eq("id", input.jobRunId)
      .single()

    if (!row) return { ok: false }

    const finishedAt = new Date()
    const startedAt = row.started_at ? new Date(row.started_at) : finishedAt
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    const nextAttempt = (row.attempt ?? 0) + 1
    const isDead = nextAttempt >= (row.max_attempts ?? 1)

    // Compute exponential backoff
    const backoffBase = readIntEnv("NOVA_SCHEDULER_RETRY_BASE_MS", 60_000, 1_000, 3_600_000)
    const backoffMax = readIntEnv("NOVA_SCHEDULER_RETRY_MAX_MS", 900_000, 10_000, 86_400_000)
    const jitter = Math.random() * 0.2 - 0.1 // ±10%
    const rawBackoff = backoffBase * Math.pow(2, row.attempt ?? 0) * (1 + jitter)
    const nextBackoffMs = Math.min(Math.round(rawBackoff), backoffMax)

    // Mark current run as failed/dead
    const { error: failErr } = await db
      .from("job_runs")
      .update({
        status: isDead ? "dead" : "failed",
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        error_code: input.errorCode ?? null,
        error_detail: input.errorDetail ?? null,
        lease_token: null,
        lease_expires_at: null,
      })
      .eq("id", input.jobRunId)
      .eq("lease_token", input.leaseToken)

    if (failErr) return { ok: false }

    // If retrying, enqueue a new pending run
    if (!isDead) {
      const retryId = generateId("jr")
      const scheduledFor = new Date(Date.now() + nextBackoffMs).toISOString()

      await db.from("job_runs").insert({
        id: retryId,
        user_id: row.user_id,
        mission_id: row.mission_id,
        status: "pending",
        priority: 5,
        scheduled_for: scheduledFor,
        attempt: nextAttempt,
        max_attempts: row.max_attempts,
        backoff_ms: nextBackoffMs,
        source: "retry",
        run_key: row.run_key ?? null,
        input_snapshot: row.input_snapshot ?? null,
        created_at: finishedAt.toISOString(),
      })
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
    const now = new Date().toISOString()

    // Find all claimed rows whose lease has expired
    const { data: expired, error } = await db
      .from("job_runs")
      .select("id")
      .eq("status", "claimed")
      .lt("lease_expires_at", now)

    if (error || !expired || expired.length === 0) return 0

    const ids = expired.map((r: { id: string }) => r.id)

    const { error: updateErr } = await db
      .from("job_runs")
      .update({
        status: "pending",
        lease_token: null,
        lease_expires_at: null,
        heartbeat_at: null,
      })
      .in("id", ids)
      .eq("status", "claimed") // guard against concurrent update

    if (updateErr) return 0
    return ids.length
  },

  async cancelPendingForMission(input: { userId: string; missionId: string }) {
    const db = createSupabaseAdminClient()

    const { data, error } = await db
      .from("job_runs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("user_id", input.userId)
      .eq("mission_id", input.missionId)
      .in("status", ["pending", "claimed"])
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
}
