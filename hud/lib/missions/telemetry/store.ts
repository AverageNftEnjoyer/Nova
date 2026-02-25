import "server-only"

import path from "node:path"
import { appendFile, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"

import { MISSION_TELEMETRY_POLICY } from "./config"
import type { MissionLifecycleEvent } from "./types"

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

function resolveTelemetryLogPath(userContextId: string): string {
  return path.join(resolveWorkspaceRoot(), ".agent", "user-context", userContextId, "logs", "mission-telemetry.jsonl")
}

function normalizeEvent(event: MissionLifecycleEvent): MissionLifecycleEvent {
  return {
    ...event,
    eventId: String(event.eventId || "").trim(),
    ts: String(event.ts || new Date().toISOString()),
    userContextId: sanitizeUserContextId(event.userContextId),
    missionId: typeof event.missionId === "string" ? event.missionId.trim() : undefined,
    missionRunId: typeof event.missionRunId === "string" ? event.missionRunId.trim() : undefined,
    scheduleId: typeof event.scheduleId === "string" ? event.scheduleId.trim() : undefined,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Math.max(0, Number(event.durationMs)) : undefined,
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : undefined,
  }
}

async function readAllEvents(userContextId: string): Promise<MissionLifecycleEvent[]> {
  const uid = sanitizeUserContextId(userContextId)
  if (!uid) return []
  const filePath = resolveTelemetryLogPath(uid)
  let raw = ""
  try {
    raw = await readFile(filePath, "utf8")
  } catch {
    return []
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeEvent(JSON.parse(line) as MissionLifecycleEvent)
      } catch {
        return null
      }
    })
    .filter((row): row is MissionLifecycleEvent => Boolean(row) && Boolean(row?.userContextId))
}

function applyRetention(events: MissionLifecycleEvent[]): MissionLifecycleEvent[] {
  const nowMs = Date.now()
  const minTs = nowMs - MISSION_TELEMETRY_POLICY.retentionDays * 24 * 60 * 60 * 1000
  const filtered = events.filter((event) => {
    const tsMs = Date.parse(event.ts)
    if (!Number.isFinite(tsMs)) return false
    return tsMs >= minTs
  })
  filtered.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  if (filtered.length <= MISSION_TELEMETRY_POLICY.maxEventsPerUser) return filtered
  return filtered.slice(filtered.length - MISSION_TELEMETRY_POLICY.maxEventsPerUser)
}

async function rewriteEvents(userContextId: string, events: MissionLifecycleEvent[]): Promise<void> {
  const uid = sanitizeUserContextId(userContextId)
  if (!uid) return
  const filePath = resolveTelemetryLogPath(uid)
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  const body = events.map((event) => JSON.stringify(event)).join("\n")
  await writeFile(tmpPath, `${body}${body ? "\n" : ""}`, "utf8")
  await rename(tmpPath, filePath)
  try {
    await copyFile(filePath, `${filePath}.bak`)
  } catch {
    // best effort backup
  }
}

export async function appendMissionTelemetryEvent(event: MissionLifecycleEvent): Promise<void> {
  const normalized = normalizeEvent(event)
  if (!normalized.userContextId || !normalized.eventId) return
  const filePath = resolveTelemetryLogPath(normalized.userContextId)
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(normalized)}\n`, "utf8")
  const all = await readAllEvents(normalized.userContextId)
  const retained = applyRetention(all)
  if (retained.length !== all.length) {
    await rewriteEvents(normalized.userContextId, retained)
  }
}

export async function purgeTelemetryForMission(
  userContextId: string,
  missionId: string,
): Promise<void> {
  const uid = sanitizeUserContextId(userContextId)
  const mid = String(missionId || "").trim()
  if (!uid || !mid) return
  const all = await readAllEvents(uid)
  const filtered = all.filter((event) => event.missionId !== mid && event.scheduleId !== mid)
  if (filtered.length !== all.length) {
    await rewriteEvents(uid, filtered)
  }
}

export async function listMissionTelemetryEvents(input: {
  userContextId: string
  sinceTs?: string
  limit?: number
}): Promise<MissionLifecycleEvent[]> {
  const uid = sanitizeUserContextId(input.userContextId)
  if (!uid) return []
  const limit = Math.max(1, Math.min(5000, Number.parseInt(String(input.limit || "500"), 10) || 500))
  const sinceMs = input.sinceTs ? Date.parse(input.sinceTs) : NaN
  const all = await readAllEvents(uid)
  const filtered = Number.isFinite(sinceMs)
    ? all.filter((event) => Date.parse(event.ts) >= sinceMs)
    : all
  filtered.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
  return filtered.slice(0, limit)
}
