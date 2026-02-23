import "server-only"

import { loadSchedules, saveSchedules, type NotificationSchedule } from "@/lib/notifications/store"
import { executeMissionWorkflow, shouldWorkflowRunNow } from "@/lib/missions/runtime"
import { loadMissionSkillSnapshot } from "@/lib/missions/skills/snapshot"
import { getLocalParts } from "@/lib/missions/workflow/scheduling"
import { appendRunLogForExecution, applyScheduleRunOutcome } from "@/lib/notifications/run-metrics"
import { getRunKeyHistory } from "@/lib/notifications/run-log"
import { appendNotificationDeadLetter } from "@/lib/notifications/dead-letter"

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
const SCHEDULER_RUN_HISTORY_MAX_LINES = Math.max(
  80,
  Math.min(4_000, Number.parseInt(process.env.NOVA_SCHEDULER_RUN_HISTORY_MAX_LINES || "600", 10) || 600),
)

const state = (globalThis as { __novaNotificationScheduler?: SchedulerState }).__novaNotificationScheduler ?? {
  timer: null,
  running: false,
  tickInFlight: false,
  tickIntervalMs: SCHEDULER_TICK_MS,
  lastTickDueCount: 0,
  lastTickRunCount: 0,
  totalTickCount: 0,
  overlapSkipCount: 0,
}

;(globalThis as { __novaNotificationScheduler?: SchedulerState }).__novaNotificationScheduler = state

function sanitizeSchedulerUserId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function buildScheduleRunKey(params: {
  schedule: NotificationSchedule
  mode: string
  dayStamp: string
  now: Date
}): string {
  const mode = String(params.mode || "daily").trim().toLowerCase() || "daily"
  const scheduleId = String(params.schedule.id || "").trim() || "unknown"
  if (mode === "interval") {
    const bucketMinute = Math.floor(Number(params.now.getTime() || 0) / 60_000)
    return `${scheduleId}:interval:${bucketMinute}`
  }
  const dayStamp = String(params.dayStamp || "").trim() || "na"
  return `${scheduleId}:${mode}:${dayStamp}`
}

function computeRetryDelayMs(previousAttempts: number): number {
  const exponent = Math.max(0, Math.floor(previousAttempts))
  const delay = SCHEDULER_RETRY_BASE_MS * Math.pow(2, exponent)
  return Math.max(SCHEDULER_RETRY_BASE_MS, Math.min(SCHEDULER_RETRY_MAX_MS, Math.floor(delay)))
}

