/**
 * Execution Tick — Phase 4 job-driven execution loop with own timer.
 *
 * Decouples "discovery" (scheduler enqueues pending job_runs) from "execution"
 * (this tick claims pending runs and executes them). Benefits:
 *   - Horizontal scale: multiple workers can execute without double-firing
 *   - Durable retries: ledger re-enqueues failed runs with backoff
 *   - Clean separation of scheduling policy from execution mechanics
 *   - Phase 4: own 5s timer loop, heartbeat support, observability state
 */

import "server-only"

import { jobLedger } from "../job-ledger/store"
import { loadMissions, upsertMission } from "../store"
import { deleteRescheduleOverride } from "@/lib/calendar/reschedule-store"
import { executeMission } from "./execute-mission"
import { makePreClaimedSlot } from "./execution-guard"
import { getLocalParts } from "./time"
import { resolveTimezone } from "@/lib/shared/timezone"
import type { JobRun } from "../job-ledger/types"
import type { Mission } from "../types"

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = String(process.env[name] || "").trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

/** Max pending runs to dequeue per execution-tick invocation. */
const EXECUTION_TICK_BATCH_SIZE = readIntEnv("NOVA_EXECUTION_TICK_BATCH_SIZE", 10, 1, 50)

/** How long the execution-tick holds a lease on a claimed run (default 10 min). */
const EXECUTION_TICK_LEASE_MS = readIntEnv("NOVA_EXECUTION_TICK_LEASE_MS", 10 * 60_000, 60_000, 30 * 60_000)

/** How often the execution-tick timer fires (default 5s). */
const EXECUTION_TICK_INTERVAL_MS = readIntEnv("NOVA_EXECUTION_TICK_INTERVAL_MS", 5_000, 1_000, 60_000)

/** Watchdog: reset stuck tickInFlight after this many ms (default 15 min). */
const EXECUTION_TICK_WATCHDOG_MS = readIntEnv("NOVA_EXECUTION_TICK_WATCHDOG_MS", 15 * 60_000, 60_000, 60 * 60_000)

// ─────────────────────────────────────────────────────────────────────────────
// State singleton (mirrors SchedulerState pattern)
// ─────────────────────────────────────────────────────────────────────────────

type ExecutionTickState = {
  timer: NodeJS.Timeout | null
  running: boolean
  tickInFlight: boolean
  tickIntervalMs: number
  lastTickStartedAt?: string
  lastTickFinishedAt?: string
  lastTickDurationMs?: number
  lastTickClaimedCount: number
  lastTickCompletedCount: number
  lastTickFailedCount: number
  lastTickSkippedCount: number
  totalTickCount: number
  overlapSkipCount: number
  lastTickError?: string
}

const etState = (
  (globalThis as { __novaExecutionTick?: ExecutionTickState }).__novaExecutionTick ??
  ({
    timer: null,
    running: false,
    tickInFlight: false,
    tickIntervalMs: EXECUTION_TICK_INTERVAL_MS,
    lastTickClaimedCount: 0,
    lastTickCompletedCount: 0,
    lastTickFailedCount: 0,
    lastTickSkippedCount: 0,
    totalTickCount: 0,
    overlapSkipCount: 0,
  } satisfies ExecutionTickState)
)
;(globalThis as { __novaExecutionTick?: ExecutionTickState }).__novaExecutionTick = etState

// ─────────────────────────────────────────────────────────────────────────────
// Single-run executor
// ─────────────────────────────────────────────────────────────────────────────

