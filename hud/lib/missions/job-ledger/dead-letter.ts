import "server-only"

import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

import type { JobRunSource } from "./types"

export interface MissionRunDeadLetterEntry {
  id: string
  ts: number
  userId: string
  missionId: string
  jobRunId: string
  attempt: number
  maxAttempts: number
  source: JobRunSource
  status: "dead" | "retry_enqueue_failed"
  reason: string
  errorCode?: string
  errorDetail?: string
  retryBackoffMs?: number
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

function resolveScopedDeadLetterPath(root: string, scopedUserId: string): string {
  return path.join(root, ".user", "user-context", scopedUserId, "state", "mission-run-dead-letter.jsonl")
}

function resolveDeadLetterPath(userId: string): string {
  const root = resolveWorkspaceRoot()
  const scoped = sanitizeUserContextId(userId)
  if (scoped) {
    return resolveScopedDeadLetterPath(root, scoped)
  }
  return path.join(root, "data", "mission-run-dead-letter.jsonl")
}

export async function appendMissionRunDeadLetter(
  entry: Omit<MissionRunDeadLetterEntry, "id" | "ts">,
): Promise<string> {
  const id = crypto.randomUUID()
  const row: MissionRunDeadLetterEntry = {
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
