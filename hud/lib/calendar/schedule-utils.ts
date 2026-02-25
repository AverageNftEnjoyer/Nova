/**
 * Shared calendar scheduling utilities.
 * Used by aggregator.ts and agent-task-source.ts — single source of truth.
 */

const DAY_MAP: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

const MAX_EXPANSIONS_PER_MISSION = 366

/**
 * Expand all dates in [rangeStart, rangeEnd) that match the given schedule mode.
 * Returns ISO date strings ("YYYY-MM-DD").
 * Hard-capped at MAX_EXPANSIONS_PER_MISSION to prevent runaway loops.
 */
export function expandDates(
  rangeStart: Date,
  rangeEnd: Date,
  mode: string,
  days: string[] | undefined,
): string[] {
  const results: string[] = []
  const cursor = new Date(rangeStart)
  while (cursor < rangeEnd && results.length < MAX_EXPANSIONS_PER_MISSION) {
    const dow = cursor.getDay()
    const dateStr = cursor.toISOString().slice(0, 10)
    if (mode === "daily") {
      results.push(dateStr)
    } else if (mode === "weekly" && days && days.length > 0) {
      if (days.some((d) => DAY_MAP[d.toLowerCase()] === dow)) {
        results.push(dateStr)
      }
    } else if (mode === "once") {
      results.push(dateStr)
      break
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return results
}

/**
 * Parse "HH:MM" in a given IANA timezone on a given wall-clock date string
 * ("YYYY-MM-DD") and return an ISO8601 UTC string.
 * Falls back to UTC on any parse failure.
 */
export function toIsoInTimezone(dateStr: string, timeStr: string, tz: string): string {
  try {
    const [h, m] = timeStr.split(":").map(Number)
    if (!Number.isFinite(h) || !Number.isFinite(m)) {
      return new Date(`${dateStr}T09:00:00Z`).toISOString()
    }
    const dt = new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`)
    const localFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    })
    const parts = Object.fromEntries(localFmt.formatToParts(dt).map((p) => [p.type, p.value]))
    const localStr = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
    const offset = dt.getTime() - new Date(localStr).getTime()
    return new Date(
      new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).getTime() + offset,
    ).toISOString()
  } catch {
    return new Date(`${dateStr}T09:00:00Z`).toISOString()
  }
}

/** Rough duration estimate from node count (~45s per node + 30s base). */
export function estimateDurationMs(nodeCount: number): number {
  return (30 + nodeCount * 45) * 1000
}
