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
  /** Must be called in finally — marks the job run terminal in Supabase. */
  release: () => Promise<void>
}

export type MissionExecutionGuardDecision = {
  ok: boolean
  reason?: string
  slot?: MissionExecutionSlot
}

/**
 * Enqueue + atomically claim a job run in Supabase.
 * Replaces the former globalThis.__novaMissionExecutionInflight in-memory map.
 *
 * Concurrency caps (per-user and global) are enforced by the job ledger
 * via DB COUNT queries against status IN ('claimed','running').
 */
export async function acquireMissionExecutionSlot(input: {
  userContextId: string
  missionId: string
  missionRunId: string
}): Promise<MissionExecutionGuardDecision> {
  const { userContextId, missionId, missionRunId } = input

  if (!userContextId || !missionId || !missionRunId) {
    // Missing context — allow execution but skip ledger tracking
    return { ok: true, slot: makeNoopSlot() }
  }

  // 1. Enqueue the run record
  const enqueueResult = await jobLedger.enqueue({
    id: missionRunId,
    user_id: userContextId,
    mission_id: missionId,
    source: "scheduler",
    max_attempts: 1,
  })

  if (!enqueueResult.ok) {
    if (enqueueResult.error === "duplicate_idempotency_key") {
      return { ok: false, reason: "Duplicate run — already enqueued with this ID." }
    }
    // Supabase unavailable — fail open so we don't block all missions during DB outage
    console.warn("[ExecutionGuard] Failed to enqueue job run, proceeding without ledger:", enqueueResult.error)
    return { ok: true, slot: makeNoopSlot() }
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
  await jobLedger.startRun({ jobRunId: missionRunId, leaseToken: claimResult.leaseToken }).catch((err) => {
    console.warn("[ExecutionGuard] Failed to transition job run to running:", err)
  })

  // Fail-safe default: if release() is called without reportOutcome(), mark failed
  let outcomeSuccess = false
  let outcomeErrorDetail: string | undefined

  return {
    ok: true,
    slot: {
      jobRunId: missionRunId,
      leaseToken: claimResult.leaseToken,
      reportOutcome(success: boolean, errorDetail?: string) {
        outcomeSuccess = success
        outcomeErrorDetail = errorDetail
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
            errorDetail: outcomeErrorDetail,
          }).catch(() => {})
        }
      },
    },
  }
}

/** Noop slot used when ledger tracking is skipped (missing context, DB outage). */
function makeNoopSlot(): MissionExecutionSlot {
  return {
    jobRunId: "",
    leaseToken: "",
    reportOutcome: () => undefined,
    release: async () => undefined,
  }
}
