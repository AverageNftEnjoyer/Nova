import "server-only"

import { appendFile, mkdir } from "node:fs/promises"
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
