import "server-only"

import { appendFile, mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises"
import { randomUUID, randomBytes } from "node:crypto"
import path from "node:path"

import type { Mission } from "../../types"
import { MISSION_VERSIONING_RETENTION_POLICY } from "./config"
import type { MissionVersionEntry, MissionVersionEventType, MissionVersionRestoreResult } from "./types"

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

function resolveVersionLogPath(userContextId: string): string {
  return path.join(resolveWorkspaceRoot(), ".agent", "user-context", userContextId, "logs", "mission-versions.jsonl")
}

function cloneMission(mission: Mission): Mission {
  return JSON.parse(JSON.stringify(mission)) as Mission
}

function normalizeEntry(entry: MissionVersionEntry): MissionVersionEntry {
  return {
    ...entry,
    versionId: String(entry.versionId || randomUUID()).trim(),
    missionId: String(entry.missionId || "").trim(),
    userContextId: sanitizeUserContextId(entry.userContextId),
    actorId: String(entry.actorId || "").trim().slice(0, 128),
    ts: String(entry.ts || new Date().toISOString()),
    eventType: entry.eventType,
    sourceMissionVersion: Number.isFinite(Number(entry.sourceMissionVersion)) ? Number(entry.sourceMissionVersion) : 1,
    reason: typeof entry.reason === "string" ? entry.reason.trim().slice(0, 512) : undefined,
    mission: cloneMission(entry.mission),
  }
}

async function readAllEntries(userContextId: string): Promise<MissionVersionEntry[]> {
  const uid = sanitizeUserContextId(userContextId)
  if (!uid) return []
  const filePath = resolveVersionLogPath(uid)
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
        return normalizeEntry(JSON.parse(line) as MissionVersionEntry)
      } catch {
        return null
      }
    })
    .filter((row): row is MissionVersionEntry => Boolean(row))
}

async function rewriteEntries(userContextId: string, entries: MissionVersionEntry[]): Promise<void> {
  const uid = sanitizeUserContextId(userContextId)
  if (!uid) return
  const filePath = resolveVersionLogPath(uid)
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n")
  await writeFile(tmpPath, `${body}${body ? "\n" : ""}`, "utf8")
  await rename(tmpPath, filePath)
  try {
    await copyFile(filePath, `${filePath}.bak`)
  } catch {
    // best effort backup
  }
}

function applyRetention(entries: MissionVersionEntry[]): MissionVersionEntry[] {
  const now = Date.now()
  const maxAgeMs = MISSION_VERSIONING_RETENTION_POLICY.maxAgeDays * 24 * 60 * 60 * 1000
  const withinAge = entries.filter((entry) => {
    const tsMs = Date.parse(entry.ts)
    if (!Number.isFinite(tsMs)) return false
    return now - tsMs <= maxAgeMs
  })
  const byMission = new Map<string, MissionVersionEntry[]>()
  for (const entry of withinAge) {
    if (!byMission.has(entry.missionId)) byMission.set(entry.missionId, [])
    byMission.get(entry.missionId)!.push(entry)
  }
  const retained: MissionVersionEntry[] = []
  for (const rows of byMission.values()) {
    rows.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    retained.push(...rows.slice(0, MISSION_VERSIONING_RETENTION_POLICY.maxVersionsPerMission))
  }
  retained.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  return retained
}

export async function appendMissionVersionEntry(input: {
  userContextId: string
  mission: Mission
  actorId: string
  eventType: MissionVersionEventType
  reason?: string
  sourceMissionVersion?: number
}): Promise<MissionVersionEntry | null> {
  const uid = sanitizeUserContextId(input.userContextId)
  if (!uid) return null
  const entry = normalizeEntry({
    versionId: randomUUID(),
    missionId: input.mission.id,
    userContextId: uid,
    actorId: input.actorId,
    ts: new Date().toISOString(),
    eventType: input.eventType,
    reason: input.reason,
    sourceMissionVersion: Number.isFinite(Number(input.sourceMissionVersion)) ? Number(input.sourceMissionVersion) : input.mission.version,
    mission: cloneMission(input.mission),
  })
  const filePath = resolveVersionLogPath(uid)
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8")

  // Retention pruning after append.
  const all = await readAllEntries(uid)
  const retained = applyRetention(all)
  if (retained.length !== all.length) {
    await rewriteEntries(uid, retained)
  }
  return entry
}

export async function listMissionVersions(input: {
  userContextId: string
  missionId: string
  limit?: number
}): Promise<MissionVersionEntry[]> {
  const uid = sanitizeUserContextId(input.userContextId)
  const missionId = String(input.missionId || "").trim()
  if (!uid || !missionId) return []
  const limit = Math.max(1, Math.min(500, Number.parseInt(String(input.limit || "100"), 10) || 100))
  const all = await readAllEntries(uid)
  return all
    .filter((entry) => entry.missionId === missionId)
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, limit)
}

export async function restoreMissionVersion(input: {
  userContextId: string
  actorId: string
  missionId: string
  versionId: string
  currentMission: Mission
  reason?: string
  validateMission: (mission: Mission) => { ok: boolean; issues: Array<{ code: string; path: string; message: string }> }
}): Promise<MissionVersionRestoreResult> {
  const uid = sanitizeUserContextId(input.userContextId)
  const missionId = String(input.missionId || "").trim()
  const versionId = String(input.versionId || "").trim()
  if (!uid || !missionId || !versionId) {
    return { ok: false, error: "userContextId, missionId, and versionId are required." }
  }
  const versions = await listMissionVersions({ userContextId: uid, missionId, limit: 1000 })
  const target = versions.find((entry) => entry.versionId === versionId)
  if (!target) return { ok: false, error: "Version not found." }

  // Mandatory pre-restore backup.
  const backup = await appendMissionVersionEntry({
    userContextId: uid,
    mission: input.currentMission,
    actorId: input.actorId,
    eventType: "pre_restore_backup",
    reason: input.reason || `Auto backup before restore ${versionId}`,
    sourceMissionVersion: input.currentMission.version,
  })

  const restoredMission = cloneMission(target.mission)
  restoredMission.version = Math.max(input.currentMission.version + 1, restoredMission.version + 1)
  restoredMission.updatedAt = new Date().toISOString()

  const validation = input.validateMission(restoredMission)
  if (!validation.ok) {
    return {
      ok: false,
      error: `Restore validation failed (${validation.issues.length} issue(s)).`,
      backupVersionId: backup?.versionId,
    }
  }

  const restored = await appendMissionVersionEntry({
    userContextId: uid,
    mission: restoredMission,
    actorId: input.actorId,
    eventType: "restore",
    reason: input.reason || `Restored from version ${versionId}`,
    sourceMissionVersion: target.sourceMissionVersion,
  })

  return {
    ok: true,
    mission: restoredMission,
    restoredVersionId: restored?.versionId,
    backupVersionId: backup?.versionId,
  }
}
