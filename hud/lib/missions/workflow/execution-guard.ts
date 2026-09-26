import "server-only"

import { jobLedger } from "../job-ledger/store"

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export const MISSION_EXECUTION_GUARD_POLICY = {
  get perUserInflightLimit() {
    return readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_PER_USER", 3, 1, 100)
  },
  get globalInflightLimit() {
    return readIntEnv("NOVA_MISSION_EXECUTION_MAX_INFLIGHT_GLOBAL", 200, 1, 5000)
  },
  get slotTtlMs() {
    return readIntEnv("NOVA_MISSION_EXECUTION_SLOT_TTL_MS", 15 * 60_000, 30_000, 24 * 60 * 60_000)
  },
} as const

export type MissionExecutionSlot = {
  jobRunId: string
  leaseToken: string
  /** Call before returning from the execution engine so release() knows the outcome. */
  reportOutcome: (success: boolean, errorDetail?: string) => void
  /** Must be called in finally — marks the job run terminal in the job ledger (SQLite). */
  release: () => Promise<void>
}

export type MissionExecutionGuardDecision = {
  ok: boolean
  reason?: string
  slot?: MissionExecutionSlot
}

/**
 * Enqueue + atomically claim a job run in the SQLite job ledger.
 * Replaces the former globalThis.__novaMissionExecutionInflight in-memory map.
 *
 * Concurrency caps (per-user and global) are enforced by the job ledger
 * via DB COUNT queries against status IN ('claimed','running').
 */
export async function acquireMissionExecutionSlot(input: {
  userContextId: string
  missionId: string
  missionRunId: string
  maxAttempts?: number
  source?: "scheduler" | "manual" | "trigger"
}): Promise<MissionExecutionGuardDecision> {
  const { userContextId, missionId, missionRunId, maxAttempts } = input

  if (!userContextId || !missionId || !missionRunId) {
    return { ok: false, reason: "Mission execution requires user, mission, and run identifiers." }
  }

  // 1. Enqueue the run record
  const ledgerSource = input.source === "manual" ? "manual" : input.source === "trigger" ? "webhook" : "scheduler"
  const enqueueResult = await jobLedger.enqueue({
    id: missionRunId,
    user_id: userContextId,
    mission_id: missionId,
    source: ledgerSource,
    max_attempts: maxAttempts ?? 1,
  })

  if (!enqueueResult.ok) {
    if (enqueueResult.error === "duplicate_idempotency_key") {
      return { ok: false, reason: "Duplicate run — already enqueued with this ID." }
    }
    console.warn("[ExecutionGuard] Failed to enqueue job run:", enqueueResult.error)
    return { ok: false, reason: `Mission run could not be recorded: ${enqueueResult.error || "ledger unavailable"}` }
  }

  // 2. Claim the run (checks concurrency caps atomically)
  const claimResult = await jobLedger.claimRun({
    jobRunId: missionRunId,
    leaseDurationMs: MISSION_EXECUTION_GUARD_POLICY.slotTtlMs,
  })

  if (!claimResult.ok) {
    // Cancel the pending run we just enqueued since we won't execute it
    void jobLedger.cancelRun({ jobRunId: missionRunId, userId: userContextId }).catch((err) => {
      console.warn("[ExecutionGuard] Failed to cancel pending run after concurrency rejection:", err)
    })
    return { ok: false, reason: claimResult.reason }
  }

  // 3. Transition claimed → running
  const startResult = await jobLedger.startRun({ jobRunId: missionRunId, leaseToken: claimResult.leaseToken }).catch((err) => {
    console.warn("[ExecutionGuard] Failed to transition job run to running:", err)
    return { ok: false, startedAt: null }
  })

  // Fail-safe default: if release() is called without reportOutcome(), mark failed.
  // outcomeReported guards against the catch-block in execute-mission overwriting
  // a prior reportOutcome(true) call (e.g. schedule gate skip) with false.
  let outcomeSuccess = false
  let outcomeErrorDetail: string | undefined
  let outcomeReported = false

  return {
    ok: true,
    slot: {
      jobRunId: missionRunId,
      leaseToken: claimResult.leaseToken,
      reportOutcome(success: boolean, errorDetail?: string) {
        if (outcomeReported) return // first caller wins
        outcomeSuccess = success
        outcomeErrorDetail = errorDetail
        outcomeReported = true
      },
      async release() {
        if (outcomeSuccess) {
          await jobLedger.completeRun({
            jobRunId: missionRunId,
            leaseToken: claimResult.leaseToken,
          }).catch(() => {})
        } else {
          await jobLedger.failRun({
            jobRunId: missionRunId,
            leaseToken: claimResult.leaseToken,
            startedAt: startResult.startedAt,
            errorDetail: outcomeErrorDetail,
          }).catch(() => {})
        }
      },
    },
  }
}

/**
 * Build a MissionExecutionSlot from an already-claimed job run.
 * Used by execution-tick to inject a pre-claimed slot into executeMission
 * so executeMissionCore bypasses the enqueue+claim step.
 *
 * Pass `heartbeatConfig` to let the slot self-manage the lease heartbeat.
 * The heartbeat starts immediately and is cleared inside `release()`, which
 * means the lease stays alive for as long as executeMissionCore is running —
 * even after the caller (executeRun) has returned due to a per-run timeout.
 * Without this, clearing the heartbeat in executeRun's finally would leave the
 * background execution without lease coverage, causing reclaimExpiredLeases()
 * to reset the run to pending and trigger a second execution.
 */
export function makePreClaimedSlot(
  jobRunId: string,
  leaseToken: string,
  options?: {
    heartbeatConfig?: { intervalMs: number; onBeat: () => Promise<void> }
    startedAt?: string | null
  },
): MissionExecutionSlot {
  let outcomeSuccess = false
  let outcomeErrorDetail: string | undefined
  let outcomeReported = false

  let heartbeatTimer: NodeJS.Timeout | null = null
  if (options?.heartbeatConfig) {
    heartbeatTimer = setInterval(
      () => { options.heartbeatConfig?.onBeat().catch(() => {}) },
      options.heartbeatConfig.intervalMs,
    )
  }

  return {
    jobRunId,
    leaseToken,
    reportOutcome(success: boolean, errorDetail?: string) {
      if (outcomeReported) return
      outcomeSuccess = success
      outcomeErrorDetail = errorDetail
      outcomeReported = true
    },
    async release() {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      if (outcomeSuccess) {
        await jobLedger.completeRun({ jobRunId, leaseToken }).catch(() => {})
      } else {
        await jobLedger.failRun({
          jobRunId,
          leaseToken,
          startedAt: options?.startedAt,
          errorDetail: outcomeErrorDetail,
        }).catch(() => {})
      }
    },
  }
}