async function runScheduleTickInternal() {
  const schedules = await loadSchedules({ allUsers: true })
  if (schedules.length === 0) {
    return {
      dueCount: 0,
      runCount: 0,
      changed: false,
    }
  }

  const now = new Date()
  let changed = false
  let dueCount = 0
  let runCount = 0
  const nextSchedules: NotificationSchedule[] = []
  const orderedSchedules = [...schedules].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))
  const skillSnapshotsByUser = new Map<string, Awaited<ReturnType<typeof loadMissionSkillSnapshot>>>()
  const runCountByUser = new Map<string, number>()

  for (const schedule of orderedSchedules) {
    if (!schedule.enabled) {
      nextSchedules.push(schedule)
      continue
    }

    const gate = shouldWorkflowRunNow(schedule, now)
    if (!gate.due) {
      nextSchedules.push(schedule)
      continue
    }
    dueCount += 1

    const requiresDayLock = gate.mode !== "interval"
    if (requiresDayLock && schedule.lastSentLocalDate === gate.dayStamp) {
      nextSchedules.push(schedule)
      continue
    }

    // Robustness: avoid repeated attempts for the same local day when a prior
    // run already happened (success or failure), which can happen with 30s ticks.
    if (
      requiresDayLock &&
      schedule.lastRunAt &&
      String(schedule.lastRunStatus || "").trim().toLowerCase() !== "error"
    ) {
      const lastRun = new Date(schedule.lastRunAt)
      if (!Number.isNaN(lastRun.getTime())) {
        const tz = String(gate.timezone || schedule.timezone || "America/New_York").trim() || "America/New_York"
        const localLastRun = getLocalParts(lastRun, tz)
        if (localLastRun?.dayStamp === gate.dayStamp) {
          nextSchedules.push(schedule)
          continue
        }
      }
    }

    const userScopeKey = sanitizeSchedulerUserId(schedule.userId || "") || "__global__"
    const perUserRunCount = runCountByUser.get(userScopeKey) || 0
    if (perUserRunCount >= SCHEDULER_MAX_RUNS_PER_USER_PER_TICK) {
      nextSchedules.push(schedule)
      continue
    }

    if (runCount >= SCHEDULER_MAX_RUNS_PER_TICK) {
      nextSchedules.push(schedule)
      continue
    }

    const runKey = buildScheduleRunKey({
      schedule,
      mode: gate.mode,
      dayStamp: gate.dayStamp,
      now,
    })
    const runHistory = await getRunKeyHistory({
      scheduleId: schedule.id,
      userId: schedule.userId,
      runKey,
      maxLines: SCHEDULER_RUN_HISTORY_MAX_LINES,
    })
    if (runHistory.latestStatus === "success" || runHistory.latestStatus === "skipped") {
      nextSchedules.push(schedule)
      continue
    }
    if (runHistory.latestStatus === "error") {
      if (runHistory.attempts >= SCHEDULER_MAX_RETRIES_PER_RUN_KEY) {
        nextSchedules.push(schedule)
        continue
      }
      const retryDelayMs = computeRetryDelayMs(runHistory.attempts)
      const nextAllowedTs = Number(runHistory.latestTs || 0) + retryDelayMs
      if (Number.isFinite(nextAllowedTs) && nextAllowedTs > now.getTime()) {
        nextSchedules.push(schedule)
        continue
      }
    }
    const attempt = Math.max(1, runHistory.attempts + 1)
    runCount += 1
    runCountByUser.set(userScopeKey, perUserRunCount + 1)

    let execution = null
    let fallbackError = ""
    let skillSnapshot = skillSnapshotsByUser.get(userScopeKey)
    if (!skillSnapshot) {
      try {
        skillSnapshot = await loadMissionSkillSnapshot({
          userId: schedule.userId,
        })
      } catch {
        skillSnapshot = {
          version: "unavailable",
          createdAt: new Date().toISOString(),
          skillCount: 0,
          guidance: "",
        }
      }
      skillSnapshotsByUser.set(userScopeKey, skillSnapshot)
    }
    const startedAtMs = Date.now()
    try {
      const missionRunId = crypto.randomUUID()
      execution = await executeMissionWorkflow({
        schedule,
        source: "scheduler",
        missionRunId,
        runKey,
        attempt,
        now,
        enforceOutputTime: true,
        skillSnapshot,
        scope: schedule.userId
          ? {
              userId: schedule.userId,
              allowServiceRole: true,
              serviceRoleReason: "scheduler",
            }
          : undefined,
      })
    } catch {
      execution = null
      fallbackError = "Mission execution threw an unhandled scheduler error."
    }
    const durationMs = Date.now() - startedAtMs
    try {
      const logResult = await appendRunLogForExecution({
        schedule,
        source: "scheduler",
        execution,
        fallbackError,
        mode: gate.mode,
        dayStamp: gate.dayStamp,
        runKey,
        attempt,
        durationMs,
      })
      if (logResult.status === "error") {
        try {
          await appendNotificationDeadLetter({
            scheduleId: schedule.id,
            userId: schedule.userId,
            label: schedule.label,
            source: "scheduler",
            runKey,
            attempt,
            reason: logResult.errorMessage || "Scheduler mission execution failed.",
            outputOkCount: execution?.outputs?.filter((item) => item.ok).length || 0,
            outputFailCount: execution?.outputs?.filter((item) => !item.ok).length || 0,
            metadata: {
              mode: gate.mode,
              dayStamp: gate.dayStamp,
            },
          })
        } catch {
          // Dead-letter logging should never block scheduler updates.
        }
      }
      const updated = applyScheduleRunOutcome(schedule, {
        status: logResult.status,
        now,
        dayStamp: gate.dayStamp,
        mode: gate.mode,
      })
      nextSchedules.push(updated)
      changed = true
    } catch {
      // Logging failures should not block scheduling.
      const updated = applyScheduleRunOutcome(schedule, {
        status: execution?.ok ? "success" : execution?.skipped ? "skipped" : "error",
        now,
        dayStamp: gate.dayStamp,
        mode: gate.mode,
      })
      nextSchedules.push(updated)
      changed = true
    }
  }

  if (changed) {
    try {
      await saveSchedules(nextSchedules, { allUsers: true })
    } catch (error) {
      console.error(
        `[Scheduler] Failed to persist updated schedules: ${error instanceof Error ? error.message : "unknown error"}`,
      )
    }
  }

  return { dueCount, runCount, changed }
}

async function runScheduleTick() {
  if (state.tickInFlight) {
    state.overlapSkipCount += 1
    return
  }
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
  }
}

export function getNotificationSchedulerState() {
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
  }
}

export function ensureNotificationSchedulerStarted(): { running: boolean } {
  if (state.running && state.timer) {
    return { running: true }
  }

  state.running = true
  state.tickIntervalMs = SCHEDULER_TICK_MS
  void runScheduleTick()
  state.timer = setInterval(() => {
    void runScheduleTick()
  }, state.tickIntervalMs)

  return { running: true }
}

export function stopNotificationScheduler(): { running: boolean } {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.running = false

  return { running: false }
}
