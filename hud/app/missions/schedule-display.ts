import type { MissionListItem } from "./types"

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const
const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" }

function triggerStep(mission: MissionListItem) {
  return mission.workflowSteps?.find((step) => step.type === "trigger")
}

function scheduleDays(mission: MissionListItem): string[] {
  const days = triggerStep(mission)?.triggerDays
  return Array.isArray(days) ? days.map((day) => String(day).toLowerCase()).filter((day) => day in DAY_LABEL) : []
}

function intervalMinutes(mission: MissionListItem): number | null {
  const raw = Number.parseInt(String(triggerStep(mission)?.triggerIntervalMinutes || ""), 10)
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

/** "Daily 09:00", "Weekly Mon, Wed 09:00", "Every 30 min", "Once 09:00". */
export function describeTrigger(mission: MissionListItem): string {
  const mode = mission.mode || "daily"
  const time = mission.time || "09:00"
  if (mode === "interval") {
    const minutes = intervalMinutes(mission)
    return minutes ? `Every ${minutes} min` : "Interval"
  }
  if (mode === "weekly") {
    const days = scheduleDays(mission)
    return days.length > 0 ? `Weekly ${days.map((day) => DAY_LABEL[day]).join(", ")} ${time}` : `Weekly ${time}`
  }
  if (mode === "once") return `Once ${time}`
  return `Daily ${time}`
}

/** Current weekday and minutes-since-midnight in an IANA timezone (falls back to local time). */
function wallClock(nowMs: number, timezone: string): { weekday: number; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(nowMs))
    const get = (type: string) => parts.find((part) => part.type === type)?.value || ""
    const weekday = WEEKDAY_KEYS.indexOf(get("weekday").slice(0, 3).toLowerCase() as (typeof WEEKDAY_KEYS)[number])
    const minutes = Number(get("hour")) * 60 + Number(get("minute"))
    if (weekday >= 0 && Number.isFinite(minutes)) return { weekday, minutes }
  } catch {
    // Unknown timezone: use the local clock.
  }
  const now = new Date(nowMs)
  return { weekday: now.getDay(), minutes: now.getHours() * 60 + now.getMinutes() }
}

/**
 * Next scheduled run as shown in the list, derived from the mission's trigger (mode, time, days) in its own timezone.
 * Interval and once schedules describe themselves since their next slot depends on runtime state.
 */
export function describeNextRun(mission: MissionListItem, nowMs: number): string {
  if (!mission.enabled) return "Paused"
  const mode = mission.mode || "daily"
  if (mode === "interval") {
    const minutes = intervalMinutes(mission)
    return minutes ? `Every ${minutes} min` : "On interval"
  }
  const match = /^(\d{2}):(\d{2})$/.exec(mission.time || "")
  if (!match) return "Not scheduled"
  const target = Number(match[1]) * 60 + Number(match[2])
  const clock = wallClock(nowMs, mission.timezone)
  const allowed = mode === "weekly" || mode === "once" ? scheduleDays(mission) : []
  for (let offset = 0; offset < 8; offset += 1) {
    const weekday = (clock.weekday + offset) % 7
    if (allowed.length > 0 && !allowed.includes(WEEKDAY_KEYS[weekday])) continue
    if (offset === 0 && target <= clock.minutes) continue
    const when = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : DAY_LABEL[WEEKDAY_KEYS[weekday]]
    return `${when} ${mission.time}`
  }
  return "Not scheduled"
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else a short date. */
export function formatRelativeTime(iso: string, nowMs: number = Date.now()): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ""
  const diff = Math.max(0, nowMs - at)
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
