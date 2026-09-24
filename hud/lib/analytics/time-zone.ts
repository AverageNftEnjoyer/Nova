/**
 * Calendar-day helpers in an explicit IANA time zone (client-safe, no Node APIs).
 *
 * Analytics buckets usage into the VIEWER's local days. The HUD sends its zone (`Intl` resolvedOptions) with each
 * request; the server never relies on its own process zone for day boundaries, so half-hour and 45-minute offsets
 * (Asia/Kolkata +05:30, Asia/Kathmandu +05:45, America/St_Johns -03:30 / -02:30 DST) and DST changes are exact.
 *
 * Every zone in use today has an offset that is a multiple of 15 minutes and changes offset on a 15-minute
 * boundary, so a UTC 15-minute bucket always falls inside exactly one local day (see usage-aggregation.ts).
 */

const MINUTE_MS = 60_000
const QUARTER_HOUR_MS = 15 * MINUTE_MS
const MAX_TIME_ZONE_LENGTH = 64

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The zone of the current process (the user's machine for the local server; the browser's zone on the client). */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/** A valid IANA zone from a query value; anything missing, too long or unknown → the system zone. */
export function resolveTimeZone(raw: string | null | undefined): string {
  const text = String(raw ?? "").trim()
  if (!text || text.length > MAX_TIME_ZONE_LENGTH || !isValidTimeZone(text)) return systemTimeZone()
  return text
}

function dateFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(zone)
  if (!formatter) {
    // en-CA formats as YYYY-MM-DD.
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    dateFormatters.set(zone, formatter)
  }
  return formatter
}

/** YYYY-MM-DD of an instant in `zone`. */
export function zonedDateKey(ms: number, zone: string): string {
  const parts = dateFormatter(zone).formatToParts(new Date(ms))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** UTC offset of `zone` at an instant, in ms (e.g. +19_800_000 for Asia/Kolkata). */
export function zoneOffsetMs(ms: number, zone: string): number {
  let formatter = offsetFormatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
    offsetFormatters.set(zone, formatter)
  }
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {}
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") values[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(
    values.year ?? 1970,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    values.hour ?? 0,
    values.minute ?? 0,
    values.second ?? 0,
  )
  const wholeSecond = Math.floor(ms / 1000) * 1000
  return Math.round((asUtc - wholeSecond) / MINUTE_MS) * MINUTE_MS
}

/** Calendar arithmetic on a YYYY-MM-DD key (zone independent). */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days))
  return date.toISOString().slice(0, 10)
}

/**
 * The first instant (UTC ms) of local day `dateKey` in `zone`. Usually local midnight; when a DST change skips
 * midnight, the first instant that exists on that day.
 */
export function zonedDayStartMs(dateKey: string, zone: string): number {
  const [y, m, d] = dateKey.split("-").map(Number)
  const wallMidnight = Date.UTC(y, (m || 1) - 1, d || 1)
  let candidate = wallMidnight - zoneOffsetMs(wallMidnight, zone)
  candidate = wallMidnight - zoneOffsetMs(candidate, zone)
  // Settle on a 15-minute grid: step back while the previous quarter hour is still on this day, forward while the
  // candidate is still on the previous day. Bounded: offsets never move by more than a few hours.
  for (let i = 0; i < 16 && zonedDateKey(candidate - QUARTER_HOUR_MS, zone) >= dateKey; i++) candidate -= QUARTER_HOUR_MS
  for (let i = 0; i < 16 && zonedDateKey(candidate, zone) < dateKey; i++) candidate += QUARTER_HOUR_MS
  return candidate
}