async function executeRun(run: JobRun, now: Date): Promise<"completed" | "failed" | "skipped"> {
  // Atomically claim the run — prevents double-execution when multiple workers overlap.
  const claimResult = await jobLedger.claimRun({
    jobRunId: run.id,
    leaseDurationMs: EXECUTION_TICK_LEASE_MS,
  })
  if (!claimResult.ok) return "skipped" // another worker claimed it first

  // Transition claimed → running (sets started_at). Capture result for heartbeat decision.
  const startResult = await jobLedger.startRun({ jobRunId: run.id, leaseToken: claimResult.leaseToken }).catch((err) => {
    console.warn("[ExecutionTick] startRun failed:", run.id, err instanceof Error ? err.message : err)
    return { ok: false }
  })

  // Heartbeat: renew the lease at 1/3 of the lease duration so the run stays
  // alive during long executions. Only start if startRun succeeded (row is 'running').
  const heartbeatIntervalMs = Math.floor(EXECUTION_TICK_LEASE_MS / 3)
  let heartbeatTimer: NodeJS.Timeout | null = null
  if (startResult.ok) {
    heartbeatTimer = setInterval(() => {
      jobLedger.heartbeat({ jobRunId: run.id, leaseToken: claimResult.leaseToken, leaseDurationMs: EXECUTION_TICK_LEASE_MS }).catch((err) => {
        console.warn("[ExecutionTick] heartbeat failed:", run.id, err instanceof Error ? err.message : err)
      })
    }, heartbeatIntervalMs)
  }

  try {
    // Load the mission fresh from the store.
    let missions: Mission[]
    try {
      missions = await loadMissions({ userId: run.user_id })
    } catch (err) {
      console.error("[ExecutionTick] loadMissions threw for run:", run.id, err instanceof Error ? err.message : err)
      await jobLedger.failRun({
        jobRunId: run.id,
        leaseToken: claimResult.leaseToken,
        errorCode: "LOAD_MISSIONS_ERROR",
        errorDetail: err instanceof Error ? err.message : String(err),
      }).catch(() => {})
      return "failed"
    }

    const mission = missions.find((m) => m.id === run.mission_id)

    if (!mission) {
      await jobLedger.failRun({
        jobRunId: run.id,
        leaseToken: claimResult.leaseToken,
        errorCode: "MISSION_NOT_FOUND",
        errorDetail: `Mission ${run.mission_id} not found for user ${run.user_id}`,
      }).catch(() => {})
      return "failed"
    }

    // Apply scheduledAtOverride from input_snapshot (set by scheduler when a
    // calendar reschedule override was active at enqueue time).
    const scheduledAtOverride =
      typeof run.input_snapshot?.scheduledAtOverride === "string" ? run.input_snapshot.scheduledAtOverride : undefined
    const missionToRun: Mission = scheduledAtOverride ? { ...mission, scheduledAtOverride } : mission

    // Build a pre-claimed slot — executeMissionCore will use it instead of re-enqueuing.
    const slot = makePreClaimedSlot(run.id, claimResult.leaseToken)

    const scope = mission.userId
      ? { userId: mission.userId, allowServiceRole: true as const, serviceRoleReason: "execution-tick" as const }
      : undefined

    const source: "scheduler" | "trigger" | "manual" =
      run.source === "manual" ? "manual" : run.source === "webhook" ? "trigger" : "scheduler"

    try {
      const result = await executeMission({
        mission: missionToRun,
        source,
        now,
        missionRunId: run.id,
        attempt: (run.attempt ?? 0) + 1,
        scope,
        preClaimedSlot: slot,
      })

      if (!result.skipped) {
        // Compute day stamp for the day-lock so the scheduler won't re-enqueue today.
        const triggerNode = mission.nodes.find((n) => n.type === "schedule-trigger") as
          | { triggerMode?: string; triggerTimezone?: string }
          | undefined
        const mode = String(triggerNode?.triggerMode || "daily")
        const tz = resolveTimezone(triggerNode?.triggerTimezone, mission.settings?.timezone)
        const local = getLocalParts(now, tz)
        const dayStamp =
          (mode === "daily" || mode === "weekly" || mode === "once") && local?.dayStamp ? local.dayStamp : undefined

        await upsertMission(
          {
            ...mission,
            lastRunAt: now.toISOString(),
            lastSentLocalDate: dayStamp ?? mission.lastSentLocalDate,
            runCount: (mission.runCount || 0) + 1,
            successCount: result.ok ? (mission.successCount || 0) + 1 : mission.successCount || 0,
            failureCount: result.ok ? mission.failureCount || 0 : (mission.failureCount || 0) + 1,
            lastRunStatus: result.ok ? ("success" as const) : ("error" as const),
            scheduledAtOverride: undefined,
          },
          mission.userId || "",
        ).catch((err) => {
          console.warn("[ExecutionTick] upsertMission failed:", mission.id, err instanceof Error ? err.message : err)
        })

        // Clean up the calendar reschedule override now that execution succeeded.
        if (result.ok && scheduledAtOverride && mission.userId) {
          deleteRescheduleOverride(mission.userId, mission.id).catch(() => {})
        }

        return result.ok ? "completed" : "failed"
      }

      return "skipped"
    } catch (err) {
      console.error("[ExecutionTick] Mission execution threw:", run.mission_id, err instanceof Error ? err.message : err)
      return "failed"
    }
  } finally {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch executor
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionTickResult = {
  claimed: number
  completed: number
  failed: number
  skipped: number
}

/**
 * Internal: reclaim expired leases, then poll + execute pending runs.
 * Called by the timer loop and by the public runExecutionTick() wrapper.
 */
async function runExecutionTickInternal(): Promise<ExecutionTickResult> {
  // Reclaim any 'claimed' or 'running' rows whose lease expired (server crash,
  // stuck worker). Best-effort — failure here does not abort the tick.
  await jobLedger.reclaimExpiredLeases().catch((err) => {
    console.warn("[ExecutionTick] reclaimExpiredLeases failed:", err instanceof Error ? err.message : err)
  })

  const now = new Date()

  const pendingRuns = await jobLedger.getPendingRuns({
    limit: EXECUTION_TICK_BATCH_SIZE,
    now,
  })

  let claimed = 0
  let completed = 0
  let failed = 0
  let skipped = 0

  await Promise.all(
    pendingRuns.map(async (run) => {
      const outcome = await executeRun(run, now)
      if (outcome === "skipped") {
        skipped++
      } else {
        claimed++
        if (outcome === "completed") completed++
        else failed++
      }
    }),
  )

  return { claimed, completed, failed, skipped }
}

/**
 * Poll pending job_runs, claim each one atomically, and execute the
 * associated mission with a pre-claimed slot (bypassing re-enqueue).
 *
 * Runs in parallel up to EXECUTION_TICK_BATCH_SIZE — each run is
 * independently claimed so there is no double-execution risk.
 */
export async function runExecutionTick(): Promise<ExecutionTickResult> {
  return runExecutionTickInternal()
}

// ─────────────────────────────────────────────────────────────────────────────
// Timer loop (Phase 4 — own background loop, no leader election)
// ─────────────────────────────────────────────────────────────────────────────

async function runExecutionTickLoop(): Promise<void> {
  // Watchdog: if a previous tick has been in-flight for > WATCHDOG_MS it is assumed hung; reset it.
  if (etState.tickInFlight && etState.lastTickStartedAt) {
    const elapsedMs = Date.now() - new Date(etState.lastTickStartedAt).getTime()
    if (elapsedMs > EXECUTION_TICK_WATCHDOG_MS) {
      etState.tickInFlight = false
      etState.lastTickError = `ExecutionTick watchdog: reset tickInFlight after ${Math.round(elapsedMs / 1000)}s hung tick.`
    }
  }
  if (etState.tickInFlight) {
    etState.overlapSkipCount += 1
    return
  }

  etState.tickInFlight = true
  etState.lastTickStartedAt = new Date().toISOString()
  const tickStartedAt = Date.now()
  try {
    const result = await runExecutionTickInternal()
    etState.lastTickClaimedCount = result.claimed
    etState.lastTickCompletedCount = result.completed
    etState.lastTickFailedCount = result.failed
    etState.lastTickSkippedCount = result.skipped
    etState.lastTickError = ""
  } catch (err) {
    etState.lastTickError = err instanceof Error ? err.message : "Unknown execution-tick error."
  } finally {
    etState.lastTickDurationMs = Date.now() - tickStartedAt
    etState.lastTickFinishedAt = new Date().toISOString()
    etState.totalTickCount += 1
    etState.tickInFlight = false
    // No lease renewal — execution-tick has no leader election (atomic claimRun is sufficient).
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 public API — own timer loop + observability
// ─────────────────────────────────────────────────────────────────────────────

export function getExecutionTickState() {
  return {
    running: etState.running,
    tickInFlight: etState.tickInFlight,
    tickIntervalMs: etState.tickIntervalMs,
    totalTickCount: etState.totalTickCount,
    overlapSkipCount: etState.overlapSkipCount,
    lastTickStartedAt: etState.lastTickStartedAt ?? null,
    lastTickFinishedAt: etState.lastTickFinishedAt ?? null,
    lastTickDurationMs: Number.isFinite(etState.lastTickDurationMs) ? etState.lastTickDurationMs : null,
    lastTickClaimedCount: etState.lastTickClaimedCount,
    lastTickCompletedCount: etState.lastTickCompletedCount,
    lastTickFailedCount: etState.lastTickFailedCount,
    lastTickSkippedCount: etState.lastTickSkippedCount,
    lastTickError: etState.lastTickError ?? null,
  }
}

export function ensureExecutionTickStarted(): { running: boolean } {
  if (etState.running && etState.timer) {
    return { running: true }
  }

  etState.running = true
  etState.tickIntervalMs = EXECUTION_TICK_INTERVAL_MS
  void runExecutionTickLoop()
  etState.timer = setInterval(() => {
    void runExecutionTickLoop()
  }, etState.tickIntervalMs)
  etState.timer.unref() // don't keep the process alive if the event loop is otherwise idle

  return { running: true }
}

export function stopExecutionTick(): { running: boolean } {
  if (etState.timer) {
    clearInterval(etState.timer)
    etState.timer = null
  }
  etState.running = false
  return { running: false }
}
