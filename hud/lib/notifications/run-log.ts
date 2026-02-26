import "server-only"

import { mkdir, readFile, stat, writeFile, appendFile, rename, unlink, copyFile, readdir, rm } from "node:fs/promises"
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

const STATE_DIR_NAME = "state"
const RUN_LOG_DIR_NAME = "notification-runs"

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

function resolveScopedNotificationRunLogPath(scheduleId: string, userId: string): string {
  const root = resolveWorkspaceRoot()
  const cleanId = String(scheduleId || "").trim() || "unknown"
  return path.join(root, ".agent", "user-context", userId, STATE_DIR_NAME, RUN_LOG_DIR_NAME, `${cleanId}.jsonl`)
}

function resolveLegacyScopedNotificationRunLogPath(scheduleId: string, userId: string): string {
  const root = resolveWorkspaceRoot()
  const cleanId = String(scheduleId || "").trim() || "unknown"
  return path.join(root, ".agent", "user-context", userId, RUN_LOG_DIR_NAME, `${cleanId}.jsonl`)
}

function resolveUnscopedNotificationRunLogPath(scheduleId: string): string {
  const root = resolveWorkspaceRoot()
  const cleanId = String(scheduleId || "").trim() || "unknown"
  return path.join(root, "data", RUN_LOG_DIR_NAME, `${cleanId}.jsonl`)
}

export function resolveNotificationRunLogPath(scheduleId: string, userId?: string): string {
  const scopedUserId = sanitizeUserContextId(userId)
  if (scopedUserId) {
    return resolveScopedNotificationRunLogPath(scheduleId, scopedUserId)
  }
  return resolveUnscopedNotificationRunLogPath(scheduleId)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function migrateLegacyScopedRunLogIfNeeded(scheduleId: string, userId: string | undefined): Promise<void> {
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) return
  const target = resolveScopedNotificationRunLogPath(scheduleId, scopedUserId)
  const legacy = resolveLegacyScopedNotificationRunLogPath(scheduleId, scopedUserId)
  if (await fileExists(target)) {
    await pruneLegacyScopedRunLogDirIfEmpty(scopedUserId)
    return
  }
  if (!(await fileExists(legacy))) return
  await mkdir(path.dirname(target), { recursive: true })
  try {
    await rename(legacy, target)
  } catch {
    try {
      await copyFile(legacy, target)
      try {
        await unlink(legacy)
      } catch {
        // Best effort cleanup only.
      }
    } catch {
      // Best effort migration only.
    }
  }
  await pruneLegacyScopedRunLogDirIfEmpty(scopedUserId)
}

async function removeDirIfEmpty(dirPath: string): Promise<void> {
  let entries: string[] = []
  try {
    entries = await readdir(dirPath)
  } catch {
    return
  }
  if (entries.length > 0) return
  try {
    await rm(dirPath, { recursive: false, force: true })
  } catch {
    // Best effort cleanup only.
  }
}

async function pruneLegacyScopedRunLogDirIfEmpty(scopedUserId: string): Promise<void> {
  if (!scopedUserId) return
  const root = resolveWorkspaceRoot()
  const legacyDir = path.join(root, ".agent", "user-context", scopedUserId, RUN_LOG_DIR_NAME)
  await removeDirIfEmpty(legacyDir)
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
  await migrateLegacyScopedRunLogIfNeeded(scheduleId, userId)
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
  await migrateLegacyScopedRunLogIfNeeded(scheduleId, userId)
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

/**
 * Permanently delete the run log file for a specific mission/schedule ID.
 * Called as part of mission deletion to prevent orphaned per-run log files.
 */
export async function purgeNotificationRunLog(
  scheduleId: string,
  userId: string | undefined,
): Promise<void> {
  await migrateLegacyScopedRunLogIfNeeded(scheduleId, userId)
  const filePath = resolveNotificationRunLogPath(scheduleId, userId)
  const scopedUserId = sanitizeUserContextId(userId)
  const legacyFilePath = scopedUserId
    ? resolveLegacyScopedNotificationRunLogPath(scheduleId, scopedUserId)
    : ""
  try {
    await unlink(filePath)
  } catch {
    // File may not exist - that's fine.
  }
  if (!legacyFilePath) return
  try {
    await unlink(legacyFilePath)
  } catch {
    // Legacy file may not exist - that's fine.
  }
  await pruneLegacyScopedRunLogDirIfEmpty(scopedUserId)
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

