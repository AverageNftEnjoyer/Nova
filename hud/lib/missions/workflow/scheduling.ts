/**
 * Workflow Scheduling
 *
 * Functions for determining when workflows should run.
 */

import type { NotificationSchedule } from "@/lib/notifications/store"
import { normalizeWorkflowStep } from "../utils/config"
import { parseMissionWorkflow } from "./parsing"
import type { WorkflowScheduleGate } from "../types"

/**
 * Get local time parts from a date and timezone.
 */
export function getLocalTimeParts(date: Date, timezone: string): { hour: number; minute: number } | null {
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
    const hour = Number(lookup.get("hour"))
    const minute = Number(lookup.get("minute"))
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return { hour, minute }
  } catch {
    return null
  }
}

/**
 * Get local parts including day information.
 */
export function getLocalParts(date: Date, timezone: string): { hour: number; minute: number; dayStamp: string; weekday: string } | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const lookup = new Map(parts.map((p) => [p.type, p.value]))
    const year = lookup.get("year")
    const month = lookup.get("month")
    const day = lookup.get("day")
    const hour = Number(lookup.get("hour"))
    const minute = Number(lookup.get("minute"))
    const weekdayRaw = String(lookup.get("weekday") || "").toLowerCase()
    const weekday = weekdayRaw.startsWith("mon")
      ? "mon"
      : weekdayRaw.startsWith("tue")
        ? "tue"
        : weekdayRaw.startsWith("wed")
          ? "wed"
          : weekdayRaw.startsWith("thu")
            ? "thu"
            : weekdayRaw.startsWith("fri")
              ? "fri"
              : weekdayRaw.startsWith("sat")
                ? "sat"
                : "sun"
    if (!year || !month || !day || !Number.isInteger(hour) || !Number.isInteger(minute)) return null
    return {
      hour,
      minute,
      dayStamp: `${year}-${month}-${day}`,
      weekday,
    }
  } catch {
    return null
  }
}

/**
 * Parse time string (HH:MM) to hour and minute.
 */
export function parseTime(value: string | undefined): { hour: number; minute: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

/**
 * Determine if a workflow should run now.
 */
export function shouldWorkflowRunNow(schedule: NotificationSchedule, now: Date): WorkflowScheduleGate {
  const parsed = parseMissionWorkflow(schedule.message)
  const steps = (parsed.summary?.workflowSteps || []).map((s, i) => normalizeWorkflowStep(s, i))
  const trigger = steps.find((s) => String(s.type || "").toLowerCase() === "trigger")
  const timezone = String(
    trigger?.triggerTimezone ||
    parsed.summary?.schedule?.timezone ||
    schedule.timezone ||
    "America/New_York",
  ).trim() || "America/New_York"
  const local = getLocalParts(now, timezone)
  if (!local) return { due: false, dayStamp: "", mode: "daily" }

  const mode = String(trigger?.triggerMode || parsed.summary?.schedule?.mode || "daily").toLowerCase()
  const timeString = String(trigger?.triggerTime || parsed.summary?.schedule?.time || schedule.time || "09:00").trim()
  const target = parseTime(timeString)
  if ((mode === "daily" || mode === "weekly" || mode === "once") && !target) {
    return { due: false, dayStamp: local.dayStamp, mode }
  }

  if (mode === "interval") {
    const every = Math.max(1, Number(trigger?.triggerIntervalMinutes || "30") || 30)
    const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null
    if (!lastRun || Number.isNaN(lastRun.getTime())) {
      return { due: true, dayStamp: local.dayStamp, mode }
    }
    const minutesSince = (now.getTime() - lastRun.getTime()) / 60000
    return { due: minutesSince >= every, dayStamp: local.dayStamp, mode }
  }

  const sameMinute = local.hour === (target?.hour ?? -1) && local.minute === (target?.minute ?? -1)
  if (!sameMinute) return { due: false, dayStamp: local.dayStamp, mode }

  if (mode === "weekly" || mode === "once") {
    const days = Array.isArray(trigger?.triggerDays)
      ? trigger!.triggerDays!.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
      : Array.isArray(parsed.summary?.schedule?.days)
        ? parsed.summary!.schedule!.days!.map((d) => String(d).trim().toLowerCase()).filter(Boolean)
        : []
    if (days.length > 0 && !days.includes(local.weekday)) {
      return { due: false, dayStamp: local.dayStamp, mode }
    }
  }

  return { due: true, dayStamp: local.dayStamp, mode }
}
