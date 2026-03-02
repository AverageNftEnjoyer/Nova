import "server-only"

import { appendFile, mkdir, readFile, writeFile, rename, copyFile, stat } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"

export interface NotificationDeadLetterEntry {
  id: string
  ts: number
  scheduleId: string
  userId?: string
  label?: string
  source: "scheduler" | "trigger"
  runKey?: string
  attempt?: number
  reason: string
  outputOkCount: number
  outputFailCount: number
  metadata?: Record<string, unknown>
}

const writesByPath = new Map<string, Promise<void>>()

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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function resolveScopedDeadLetterPath(root: string, scopedUserId: string): string {
  return path.join(root, ".agent", "user-context", scopedUserId, "state", "notification-dead-letter.jsonl")
}

function resolveLegacyScopedDeadLetterPath(root: string, scopedUserId: string): string {
  return path.join(root, ".agent", "user-context", scopedUserId, "notification-dead-letter.jsonl")
}

async function migrateLegacyDeadLetterFileIfNeeded(userId?: string): Promise<void> {
  const scoped = sanitizeUserContextId(userId)
  if (!scoped) return
  const root = resolveWorkspaceRoot()
  const targetPath = resolveScopedDeadLetterPath(root, scoped)
  const legacyPath = resolveLegacyScopedDeadLetterPath(root, scoped)
  if (await fileExists(targetPath)) return
  if (!(await fileExists(legacyPath))) return
  await mkdir(path.dirname(targetPath), { recursive: true })
  try {
    await rename(legacyPath, targetPath)
  } catch {
    try {
      await copyFile(legacyPath, targetPath)
    } catch {
      // Best effort migration.
    }
  }
}

function resolveDeadLetterPath(userId?: string): string {
  const root = resolveWorkspaceRoot()
  const scoped = sanitizeUserContextId(userId)
  if (scoped) {
    return resolveScopedDeadLetterPath(root, scoped)
  }
  return path.join(root, "data", "notification-dead-letter.jsonl")
}

export async function purgeDeadLetterForMission(
  userId: string | undefined,
  scheduleId: string,
): Promise<void> {
  const mid = String(scheduleId || "").trim()
  if (!mid) return
  await migrateLegacyDeadLetterFileIfNeeded(userId)
  const filePath = resolveDeadLetterPath(userId)
  const resolved = path.resolve(filePath)
  const previous = writesByPath.get(resolved) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    let raw = ""
    try {
      raw = await readFile(filePath, "utf8")
    } catch {
      return
    }
    const lines = raw.split("\n").filter(Boolean)
    const kept = lines.filter((line) => {
      try {
        const row = JSON.parse(line) as Partial<NotificationDeadLetterEntry>
        return String(row.scheduleId || "") !== mid
      } catch {
        return true
      }
    })
    if (kept.length === lines.length) return
    const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
    await writeFile(tmpPath, `${kept.join("\n")}${kept.length > 0 ? "\n" : ""}`, "utf8")
    await rename(tmpPath, filePath)
  })
  writesByPath.set(resolved, next)
  try {
    await next
  } finally {
    if (writesByPath.get(resolved) === next) {
      writesByPath.delete(resolved)
    }
  }
}

export async function appendNotificationDeadLetter(entry: Omit<NotificationDeadLetterEntry, "id" | "ts">): Promise<string> {
  await migrateLegacyDeadLetterFileIfNeeded(entry.userId)
  const id = crypto.randomUUID()
  const row: NotificationDeadLetterEntry = {
    ...entry,
    id,
    ts: Date.now(),
  }
  const filePath = resolveDeadLetterPath(entry.userId)
  const resolved = path.resolve(filePath)
  const previous = writesByPath.get(resolved) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8")
  })
  writesByPath.set(resolved, next)
  try {
    await next
  } finally {
    if (writesByPath.get(resolved) === next) {
      writesByPath.delete(resolved)
    }
  }
  return id
}
