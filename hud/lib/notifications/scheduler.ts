import "server-only"

import { loadMissions, upsertMission } from "@/lib/missions/store"
import { executeMission } from "@/lib/missions/workflow/execute-mission"
import { deleteRescheduleOverride } from "@/lib/calendar/reschedule-store"
import { getLocalParts } from "@/lib/missions/workflow/scheduling"
import type { Mission } from "@/lib/missions/types"

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
  const allMissions = await loadMissions({ allUsers: true })

  const now = new Date()
  let runCount = 0
  const runCountByUser = new Map<string, number>()

  const activeMissions = allMissions.filter((m) => m.status === "active")
  const dueCount = activeMissions.length
  try {
    for (const mission of activeMissions) {
      if (runCount >= SCHEDULER_MAX_RUNS_PER_TICK) break
      const userKey = sanitizeSchedulerUserId(mission.userId || "") || "__global__"
      const perUserRuns = runCountByUser.get(userKey) || 0
      if (perUserRuns >= SCHEDULER_MAX_RUNS_PER_USER_PER_TICK) continue
      try {
        const liveMission = await loadLiveMissionForUser({ missionId: mission.id, userId: mission.userId })
        if (!liveMission || liveMission.status !== "active") continue

        // Day-lock guard: prevent re-running a mission that already ran today.
        // Without this, a failing executeMission() throw bypasses dayStamp
        // persistence and every 30s tick re-triggers the same mission forever.
        const nativeTriggerNode = liveMission.nodes.find((n) => n.type === "schedule-trigger") as
          | { triggerMode?: string; triggerTimezone?: string }
          | undefined
        const nativeTriggerMode = String(nativeTriggerNode?.triggerMode || "daily")
        const nativeTz = String(nativeTriggerNode?.triggerTimezone || liveMission.settings?.timezone || "America/New_York")
        const nativeLocal = getLocalParts(now, nativeTz)
        const nativeDayStamp =
          (nativeTriggerMode === "daily" || nativeTriggerMode === "weekly" || nativeTriggerMode === "once") && nativeLocal?.dayStamp
            ? nativeLocal.dayStamp
            : undefined

        if (nativeDayStamp && liveMission.lastSentLocalDate === nativeDayStamp) continue

        // Backoff guard: if the last run was an error, enforce exponential delay
        if (liveMission.lastRunStatus === "error" && liveMission.lastRunAt) {
          const lastRunMs = Date.parse(liveMission.lastRunAt)
          if (Number.isFinite(lastRunMs)) {
            const consecutiveFailures = Math.max(0, (liveMission.failureCount || 0) - (liveMission.successCount || 0))
            const backoffMs = computeRetryDelayMs(Math.min(consecutiveFailures, SCHEDULER_MAX_RETRIES_PER_RUN_KEY))
            if (now.getTime() - lastRunMs < backoffMs) continue
            if (consecutiveFailures >= SCHEDULER_MAX_RETRIES_PER_RUN_KEY) continue
          }
        }

        const scope = liveMission.userId
          ? { userId: liveMission.userId, allowServiceRole: true as const, serviceRoleReason: "scheduler" as const }
          : undefined
        const result = await executeMission({
          mission: liveMission,
          source: "scheduler",
          now,
          enforceOutputTime: true,
          missionRunId: crypto.randomUUID(),
          scope,
        })
        if (!result.skipped) {
          runCount += 1
          runCountByUser.set(userKey, perUserRuns + 1)
          const updatedMission = {
            ...liveMission,
            lastRunAt: now.toISOString(),
            lastSentLocalDate: nativeDayStamp ?? liveMission.lastSentLocalDate,
            runCount: (liveMission.runCount || 0) + 1,
            successCount: result.ok ? (liveMission.successCount || 0) + 1 : (liveMission.successCount || 0),
            failureCount: result.ok ? (liveMission.failureCount || 0) : (liveMission.failureCount || 0) + 1,
            lastRunStatus: result.ok ? ("success" as const) : ("error" as const),
            scheduledAtOverride: undefined,
          }
          await upsertMission(updatedMission, liveMission.userId || "")
          if (liveMission.scheduledAtOverride && liveMission.userId) {
            deleteRescheduleOverride(liveMission.userId, liveMission.id).catch(() => {})
          }
        }
      } catch (err) {
        console.error(`[Scheduler] Native mission ${mission.id} failed: ${err instanceof Error ? err.message : "unknown"}`)
        // Persist lastRunAt + error status even on throw so the day-lock and
        // backoff guards prevent infinite re-triggering on every tick.
        try {
          const crashedMission = await loadLiveMissionForUser({ missionId: mission.id, userId: mission.userId })
          if (crashedMission) {
            const crashTriggerNode = crashedMission.nodes?.find((n) => n.type === "schedule-trigger") as
              | { triggerMode?: string; triggerTimezone?: string }
              | undefined
            const crashMode = String(crashTriggerNode?.triggerMode || "daily")
            const crashTz = String(crashTriggerNode?.triggerTimezone || crashedMission.settings?.timezone || "America/New_York")
            const crashLocal = getLocalParts(now, crashTz)
            const crashDayStamp =
              (crashMode === "daily" || crashMode === "weekly" || crashMode === "once") && crashLocal?.dayStamp
                ? crashLocal.dayStamp
                : crashedMission.lastSentLocalDate
            await upsertMission(
              {
                ...crashedMission,
                lastRunAt: now.toISOString(),
                lastSentLocalDate: crashDayStamp,
                lastRunStatus: "error",
                failureCount: (crashedMission.failureCount || 0) + 1,
                runCount: (crashedMission.runCount || 0) + 1,
              },
              crashedMission.userId || mission.userId || "",
            )
          }
        } catch {
          // Best-effort — if even persistence fails, the backoff guard
          // and per-tick caps still limit damage.
        }
      }
    }
  } catch (err) {
    console.error(`[Scheduler] Native missions tick failed: ${err instanceof Error ? err.message : "unknown"}`)
  }

  return { dueCount, runCount }
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
