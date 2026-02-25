import "server-only"

import { appendFile, mkdir, readFile, writeFile, rename } from "node:fs/promises"
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

function resolveDeadLetterPath(userId?: string): string {
  const root = resolveWorkspaceRoot()
  const scoped = sanitizeUserContextId(userId)
  if (scoped) {
    return path.join(root, ".agent", "user-context", scoped, "notification-dead-letter.jsonl")
  }
  return path.join(root, "data", "notification-dead-letter.jsonl")
}

export async function purgeDeadLetterForMission(
  userId: string | undefined,
  scheduleId: string,
): Promise<void> {
  const mid = String(scheduleId || "").trim()
  if (!mid) return
  const filePath = resolveDeadLetterPath(userId)
  let raw = ""
  try {
    raw = await readFile(filePath, "utf8")
  } catch {
    return // file doesn't exist — nothing to purge
  }
  const lines = raw.split("\n").filter(Boolean)
  const kept = lines.filter((line) => {
    try {
      const row = JSON.parse(line) as Partial<NotificationDeadLetterEntry>
      return String(row.scheduleId || "") !== mid
    } catch {
      return true // keep malformed lines
    }
  })
  if (kept.length === lines.length) return
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(tmpPath, `${kept.join("\n")}${kept.length > 0 ? "\n" : ""}`, "utf8")
  await rename(tmpPath, filePath)
}

export async function appendNotificationDeadLetter(entry: Omit<NotificationDeadLetterEntry, "id" | "ts">): Promise<string> {
  const id = crypto.randomUUID()
  const row: NotificationDeadLetterEntry = {
    ...entry,
    id,
    ts: Date.now(),
  }
  const filePath = resolveDeadLetterPath(entry.userId)
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8")
  return id
}
