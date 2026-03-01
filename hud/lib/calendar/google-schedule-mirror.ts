import "server-only"

import { createHash } from "node:crypto"

import type { Mission, ScheduleTriggerNode } from "@/lib/missions/types"
import type { NotificationSchedule } from "@/lib/notifications/store"
import { loadIntegrationsConfig, type IntegrationsStoreScope } from "@/lib/integrations/server-store"
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/integrations/google-calender/service"
import { estimateDurationMs, toIsoInTimezone } from "@/lib/calendar/schedule-utils"
import { getLocalParts } from "@/lib/missions/workflow/scheduling"
import { parseMissionWorkflow } from "@/lib/missions/workflow/parsing"
import { resolveTimezone } from "@/lib/shared/timezone"

const DEFAULT_TIME = "09:00"
const CALENDAR_WRITE_SCOPES = new Set([
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
])
const WEEKDAY_TO_RRULE: Record<string, string> = {
  mon: "MO",
  tue: "TU",
  wed: "WE",
  thu: "TH",
  fri: "FR",
  sat: "SA",
  sun: "SU",
}
const WEEKDAY_LABELS: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
}
const MAX_EVENT_SUMMARY_CHARS = 120
const MAX_EVENT_DESCRIPTION_CHARS = 600

function hashEventId(seed: string, prefix: string): string {
  const digest = createHash("sha256").update(seed).digest("hex")
  // Google Calendar event IDs must use base32hex-safe chars (a-v, 0-9).
  const safePrefix = String(prefix || "").toLowerCase().replace(/[^a-v0-9]/g, "") || "nova"
  return `${safePrefix}${digest.slice(0, 52)}`
}

