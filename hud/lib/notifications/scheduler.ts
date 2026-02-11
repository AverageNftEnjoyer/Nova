import "server-only"

import { loadSchedules, parseDailyTime, saveSchedules, type NotificationSchedule } from "@/lib/notifications/store"
import { sendTelegramMessage } from "@/lib/notifications/telegram"

type SchedulerState = {
  timer: NodeJS.Timeout | null
  running: boolean
}

const state = (globalThis as { __novaNotificationScheduler?: SchedulerState }).__novaNotificationScheduler ?? {
  timer: null,
  running: false,
}

;(globalThis as { __novaNotificationScheduler?: SchedulerState }).__novaNotificationScheduler = state

function getLocalTimeParts(date: Date, timezone: string): {
  hour: number
  minute: number
  dayStamp: string
} | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

    const parts = formatter.formatToParts(date)
    const lookup = new Map(parts.map((p) => [p.type, p.value]))

    const year = lookup.get("year")
    const month = lookup.get("month")
    const day = lookup.get("day")
    const hour = lookup.get("hour")
    const minute = lookup.get("minute")

    if (!year || !month || !day || !hour || !minute) return null

    return {
      hour: Number(hour),
      minute: Number(minute),
      dayStamp: `${year}-${month}-${day}`,
    }
  } catch {
    return null
  }
}

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

    const time = parseDailyTime(schedule.time)
    const nowInZone = getLocalTimeParts(now, schedule.timezone)

    if (!time || !nowInZone) {
      nextSchedules.push(schedule)
      continue
    }

    const shouldSend =
      nowInZone.hour === time.hour &&
      nowInZone.minute === time.minute &&
      schedule.lastSentLocalDate !== nowInZone.dayStamp

    if (!shouldSend) {
      nextSchedules.push(schedule)
      continue
    }

    const sendResults = await sendTelegramMessage({
      text: schedule.message,
      chatIds: schedule.chatIds,
    })

    const hadSuccess = sendResults.some((r) => r.ok)
    const updated: NotificationSchedule = {
      ...schedule,
      lastSentLocalDate: hadSuccess ? nowInZone.dayStamp : schedule.lastSentLocalDate,
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
