/**
 * Mission Time Utilities
 *
 * Shared time helpers used by native mission scheduling and execution paths.
 */

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
    const lookup = new Map(parts.map((part) => [part.type, part.value]))
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
    const lookup = new Map(parts.map((part) => [part.type, part.value]))
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
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}
