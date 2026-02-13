import "server-only"

import { loadSchedules, saveSchedules, type NotificationSchedule } from "@/lib/notifications/store"
import { executeMissionWorkflow, shouldWorkflowRunNow } from "@/lib/missions/runtime"

type SchedulerState = {
  timer: NodeJS.Timeout | null
  running: boolean
}

const state = (globalThis as { __novaNotificationScheduler?: SchedulerState }).__novaNotificationScheduler ?? {
  timer: null,
  running: false,
}

;(globalThis as { __novaNotificationScheduler?: SchedulerState }).__novaNotificationScheduler = state

async function runScheduleTick() {
  const schedules = await loadSchedules()
  if (schedules.length === 0) return

  const now = new Date()
  let changed = false
  const nextSchedules: NotificationSchedule[] = []

  for (const schedule of schedules) {
    if (!schedule.enabled) {
      nextSchedules.push(schedule)
      continue
    }

    const gate = shouldWorkflowRunNow(schedule, now)
    if (!gate.due) {
      nextSchedules.push(schedule)
      continue
    }

    const requiresDayLock = gate.mode !== "interval"
    if (requiresDayLock && schedule.lastSentLocalDate === gate.dayStamp) {
      nextSchedules.push(schedule)
      continue
    }

    let hadSuccess = false
    try {
      const execution = await executeMissionWorkflow({
        schedule,
        source: "scheduler",
        now,
        enforceOutputTime: true,
      })
      hadSuccess = execution.ok
    } catch {
      hadSuccess = false
    }
    const updated: NotificationSchedule = {
      ...schedule,
      lastSentLocalDate: hadSuccess && requiresDayLock ? gate.dayStamp : schedule.lastSentLocalDate,
      runCount: (Number.isFinite(schedule.runCount) ? schedule.runCount : 0) + 1,
      successCount: (Number.isFinite(schedule.successCount) ? schedule.successCount : 0) + (hadSuccess ? 1 : 0),
      failureCount: (Number.isFinite(schedule.failureCount) ? schedule.failureCount : 0) + (hadSuccess ? 0 : 1),
      lastRunAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    nextSchedules.push(updated)
    changed = true
  }

  if (changed) {
    await saveSchedules(nextSchedules)
  }
}

export function ensureNotificationSchedulerStarted(): { running: boolean } {
  if (state.running && state.timer) {
    return { running: true }
  }

  state.running = true
  void runScheduleTick()
  state.timer = setInterval(() => {
    void runScheduleTick()
  }, 30_000)

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
