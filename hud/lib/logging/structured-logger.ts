/**
 * Nova Structured Logger
 * Produces consistent JSON-lines log output for server-side events.
 * Sensitive fields (tokens, emails, credentials) are redacted via the
 * telemetry sanitizer before emission.
 *
 * Usage:
 *   log("scheduler.tick.start", { scope, holderId, tickCount })
 *   log("mission.run.complete", { missionId, userId, durationMs }, "warn")
 */
import "server-only"

import { sanitizeMissionTelemetryMetadata } from "@/lib/missions/telemetry/sanitizer"

export type LogLevel = "info" | "warn" | "error" | "debug"

export type StructuredLogEntry = {
  ts: string
  level: LogLevel
  event: string
  [key: string]: unknown
}

/**
 * Emit a structured JSON log line.
 * All metadata values are sanitized before logging.
 * Falls back to console[level] with the raw object on stringify failure.
 */
export function log(
  event: string,
  metadata: Record<string, unknown> = {},
  level: LogLevel = "info",
): void {
  // Spread user metadata first so that reserved fields (ts, level, event)
  // are always set by the logger and cannot be overwritten by caller input.
  const entry: StructuredLogEntry = {
    ...sanitizeMissionTelemetryMetadata(metadata),
    ts: new Date().toISOString(),
    level,
    event,
  }

  try {
    const line = JSON.stringify(entry)
    if (level === "error") {
      console.error(line)
    } else if (level === "warn") {
      console.warn(line)
    } else {
      console.log(line)
    }
  } catch {
    // Fallback if the entry somehow can't be serialized
    console[level]("[structured-logger] serialize failed", event, metadata)
  }
}
