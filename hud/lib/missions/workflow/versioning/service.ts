import "server-only"

import { randomUUID } from "node:crypto"
import {
  insertVersionRecord,
  listVersionRecords,
  purgeVersionRecords,
  sanitizeUserContextId,
} from "../../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"
import type { Mission } from "../../types/index"
import { MISSION_VERSIONING_RETENTION_POLICY } from "./config"
import type { MissionVersionEntry, MissionVersionEventType, MissionVersionRestoreResult } from "./types"

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
    sourceMissionVersion: Number.isFinite(Number(entry.sourceMissionVersion)) ? Number(entry.sourceMissionVersion) : 1,
    reason: typeof entry.reason === "string" ? entry.reason.trim().slice(0, 512) : undefined,
    mission: cloneMission(entry.mission),
  }
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
    sourceMissionVersion: Number.isFinite(Number(input.sourceMissionVersion))
      ? Number(input.sourceMissionVersion)
      : input.mission.version,
    mission: cloneMission(input.mission),
  })
  insertVersionRecord(entry, MISSION_VERSIONING_RETENTION_POLICY)
  return entry
}

export async function listMissionVersions(input: {
  userContextId: string
  missionId: string
  limit?: number
}): Promise<MissionVersionEntry[]> {
  const limit = Math.max(1, Math.min(500, Number.parseInt(String(input.limit || "100"), 10) || 100))
  return listVersionRecords({
    userId: input.userContextId,
    missionId: input.missionId,
    limit,
  }) as MissionVersionEntry[]
}

export async function purgeVersionsForMission(userContextId: string, missionId: string): Promise<void> {
  purgeVersionRecords(userContextId, missionId)
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
  const versions = await listMissionVersions({ userContextId: uid, missionId, limit: 500 })
  const target = versions.find((entry) => entry.versionId === versionId)
  if (!target) return { ok: false, error: "Version not found." }

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
