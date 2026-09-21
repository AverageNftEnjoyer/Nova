import "server-only"

import {
  appendRunLogRecord,
  purgeRunLogRecords,
  readRunLogRecords,
} from "../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"

export type NotificationRunStatus = "success" | "error" | "skipped"

export interface NotificationRunLogEntry {
  ts: number
  scheduleId: string
  userId?: string
  label?: string
  source: "scheduler" | "trigger"
  status: NotificationRunStatus
  error?: string
  mode?: string
  dayStamp?: string
  runKey?: string
  attempt?: number
  durationMs?: number
  outputOkCount?: number
  outputFailCount?: number
}

function normalizeEntry(parsed: Partial<NotificationRunLogEntry>): NotificationRunLogEntry | null {
  if (!parsed.scheduleId || !parsed.status || !parsed.ts) return null
  return {
    ts: Number(parsed.ts),
    scheduleId: String(parsed.scheduleId),
    userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
    label: typeof parsed.label === "string" ? parsed.label : undefined,
    source: parsed.source === "trigger" ? "trigger" : "scheduler",
    status: parsed.status === "success" || parsed.status === "skipped" ? parsed.status : "error",
    error: typeof parsed.error === "string" ? parsed.error : undefined,
    mode: typeof parsed.mode === "string" ? parsed.mode : undefined,
    dayStamp: typeof parsed.dayStamp === "string" ? parsed.dayStamp : undefined,
    runKey: typeof parsed.runKey === "string" ? parsed.runKey : undefined,
    attempt: Number(parsed.attempt) > 0 ? Number(parsed.attempt) : undefined,
    durationMs: Number(parsed.durationMs) >= 0 ? Number(parsed.durationMs) : undefined,
    outputOkCount: Number(parsed.outputOkCount) >= 0 ? Number(parsed.outputOkCount) : undefined,
    outputFailCount: Number(parsed.outputFailCount) >= 0 ? Number(parsed.outputFailCount) : undefined,
  }
}

export async function appendNotificationRunLog(
  scheduleId: string,
  userId: string | undefined,
  entry: NotificationRunLogEntry,
): Promise<void> {
  appendRunLogRecord(scheduleId, userId, entry)
}

export async function readNotificationRunLogEntries(
  scheduleId: string,
  userId: string | undefined,
  opts?: { maxLines?: number },
): Promise<NotificationRunLogEntry[]> {
  const maxLines = Number.isFinite(Number(opts?.maxLines || 0)) ? Math.max(1, Number(opts?.maxLines || 0)) : 400
  return readRunLogRecords(scheduleId, userId, maxLines)
    .map((entry) => normalizeEntry(entry as Partial<NotificationRunLogEntry>))
    .filter((entry): entry is NotificationRunLogEntry => entry !== null)
}

export async function purgeNotificationRunLog(scheduleId: string, userId: string | undefined): Promise<void> {
  purgeRunLogRecords(scheduleId, userId)
}

export async function getRunKeyHistory(params: {
  scheduleId: string
  userId?: string
  runKey: string
  maxLines?: number
}): Promise<{
  runKey: string
  attempts: number
  successCount: number
  errorCount: number
  skippedCount: number
  latestTs: number
  latestStatus: NotificationRunStatus | ""
}> {
  const runKey = String(params.runKey || "").trim()
  const empty = { runKey, attempts: 0, successCount: 0, errorCount: 0, skippedCount: 0, latestTs: 0, latestStatus: "" as const }
  if (!runKey) return empty
  const entries = await readNotificationRunLogEntries(params.scheduleId, params.userId, { maxLines: params.maxLines })
  const filtered = entries.filter((entry) => String(entry.runKey || "").trim() === runKey)
  if (filtered.length === 0) return empty
  const latest = [...filtered].sort((a, b) => a.ts - b.ts).at(-1)!
  return {
    runKey,
    attempts: filtered.length,
    successCount: filtered.filter((entry) => entry.status === "success").length,
    errorCount: filtered.filter((entry) => entry.status === "error").length,
    skippedCount: filtered.filter((entry) => entry.status === "skipped").length,
    latestTs: latest.ts,
    latestStatus: latest.status,
  }
}
