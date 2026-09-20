import "server-only"

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
  ClaimResult,
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

// In-memory storage for local-only mode
const jobRuns = new Map<string, JobRun>()
const auditEvents = new Map<string, JobAuditEvent[]>()
const schedulerLeases = new Map<string, { holderId: string; expiresAt: Date }>()

export const jobLedger: JobLedgerStore = {
  async enqueue(input: EnqueueJobInput) {
    const now = new Date().toISOString()

    // Check idempotency
    if (input.idempotency_key) {
      for (const run of jobRuns.values()) {
        if (run.idempotency_key === input.idempotency_key && run.user_id === input.user_id) {
          return { ok: false, error: "Job with this idempotency key already exists" }
        }
      }
    }

    const row: JobRun = {
      id: input.id,
      user_id: input.user_id,
      mission_id: input.mission_id,
      idempotency_key: input.idempotency_key ?? null,
      status: "pending",
      priority: input.priority ?? 5,
      scheduled_for: input.scheduled_for ?? now,
      lease_token: null,
      lease_expires_at: null,
      heartbeat_at: null,
      attempt: 0,
      max_attempts: input.max_attempts ?? 1,
      backoff_ms: 0,
      source: input.source ?? "scheduler",
      run_key: input.run_key ?? null,
      input_snapshot: input.input_snapshot ?? null,
      output_summary: null,
      error_code: null,
      error_detail: null,
      created_at: now,
      started_at: null,
      finished_at: null,
      duration_ms: null,
    }

    jobRuns.set(row.id, row)

    await jobLedger.auditEvent({
      jobRunId: row.id,
      userId: row.user_id,
      event: "job.enqueued",
      actor: "system",
      metadata: { source: row.source, priority: row.priority },
    })

    return { ok: true }
  },

  async claimRun(input: { jobRunId: string; leaseDurationMs: number }): Promise<ClaimResult> {
    const policy = concurrencyPolicy()
    const run = jobRuns.get(input.jobRunId)

    if (!run) {
      return { ok: false, reason: `Job run not found: ${input.jobRunId}` }
    }

    if (run.status !== "pending") {
      return { ok: false, reason: `Job run ${input.jobRunId} is not pending (status=${run.status}).` }
    }

    // Check concurrency limits
    const inflightRuns = Array.from(jobRuns.values()).filter(
      r => r.status === "claimed" || r.status === "running"
    )

    if (inflightRuns.length >= policy.globalInflightLimit) {
      return {
        ok: false,
        reason: `Mission execution concurrency exceeded global in-flight cap (${policy.globalInflightLimit}).`,
      }
    }

    const userInflightRuns = inflightRuns.filter(r => r.user_id === run.user_id)
    if (userInflightRuns.length >= policy.perUserInflightLimit) {
      return {
        ok: false,
        reason: `Mission execution concurrency exceeded per-user cap (${policy.perUserInflightLimit}).`,
      }
    }

    // Claim the run
    const leaseToken = generateId("lease")
    const now = new Date()
    const expiresAt = new Date(now.getTime() + input.leaseDurationMs)

    run.status = "claimed"
    run.lease_token = leaseToken
    run.lease_expires_at = expiresAt.toISOString()
    run.heartbeat_at = now.toISOString()

    await jobLedger.auditEvent({
      jobRunId: run.id,
      userId: run.user_id,
      event: "job.claimed",
      actor: "scheduler",
      metadata: { leaseToken, leaseDurationMs: input.leaseDurationMs },
    })

    return { ok: true, leaseToken }
  },

  async heartbeat(input: { jobRunId: string; leaseToken: string; leaseDurationMs: number }) {
    const run = jobRuns.get(input.jobRunId)

    if (!run || run.lease_token !== input.leaseToken) {
      return { ok: false }
    }

    const now = new Date()
    run.heartbeat_at = now.toISOString()
    run.lease_expires_at = new Date(now.getTime() + input.leaseDurationMs).toISOString()

    return { ok: true }
  },

  async startRun(input: { jobRunId: string; leaseToken: string }) {
    const run = jobRuns.get(input.jobRunId)

    if (!run || run.lease_token !== input.leaseToken) {
      return { ok: false, startedAt: null }
    }

    const now = new Date().toISOString()
    run.status = "running"
    run.started_at = now

    await jobLedger.auditEvent({
      jobRunId: run.id,
      userId: run.user_id,
      event: "job.started",
      actor: "executor",
    })

    return { ok: true, startedAt: now }
  },

  async completeRun(input: CompleteJobInput) {
    const run = jobRuns.get(input.jobRunId)

    if (!run || run.lease_token !== input.leaseToken) {
      return { ok: false }
    }

    const now = new Date()
    run.status = "succeeded"
    run.finished_at = now.toISOString()
    run.output_summary = input.outputSummary ?? null

    if (run.started_at) {
      run.duration_ms = now.getTime() - new Date(run.started_at).getTime()
    }

    run.lease_token = null
    run.lease_expires_at = null

    await jobLedger.auditEvent({
      jobRunId: run.id,
      userId: run.user_id,
      event: "job.succeeded",
      actor: "executor",
      metadata: { durationMs: run.duration_ms },
    })

    return { ok: true }
  },

  async failRun(input: FailJobInput) {
    const run = jobRuns.get(input.jobRunId)

    if (!run || run.lease_token !== input.leaseToken) {
      return { ok: false }
    }

    const now = new Date()
    const startedAt = input.startedAt ? new Date(input.startedAt) : (run.started_at ? new Date(run.started_at) : now)
    const durationMs = now.getTime() - startedAt.getTime()

    run.error_code = input.errorCode ?? "unknown"
    run.error_detail = input.errorDetail ?? ""
    run.finished_at = now.toISOString()
    run.duration_ms = durationMs
    run.lease_token = null
    run.lease_expires_at = null

    const shouldRetry = run.attempt + 1 < run.max_attempts

    if (shouldRetry) {
      // Retry logic
      const nextAttempt = run.attempt + 1
      const backoffMs = Math.min(60_000 * Math.pow(2, nextAttempt), 15 * 60_000)

      run.status = "pending"
      run.attempt = nextAttempt
      run.backoff_ms = backoffMs
      run.scheduled_for = new Date(now.getTime() + backoffMs).toISOString()
      run.error_code = null
      run.error_detail = null
      run.finished_at = null
      run.duration_ms = null

      await jobLedger.auditEvent({
        jobRunId: run.id,
        userId: run.user_id,
        event: "job.retrying",
        actor: "executor",
        metadata: { attempt: nextAttempt, backoffMs },
      })
    } else {
      // Final failure
      run.status = "dead"

      await jobLedger.auditEvent({
        jobRunId: run.id,
        userId: run.user_id,
        event: "job.dead",
        actor: "executor",
        metadata: { errorCode: run.error_code, errorDetail: run.error_detail },
      })

      // Append to dead letter
      await appendMissionRunDeadLetter({
        jobRunId: run.id,
        userId: run.user_id,
        missionId: run.mission_id,
        attempt: run.attempt,
        maxAttempts: run.max_attempts,
        source: run.source,
        status: "dead",
        reason: run.error_detail || "Max attempts exceeded",
        errorCode: run.error_code || undefined,
        errorDetail: run.error_detail || undefined,
      })
    }

    return { ok: true }
  },

  async cancelRun(input: { jobRunId: string; userId: string }) {
    const run = jobRuns.get(input.jobRunId)

    if (!run || run.user_id !== input.userId) {
      return { ok: false }
    }

    if (run.status === "succeeded" || run.status === "failed" || run.status === "dead" || run.status === "cancelled") {
      return { ok: false }
    }

    run.status = "cancelled"
    run.finished_at = new Date().toISOString()
    run.lease_token = null
    run.lease_expires_at = null

    await jobLedger.auditEvent({
      jobRunId: run.id,
      userId: run.user_id,
      event: "job.cancelled",
      actor: "user",
    })

    return { ok: true }
  },

  async reclaimExpiredLeases() {
    const now = new Date()
    let count = 0

    for (const run of jobRuns.values()) {
      if (run.status === "claimed" && run.lease_expires_at) {
        const expiresAt = new Date(run.lease_expires_at)
        if (expiresAt < now) {
          run.status = "pending"
          run.lease_token = null
          run.lease_expires_at = null
          run.heartbeat_at = null
          count++

          await jobLedger.auditEvent({
            jobRunId: run.id,
            userId: run.user_id,
            event: "job.lease_reclaimed",
            actor: "scheduler",
          })
        }
      }
    }

    return count
  },

  async cancelPendingForMission(input: { userId: string; missionId: string }) {
    let count = 0

    for (const run of jobRuns.values()) {
      if (
        run.user_id === input.userId &&
        run.mission_id === input.missionId &&
        (run.status === "pending" || run.status === "claimed")
      ) {
        run.status = "cancelled"
        run.finished_at = new Date().toISOString()
        run.lease_token = null
        run.lease_expires_at = null
        count++

        await jobLedger.auditEvent({
          jobRunId: run.id,
          userId: run.user_id,
          event: "job.cancelled",
          actor: "mission_delete",
        })
      }
    }

    return count
  },

  async auditEvent(input: {
    jobRunId: string
    userId: string
    event: string
    actor: string
    metadata?: Record<string, unknown>
  }) {
    const event: JobAuditEvent = {
      id: generateId("audit"),
      job_run_id: input.jobRunId,
      user_id: input.userId,
      event: input.event,
      actor: input.actor,
      ts: new Date().toISOString(),
      metadata: input.metadata ?? null,
    }

    const events = auditEvents.get(input.jobRunId) ?? []
    events.push(event)
    auditEvents.set(input.jobRunId, events)
  },

  async acquireSchedulerLease(input: {
    scope: string
    holderId: string
    ttlMs: number
  }): Promise<SchedulerLeaseResult> {
    const now = new Date()
    const existing = schedulerLeases.get(input.scope)

    if (existing && existing.expiresAt > now) {
      return { acquired: false, reason: "already_held" }
    }

    const expiresAt = new Date(now.getTime() + input.ttlMs)
    schedulerLeases.set(input.scope, { holderId: input.holderId, expiresAt })

    return {
      acquired: true,
      scope: input.scope,
      holderId: input.holderId,
      expiresAt: expiresAt.toISOString(),
    }
  },

  async renewSchedulerLease(input: { scope: string; holderId: string; ttlMs: number }) {
    const existing = schedulerLeases.get(input.scope)

    if (!existing || existing.holderId !== input.holderId) {
      return { ok: false }
    }

    const expiresAt = new Date(Date.now() + input.ttlMs)
    schedulerLeases.set(input.scope, { holderId: input.holderId, expiresAt })

    return { ok: true }
  },

  async releaseSchedulerLease(input: { scope: string; holderId: string }) {
    const existing = schedulerLeases.get(input.scope)

    if (!existing || existing.holderId !== input.holderId) {
      return { ok: false }
    }

    schedulerLeases.delete(input.scope)
    return { ok: true }
  },

  async getPendingRuns(input: GetPendingRunsInput): Promise<PendingJobRun[]> {
    const now = input.now ?? new Date()
    const runs: PendingJobRun[] = []

    for (const run of jobRuns.values()) {
      if (run.status !== "pending") continue

      const scheduledFor = new Date(run.scheduled_for)
      if (scheduledFor > now) continue

      if (input.userIds && !input.userIds.includes(run.user_id)) continue

      runs.push({
        id: run.id,
        user_id: run.user_id,
        mission_id: run.mission_id,
        priority: run.priority,
        scheduled_for: run.scheduled_for,
        attempt: run.attempt,
        source: run.source,
        input_snapshot: run.input_snapshot,
      })
    }

    // Sort by priority DESC, scheduled_for ASC
    runs.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.scheduled_for.localeCompare(b.scheduled_for)
    })

    return runs.slice(0, input.limit)
  },
}
