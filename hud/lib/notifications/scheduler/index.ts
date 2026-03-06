import "server-only"

import { loadMissions } from "../../../../src/runtime/modules/services/missions/persistence/index.js"
import { runMissionScheduleTick } from "../../../../src/runtime/modules/services/missions/scheduler-core/index.js"
import { getRescheduleOverride } from "@/lib/calendar/reschedule-store"
import { getLocalParts } from "@/lib/missions/workflow/time"
import { resolveTimezone } from "@/lib/shared/timezone"
import { jobLedger } from "@/lib/missions/job-ledger/store"
import { ensureExecutionTickStarted, stopExecutionTick } from "@/lib/missions/workflow/execution-tick"

type SchedulerState = {
  timer: NodeJS.Timeout | null
  running: boolean
  tickInFlight: boolean
  tickIntervalMs: number
  lastTickStartedAt?: string
  lastTickFinishedAt?: string
  lastTickDurationMs?: number
  lastTickDueCount: number
  lastTickRunCount: number
  totalTickCount: number
  overlapSkipCount: number
  lastTickError?: string
  // Leader election (Phase 2)
  leaseSkipCount: number
  isLeader: boolean
}

const SCHEDULER_TICK_MS = Math.max(
  10_000,
  Math.min(300_000, Number.parseInt(process.env.NOVA_SCHEDULER_TICK_MS || "30000", 10) || 30_000),
)
// Leader election — each process instance gets a stable ID for the duration of its lifetime.
// The lease TTL is 3× the tick interval: long enough to survive a full tick, short enough
// that a crashed instance's lease expires within 3 ticks and another can take over.
const SCHEDULER_LEASE_SCOPE = "global"
const SCHEDULER_LEASE_TTL_MS = Math.max(3 * SCHEDULER_TICK_MS, 2 * 60_000)
const SCHEDULER_HOLDER_ID: string = ((globalThis as Record<string, unknown>).__novaMissionSchedulerHolderId ??=
  crypto.randomUUID()) as string
const state = (globalThis as { __novaMissionScheduler?: SchedulerState }).__novaMissionScheduler ?? {
  timer: null,
  running: false,
  tickInFlight: false,
  tickIntervalMs: SCHEDULER_TICK_MS,
  lastTickDueCount: 0,
  lastTickRunCount: 0,
  totalTickCount: 0,
  overlapSkipCount: 0,
  leaseSkipCount: 0,
  isLeader: false,
}

;(globalThis as { __novaMissionScheduler?: SchedulerState }).__novaMissionScheduler = state

async function runScheduleTickInternal() {
  // Contract delegated to scheduler-core:
  // - jobLedger.reclaimExpiredLeases()
  // - loadMissions({ allUsers: true })
  // - const idempotencyKey = `${mission.id}:${nativeDayStamp}`
  // - jobLedger.enqueue({ ..., idempotency_key: idempotencyKey, source: "scheduler", priority: 5 })
  // - max_attempts: liveMission.settings.retryOnFail ? liveMission.settings.retryCount + 1 : 1
  return runMissionScheduleTick({
    loadMissions,
    getRescheduleOverride,
    getLocalParts,
    resolveTimezone,
    jobLedger,
    warn: console.warn,
    error: console.error,
  })
}

const TICK_WATCHDOG_MS = 10 * 60_000 // Reset stuck tickInFlight after 10 minutes

async function runScheduleTick() {
  // Watchdog: if a previous tick has been in-flight for > 10 min it is assumed hung; reset it.
  if (state.tickInFlight && state.lastTickStartedAt) {
    const elapsedMs = Date.now() - new Date(state.lastTickStartedAt).getTime()
    if (elapsedMs > TICK_WATCHDOG_MS) {
      state.tickInFlight = false
      state.lastTickError = `Scheduler watchdog: reset tickInFlight after ${Math.round(elapsedMs / 1000)}s hung tick.`
    }
  }
  if (state.tickInFlight) {
    state.overlapSkipCount += 1
    return
  }

  // Leader election: only the instance holding the scheduler lease runs the tick.
  // If another instance is the current leader, skip this tick.
  const leaseResult = await jobLedger
    .acquireSchedulerLease({
      scope: SCHEDULER_LEASE_SCOPE,
      holderId: SCHEDULER_HOLDER_ID,
      ttlMs: SCHEDULER_LEASE_TTL_MS,
    })
    .catch(() => ({ acquired: false as const, reason: "db_error" as const }))

  if (!leaseResult.acquired) {
    state.isLeader = false
    state.leaseSkipCount += 1
    return
  }
  state.isLeader = true

  state.tickInFlight = true
  state.lastTickStartedAt = new Date().toISOString()
  const tickStartedAt = Date.now()
  try {
    const summary = await runScheduleTickInternal()
    state.lastTickDueCount = summary.dueCount
    state.lastTickRunCount = summary.runCount
    state.lastTickError = ""
  } catch (error) {
    state.lastTickError = error instanceof Error ? error.message : "Unknown scheduler tick error."
  } finally {
    state.lastTickDurationMs = Date.now() - tickStartedAt
    state.lastTickFinishedAt = new Date().toISOString()
    state.totalTickCount += 1
    state.tickInFlight = false
    // Renew the lease so it survives until the next tick
    jobLedger
      .renewSchedulerLease({ scope: SCHEDULER_LEASE_SCOPE, holderId: SCHEDULER_HOLDER_ID, ttlMs: SCHEDULER_LEASE_TTL_MS })
      .catch(() => {})
  }
}

export function getMissionSchedulerState() {
  return {
    running: state.running,
    tickInFlight: state.tickInFlight,
    tickIntervalMs: state.tickIntervalMs,
    totalTickCount: state.totalTickCount,
    overlapSkipCount: state.overlapSkipCount,
    lastTickStartedAt: state.lastTickStartedAt || null,
    lastTickFinishedAt: state.lastTickFinishedAt || null,
    lastTickDurationMs: Number.isFinite(state.lastTickDurationMs) ? state.lastTickDurationMs : null,
    lastTickDueCount: state.lastTickDueCount,
    lastTickRunCount: state.lastTickRunCount,
    lastTickError: state.lastTickError || null,
    // Leader election
    isLeader: state.isLeader,
    leaseSkipCount: state.leaseSkipCount,
    holderId: SCHEDULER_HOLDER_ID,
  }
}

export function ensureMissionSchedulerStarted(): { running: boolean } {
  if (state.running && state.timer) {
    // Scheduler already running — also ensure execution-tick is running (idempotent).
    ensureExecutionTickStarted()
    return { running: true }
  }

  state.running = true
  state.tickIntervalMs = SCHEDULER_TICK_MS
  void runScheduleTick()
  state.timer = setInterval(() => {
    void runScheduleTick()
  }, state.tickIntervalMs)
  state.timer.unref() // don't keep the process alive if the event loop is otherwise idle

  // Start execution-tick on the same process with its own independent 5s timer.
  ensureExecutionTickStarted()

  return { running: true }
}

export function stopMissionScheduler(): { running: boolean } {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.running = false
  state.isLeader = false

  // Release the leader lease so another instance can acquire it immediately
  // rather than waiting for the TTL to expire.
  jobLedger.releaseSchedulerLease({ scope: SCHEDULER_LEASE_SCOPE, holderId: SCHEDULER_HOLDER_ID }).catch(() => {})

  // Symmetric stop: scheduler started execution-tick, so scheduler stops it too.
  stopExecutionTick()

  return { running: false }
}



