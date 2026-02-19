import "server-only"

import { mkdir, readFile, stat, writeFile, appendFile, rename } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"

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

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

function sanitizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

export function resolveNotificationRunLogPath(scheduleId: string, userId?: string): string {
  const root = resolveWorkspaceRoot()
  const cleanId = String(scheduleId || "").trim() || "unknown"
  const scopedUserId = sanitizeUserContextId(userId)
  if (scopedUserId) {
    return path.join(root, ".agent", "user-context", scopedUserId, "notification-runs", `${cleanId}.jsonl`)
  }
  return path.join(root, "data", "notification-runs", `${cleanId}.jsonl`)
}

async function pruneIfNeeded(filePath: string, opts: { maxBytes: number; keepLines: number }) {
  const fileStat = await stat(filePath).catch(() => null)
  if (!fileStat || fileStat.size <= opts.maxBytes) return

  const raw = await readFile(filePath, "utf8").catch(() => "")
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  const kept = lines.slice(Math.max(0, lines.length - opts.keepLines))
  const tmp = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(tmp, `${kept.join("\n")}\n`, "utf8")
  await rename(tmp, filePath)
}

const writesByPath = new Map<string, Promise<void>>()

export async function appendNotificationRunLog(
  scheduleId: string,
  userId: string | undefined,
  entry: NotificationRunLogEntry,
): Promise<void> {
  const filePath = resolveNotificationRunLogPath(scheduleId, userId)
  const resolved = path.resolve(filePath)
  const previous = writesByPath.get(resolved) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true })
      await appendFile(resolved, `${JSON.stringify(entry)}\n`, "utf8")
      await pruneIfNeeded(resolved, { maxBytes: 2_000_000, keepLines: 2_000 })
    })
  writesByPath.set(resolved, next)
  await next
}

export async function readNotificationRunLogEntries(
  scheduleId: string,
  userId: string | undefined,
  opts?: { maxLines?: number },
): Promise<NotificationRunLogEntry[]> {
  const filePath = resolveNotificationRunLogPath(scheduleId, userId)
  const raw = await readFile(filePath, "utf8").catch(() => "")
  if (!raw) return []
  const maxLines = Number.isFinite(Number(opts?.maxLines || 0))
    ? Math.max(1, Number(opts?.maxLines || 0))
    : 400
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines)
  const entries: NotificationRunLogEntry[] = []
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<NotificationRunLogEntry>
      if (!parsed || typeof parsed !== "object") continue
      if (!parsed.scheduleId || !parsed.status || !parsed.ts) continue
      entries.push({
        ts: Number(parsed.ts || 0),
        scheduleId: String(parsed.scheduleId),
        userId: typeof parsed.userId === "string" ? parsed.userId : undefined,
        label: typeof parsed.label === "string" ? parsed.label : undefined,
        source: parsed.source === "trigger" ? "trigger" : "scheduler",
        status:
          parsed.status === "success" || parsed.status === "error" || parsed.status === "skipped"
            ? parsed.status
            : "error",
        error: typeof parsed.error === "string" ? parsed.error : undefined,
        mode: typeof parsed.mode === "string" ? parsed.mode : undefined,
        dayStamp: typeof parsed.dayStamp === "string" ? parsed.dayStamp : undefined,
        runKey: typeof parsed.runKey === "string" ? parsed.runKey : undefined,
        attempt:
          Number.isFinite(Number(parsed.attempt || 0)) && Number(parsed.attempt || 0) > 0
            ? Number(parsed.attempt || 0)
            : undefined,
        durationMs:
          Number.isFinite(Number(parsed.durationMs || 0)) && Number(parsed.durationMs || 0) >= 0
            ? Number(parsed.durationMs || 0)
            : undefined,
        outputOkCount:
          Number.isFinite(Number(parsed.outputOkCount || 0)) && Number(parsed.outputOkCount || 0) >= 0
            ? Number(parsed.outputOkCount || 0)
            : undefined,
        outputFailCount:
          Number.isFinite(Number(parsed.outputFailCount || 0)) && Number(parsed.outputFailCount || 0) >= 0
            ? Number(parsed.outputFailCount || 0)
            : undefined,
      })
    } catch {
      // ignore malformed legacy rows
    }
  }
  return entries
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
  if (!runKey) {
    return {
      runKey: "",
      attempts: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      latestTs: 0,
      latestStatus: "",
    }
  }
  const entries = await readNotificationRunLogEntries(params.scheduleId, params.userId, {
    maxLines: params.maxLines,
  })
  const filtered = entries.filter((entry) => String(entry.runKey || "").trim() === runKey)
  if (filtered.length === 0) {
    return {
      runKey,
      attempts: 0,
      successCount: 0,
      errorCount: 0,
      skippedCount: 0,
      latestTs: 0,
      latestStatus: "",
    }
  }
  const ordered = [...filtered].sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
  const latest = ordered[ordered.length - 1]
  return {
    runKey,
    attempts: filtered.length,
    successCount: filtered.filter((entry) => entry.status === "success").length,
    errorCount: filtered.filter((entry) => entry.status === "error").length,
    skippedCount: filtered.filter((entry) => entry.status === "skipped").length,
    latestTs: Number(latest.ts || 0),
    latestStatus: latest.status || "",
  }
}
