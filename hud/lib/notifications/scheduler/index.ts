import "server-only"

import { loadMissions } from "@/lib/missions/store"
import { getRescheduleOverride } from "@/lib/calendar/reschedule-store"
import { getLocalParts } from "@/lib/missions/workflow/time"
import type { Mission } from "@/lib/missions/types"
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
const SCHEDULER_MAX_RUNS_PER_TICK = Math.max(
  1,
  Math.min(100, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RUNS_PER_TICK || "20", 10) || 20),
)
const SCHEDULER_MAX_RUNS_PER_USER_PER_TICK = Math.max(
  1,
  Math.min(25, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RUNS_PER_USER_PER_TICK || "4", 10) || 4),
)
const SCHEDULER_MAX_RETRIES_PER_RUN_KEY = Math.max(
  1,
  Math.min(8, Number.parseInt(process.env.NOVA_SCHEDULER_MAX_RETRIES_PER_RUN_KEY || "3", 10) || 3),
)
const SCHEDULER_RETRY_BASE_MS = Math.max(
  10_000,
  Math.min(3_600_000, Number.parseInt(process.env.NOVA_SCHEDULER_RETRY_BASE_MS || "60000", 10) || 60_000),
)
const SCHEDULER_RETRY_MAX_MS = Math.max(
  SCHEDULER_RETRY_BASE_MS,
  Math.min(21_600_000, Number.parseInt(process.env.NOVA_SCHEDULER_RETRY_MAX_MS || "900000", 10) || 900_000),
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

function sanitizeSchedulerUserId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

async function loadLiveMissionForUser(params: { missionId: string; userId?: string }): Promise<Mission | null> {
  const missionId = String(params.missionId || "").trim()
  const userId = String(params.userId || "").trim()
  if (!missionId || !userId) return null
  const userMissions = await loadMissions({ userId })
  return userMissions.find((mission) => mission.id === missionId) ?? null
}

function computeRetryDelayMs(previousAttempts: number): number {
  const exponent = Math.max(0, Math.floor(previousAttempts))
  const delay = SCHEDULER_RETRY_BASE_MS * Math.pow(2, exponent)
  return Math.max(SCHEDULER_RETRY_BASE_MS, Math.min(SCHEDULER_RETRY_MAX_MS, Math.floor(delay)))
}

async function runScheduleTickInternal() {
  // Recover any claimed runs whose lease expired (e.g. server crash mid-execution).
  // Best-effort: a failure here does not abort the tick.
  await jobLedger.reclaimExpiredLeases().catch((err) => {
    console.warn("[Scheduler] reclaimExpiredLeases failed:", err instanceof Error ? err.message : err)
  })

  const allMissions = await loadMissions({ allUsers: true })

  const now = new Date()
  let enqueueCount = 0
  const enqueueCountByUser = new Map<string, number>()

  const activeMissions = allMissions.filter((m) => m.status === "active")
  const dueCount = activeMissions.length

  try {
    for (const mission of activeMissions) {
      if (enqueueCount >= SCHEDULER_MAX_RUNS_PER_TICK) break
      const userKey = sanitizeSchedulerUserId(mission.userId || "") || "__global__"
      const perUserEnqueues = enqueueCountByUser.get(userKey) || 0
      if (perUserEnqueues >= SCHEDULER_MAX_RUNS_PER_USER_PER_TICK) continue

      try {
        const liveMission = await loadLiveMissionForUser({ missionId: mission.id, userId: mission.userId })
        if (!liveMission || liveMission.status !== "active") continue

        // Check for a calendar reschedule override to pass through to execution-tick.
        const rescheduleOverride = liveMission.userId
          ? await getRescheduleOverride(liveMission.userId, liveMission.id).catch(() => null)
          : null

        // Use overridden mission snapshot for gate checks only (actual execution
        // applies the override via job_run.input_snapshot in execution-tick).
        const missionForGate =
          rescheduleOverride?.overriddenTime
            ? { ...liveMission, scheduledAtOverride: rescheduleOverride.overriddenTime }
            : liveMission

        // ── Day-lock guard ─────────────────────────────────────────────────
        // Prevents re-enqueuing a mission that already ran today.
        const nativeTriggerNode = missionForGate.nodes.find((n) => n.type === "schedule-trigger") as
          | { triggerMode?: string; triggerTimezone?: string; triggerIntervalMinutes?: number }
          | undefined
        const nativeTriggerMode = String(nativeTriggerNode?.triggerMode || "daily")
        const nativeTz = resolveTimezone(nativeTriggerNode?.triggerTimezone, missionForGate.settings?.timezone)
        const nativeLocal = getLocalParts(now, nativeTz)
        const nativeDayStamp =
          (nativeTriggerMode === "daily" || nativeTriggerMode === "weekly" || nativeTriggerMode === "once") &&
          nativeLocal?.dayStamp
            ? nativeLocal.dayStamp
            : undefined

        if (nativeDayStamp && missionForGate.lastSentLocalDate === nativeDayStamp) continue

        // ── Backoff guard ──────────────────────────────────────────────────
        // If the last run was an error, enforce exponential delay before re-enqueue.
        if (missionForGate.lastRunStatus === "error" && missionForGate.lastRunAt) {
          const lastRunMs = Date.parse(missionForGate.lastRunAt)
          if (Number.isFinite(lastRunMs)) {
            const consecutiveFailures = Math.max(
              0,
              (missionForGate.failureCount || 0) - (missionForGate.successCount || 0),
            )
            const backoffMs = computeRetryDelayMs(Math.min(consecutiveFailures, SCHEDULER_MAX_RETRIES_PER_RUN_KEY))
            if (now.getTime() - lastRunMs < backoffMs) continue
            if (consecutiveFailures >= SCHEDULER_MAX_RETRIES_PER_RUN_KEY) continue
          }
        }

        // ── Idempotency key ────────────────────────────────────────────────
        // Deduplicates enqueue attempts across ticks for the same logical run slot.
        const idempotencyKey = nativeDayStamp
          ? `${liveMission.id}:${nativeDayStamp}`
          : nativeTriggerMode === "interval"
            ? `${liveMission.id}:interval:${Math.floor(now.getTime() / (Math.max(1, nativeTriggerNode?.triggerIntervalMinutes || 30) * 60_000))}`
            : `${liveMission.id}:hour:${Math.floor(now.getTime() / 3_600_000)}`

        // ── Enqueue the run (Phase 3 — execution-tick handles actual execution) ──
        const inputSnapshot: Record<string, unknown> = {}
        if (rescheduleOverride?.overriddenTime) {
          inputSnapshot.scheduledAtOverride = rescheduleOverride.overriddenTime
        }

        const enqueueResult = await jobLedger.enqueue({
          id: crypto.randomUUID(),
          user_id: sanitizeSchedulerUserId(liveMission.userId || "") || "__global__",
          mission_id: liveMission.id,
          idempotency_key: idempotencyKey,
          source: "scheduler",
          priority: 5,
          max_attempts: liveMission.settings.retryOnFail ? liveMission.settings.retryCount + 1 : 1,
          ...(Object.keys(inputSnapshot).length > 0 ? { input_snapshot: inputSnapshot } : {}),
        })

        if (enqueueResult.ok) {
          enqueueCount += 1
          enqueueCountByUser.set(userKey, perUserEnqueues + 1)
        } else if (enqueueResult.error !== "duplicate_idempotency_key") {
          console.warn(`[Scheduler] Failed to enqueue mission ${liveMission.id}:`, enqueueResult.error)
        }
      } catch (err) {
        console.error(
          `[Scheduler] Error processing mission ${mission.id}: ${err instanceof Error ? err.message : "unknown"}`,
        )
      }
    }
  } catch (err) {
    console.error(`[Scheduler] Tick loop failed: ${err instanceof Error ? err.message : "unknown"}`)
  }

  return { dueCount, runCount: enqueueCount }
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