function normalizeScheduleTime(value: string | undefined): string {
  const raw = String(value || "").trim()
  const match = /^(\d{2}):(\d{2})$/.exec(raw)
  if (!match) return DEFAULT_TIME
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return DEFAULT_TIME
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return DEFAULT_TIME
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function addDays(dayStamp: string, days: number): string {
  const start = new Date(`${dayStamp}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return new Date().toISOString().slice(0, 10)
  start.setUTCDate(start.getUTCDate() + days)
  return start.toISOString().slice(0, 10)
}

function localWeekdayFromDayStamp(dayStamp: string, timezone: string): string {
  const middayIso = toIsoInTimezone(dayStamp, "12:00", timezone)
  const local = getLocalParts(new Date(middayIso), timezone)
  return local?.weekday || "sun"
}

function nextStartAtFromDailyLikeSchedule(params: {
  now: Date
  timezone: string
  time: string
  days?: string[]
  maxDaysAhead?: number
  includePastToday?: boolean
}): Date {
  const { now, timezone, time, days, maxDaysAhead = 400, includePastToday = false } = params
  const localNow = getLocalParts(now, timezone)
  const dayStamp = localNow?.dayStamp || now.toISOString().slice(0, 10)
  const allowedDays = new Set(
    (Array.isArray(days) ? days : [])
      .map((day) => String(day || "").trim().toLowerCase())
      .filter((day) => day in WEEKDAY_TO_RRULE),
  )

  for (let offset = 0; offset <= maxDaysAhead; offset += 1) {
    const candidateDay = addDays(dayStamp, offset)
    if (allowedDays.size > 0) {
      const weekday = localWeekdayFromDayStamp(candidateDay, timezone)
      if (!allowedDays.has(weekday)) continue
    }
    const candidateIso = toIsoInTimezone(candidateDay, time, timezone)
    const candidate = new Date(candidateIso)
    if (Number.isNaN(candidate.getTime())) continue
    if (includePastToday && offset === 0) return candidate
    if (candidate.getTime() + 60_000 >= now.getTime()) return candidate
  }

  return new Date(now.getTime() + 5 * 60_000)
}

function buildMissionRecurrence(trigger: ScheduleTriggerNode, timezone: string): string[] | undefined {
  const mode = String(trigger.triggerMode || "daily").toLowerCase()
  if (mode === "once") return undefined
  if (mode === "interval") {
    const every = Math.max(1, Number(trigger.triggerIntervalMinutes || 30))
    return [`RRULE:FREQ=MINUTELY;INTERVAL=${every}`]
  }
  if (mode === "weekly") {
    const weeklyDays = (Array.isArray(trigger.triggerDays) ? trigger.triggerDays : [])
      .map((day) => String(day || "").trim().toLowerCase())
      .map((day) => WEEKDAY_TO_RRULE[day])
      .filter(Boolean)
    if (weeklyDays.length === 0) return ["RRULE:FREQ=WEEKLY"]
    return [`RRULE:FREQ=WEEKLY;BYDAY=${Array.from(new Set(weeklyDays)).join(",")}`]
  }
  void timezone
  return ["RRULE:FREQ=DAILY"]
}

function normalizeWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function toReadableTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim())
  if (!match) return value
  const hours24 = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours24) || !Number.isInteger(minutes)) return value
  const suffix = hours24 >= 12 ? "PM" : "AM"
  const hours12 = hours24 % 12 || 12
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`
}

function toHumanSummary(value: string | undefined, fallback: string): string {
  const raw = String(value || "")
  const parsed = parseMissionWorkflow(raw)
  const markerSplit = raw.split(/\[?\s*NOVA WORKFLOW\s*\]?/i)[0] || ""
  const candidate = normalizeWhitespace(parsed.description || markerSplit)
  const safeFallback = normalizeWhitespace(fallback)
  return truncateText(candidate || safeFallback || "Automation", 260)
}

function formatMissionCadence(params: {
  mode: string
  time: string
  timezone: string
  days?: string[]
  intervalMinutes?: number
}): string {
  const mode = String(params.mode || "daily").trim().toLowerCase()
  const timeLabel = toReadableTime(params.time)
  const timezone = resolveTimezone(params.timezone)
  if (mode === "interval") {
    const every = Math.max(1, Number(params.intervalMinutes || 30))
    return `Every ${every} minutes (${timezone})`
  }
  if (mode === "weekly") {
    const dayLabels = (Array.isArray(params.days) ? params.days : [])
      .map((day) => String(day || "").trim().toLowerCase())
      .map((day) => WEEKDAY_LABELS[day])
      .filter(Boolean)
    if (dayLabels.length > 0) {
      return `Every ${dayLabels.join(", ")} at ${timeLabel} (${timezone})`
    }
    return `Weekly at ${timeLabel} (${timezone})`
  }
  if (mode === "once") return `Once at ${timeLabel} (${timezone})`
  return `Daily at ${timeLabel} (${timezone})`
}

async function resolveMirrorAccount(scope?: IntegrationsStoreScope): Promise<{
  ok: boolean
  reason?: string
  accountId?: string
  accountEmail?: string
  canCreate?: boolean
  canDelete?: boolean
} > {
  if (!scope) return { ok: false, reason: "missing_scope" }
  const config = await loadIntegrationsConfig(scope)
  if (!config.gcalendar.connected) return { ok: false, reason: "gcalendar_not_connected" }
  const activeId = String(config.gcalendar.activeAccountId || "").trim().toLowerCase()
  const enabledAccounts = config.gcalendar.accounts.filter((account) => account.enabled)
  const selectedAccount = activeId
    ? enabledAccounts.find((account) => account.id === activeId)
    : enabledAccounts[0]
  if (activeId && !selectedAccount) return { ok: false, reason: "active_account_not_enabled" }
  if (!selectedAccount?.id) return { ok: false, reason: "no_enabled_gcalendar_account" }
  const scopes = Array.isArray(selectedAccount.scopes)
    ? selectedAccount.scopes.map((value) => String(value || "").trim()).filter(Boolean)
    : []
  const hasWriteScope = scopes.some((value) => CALENDAR_WRITE_SCOPES.has(value))
  if (!hasWriteScope) {
    return { ok: false, reason: "missing_calendar_write_scope", accountId: selectedAccount.id, accountEmail: selectedAccount.email }
  }
  return {
    ok: true,
    accountId: selectedAccount.id,
    accountEmail: selectedAccount.email,
    canCreate: Boolean(config.gcalendar.permissions?.allowCreate),
    canDelete: Boolean(config.gcalendar.permissions?.allowDelete),
  }
}

function missionScheduleEventId(userId: string, missionId: string): string {
  return hashEventId(`${userId}|mission|${missionId}`, "novamission")
}

function notificationScheduleEventId(userId: string, scheduleId: string): string {
  return hashEventId(`${userId}|notification|${scheduleId}`, "novaschedule")
}

export async function syncMissionScheduleToGoogleCalendar(params: {
  mission: Mission
  scope?: IntegrationsStoreScope
}): Promise<void> {
  const { mission, scope } = params
  const userId = String(scope?.userId || scope?.user?.id || mission.userId || "").trim()
  if (!userId) return

  let mirror
  try {
    mirror = await resolveMirrorAccount(scope)
  } catch {
    return
  }
  if (!mirror.ok || !mirror.accountId) {
    console.warn(`[gcalendar][schedule_mirror][mission] skipped mission=${mission.id} user=${userId} reason=${mirror.reason || "unknown"}`)
    return
  }

  const eventId = missionScheduleEventId(userId, String(mission.id || "").trim())
  const trigger = mission.nodes.find((node) => node.type === "schedule-trigger") as ScheduleTriggerNode | undefined
  if (!trigger || mission.status !== "active") {
    if (mirror.canDelete) {
      await deleteCalendarEvent(eventId, { accountId: mirror.accountId, calendarId: "primary", scope }).catch(() => {})
    }
    return
  }
  if (!mirror.canCreate) {
    console.warn(`[gcalendar][schedule_mirror][mission] skipped mission=${mission.id} user=${userId} reason=allowCreate_false`)
    return
  }

  const timezone = resolveTimezone(trigger.triggerTimezone, mission.settings?.timezone)
  const mode = String(trigger.triggerMode || "daily").toLowerCase()
  const time = normalizeScheduleTime(trigger.triggerTime)
  const days = Array.isArray(trigger.triggerDays) ? trigger.triggerDays : undefined
  const now = new Date()
  const startAt = mode === "interval"
    ? new Date(now.getTime() + 60_000)
    : nextStartAtFromDailyLikeSchedule({ now, timezone, time, days, includePastToday: false })
  const durationMs = Math.max(15 * 60 * 1000, estimateDurationMs(mission.nodes?.length ?? 1))
  const endAt = new Date(startAt.getTime() + durationMs)
  const recurrence = buildMissionRecurrence(trigger, timezone)

  const summary = truncateText(String(mission.label || "").trim() || "Automation", MAX_EVENT_SUMMARY_CHARS)
  const humanSummary = toHumanSummary(String(mission.description || ""), summary)
  const cadence = formatMissionCadence({
    mode,
    time,
    timezone,
    days,
    intervalMinutes: trigger.triggerIntervalMinutes,
  })
  const description = truncateText([
    humanSummary,
    `Schedule: ${cadence}.`,
  ].filter(Boolean).join("\n"), MAX_EVENT_DESCRIPTION_CHARS)

  const created = await createCalendarEvent(
    {
      summary,
      description,
      startAt,
      endAt,
      timeZone: timezone,
      eventId,
      recurrence,
    },
    {
      accountId: mirror.accountId,
      calendarId: "primary",
      scope,
    },
  )
  console.info(
    `[gcalendar][schedule_mirror][mission] synced mission=${mission.id} user=${userId} account=${mirror.accountEmail || mirror.accountId || "unknown"} eventId=${created.id || "unknown"} link=${created.htmlLink || "n/a"}`,
  )
}

export async function removeMissionScheduleFromGoogleCalendar(params: {
  missionId: string
  userId: string
  scope?: IntegrationsStoreScope
}): Promise<void> {
  const missionId = String(params.missionId || "").trim()
  const userId = String(params.userId || "").trim()
  if (!missionId || !userId) return

  let mirror
  try {
    mirror = await resolveMirrorAccount(params.scope)
  } catch {
    return
  }
  if (!mirror.ok || !mirror.accountId || !mirror.canDelete) return

  await deleteCalendarEvent(
    missionScheduleEventId(userId, missionId),
    {
      accountId: mirror.accountId,
      calendarId: "primary",
      scope: params.scope,
    },
  )
}

export async function syncNotificationScheduleToGoogleCalendar(params: {
  schedule: NotificationSchedule
  scope?: IntegrationsStoreScope
}): Promise<void> {
  const { schedule, scope } = params
  const userId = String(scope?.userId || scope?.user?.id || schedule.userId || "").trim()
  const scheduleId = String(schedule.id || "").trim()
  if (!userId || !scheduleId) return

  let mirror
  try {
    mirror = await resolveMirrorAccount(scope)
  } catch {
    return
  }
  if (!mirror.ok || !mirror.accountId) {
    console.warn(`[gcalendar][schedule_mirror][notification] skipped schedule=${scheduleId} user=${userId} reason=${mirror.reason || "unknown"}`)
    return
  }

  const eventId = notificationScheduleEventId(userId, scheduleId)
  if (!schedule.enabled) {
    if (mirror.canDelete) {
      await deleteCalendarEvent(eventId, { accountId: mirror.accountId, calendarId: "primary", scope }).catch(() => {})
    }
    return
  }
  if (!mirror.canCreate) {
    console.warn(`[gcalendar][schedule_mirror][notification] skipped schedule=${scheduleId} user=${userId} reason=allowCreate_false`)
    return
  }

  const timezone = resolveTimezone(schedule.timezone)
  const time = normalizeScheduleTime(schedule.time)
  const startAt = nextStartAtFromDailyLikeSchedule({
    now: new Date(),
    timezone,
    time,
    includePastToday: false,
  })
  const endAt = new Date(startAt.getTime() + 30 * 60 * 1000)
  const summary = truncateText(String(schedule.label || "").trim() || "Automation", MAX_EVENT_SUMMARY_CHARS)
  const humanSummary = toHumanSummary(schedule.message, summary)
  const channel = String(schedule.integration || "").trim().toLowerCase() || "notification"
  const cadence = `Daily at ${toReadableTime(time)} (${timezone})`
  const description = truncateText([
    humanSummary,
    `Delivers via ${channel}.`,
    `Schedule: ${cadence}.`,
  ].filter(Boolean).join("\n"), MAX_EVENT_DESCRIPTION_CHARS)

  const created = await createCalendarEvent(
    {
      summary,
      description,
      startAt,
      endAt,
      timeZone: timezone,
      eventId,
      recurrence: ["RRULE:FREQ=DAILY"],
    },
    {
      accountId: mirror.accountId,
      calendarId: "primary",
      scope,
    },
  )
  console.info(
    `[gcalendar][schedule_mirror][notification] synced schedule=${scheduleId} user=${userId} account=${mirror.accountEmail || mirror.accountId || "unknown"} eventId=${created.id || "unknown"} link=${created.htmlLink || "n/a"}`,
  )
}

export async function removeNotificationScheduleFromGoogleCalendar(params: {
  scheduleId: string
  userId: string
  scope?: IntegrationsStoreScope
}): Promise<void> {
  const scheduleId = String(params.scheduleId || "").trim()
  const userId = String(params.userId || "").trim()
  if (!scheduleId || !userId) return

  let mirror
  try {
    mirror = await resolveMirrorAccount(params.scope)
  } catch {
    return
  }
  if (!mirror.ok || !mirror.accountId || !mirror.canDelete) return

  await deleteCalendarEvent(
    notificationScheduleEventId(userId, scheduleId),
    {
      accountId: mirror.accountId,
      calendarId: "primary",
      scope: params.scope,
    },
  )
}
