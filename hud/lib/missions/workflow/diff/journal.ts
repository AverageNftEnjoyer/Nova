import "server-only"

import { mkdir, appendFile } from "node:fs/promises"
import path from "node:path"
import type { MissionDiffJournalEntry } from "./types"

function sanitizeUserContextId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)
}

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

function resolveJournalPath(userContextId: string): string {
  return path.join(
    resolveWorkspaceRoot(),
    ".agent",
    "user-context",
    userContextId,
    "logs",
    "mission-operation-journal.jsonl",
  )
}

export async function appendMissionOperationJournalEntry(entry: MissionDiffJournalEntry): Promise<void> {
  const userContextId = sanitizeUserContextId(entry.userContextId)
  if (!userContextId) return
  const filePath = resolveJournalPath(userContextId)
  await mkdir(path.dirname(filePath), { recursive: true })
  const payload = {
    ...entry,
    userContextId,
    actorId: String(entry.actorId || "").trim().slice(0, 128),
    missionId: String(entry.missionId || "").trim().slice(0, 128),
    ts: String(entry.ts || new Date().toISOString()),
  }
  await appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8")
}
