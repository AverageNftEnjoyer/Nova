import "server-only"

import {
  deleteMissionRecord,
  listMissionUserIds,
  readMissionRecords,
  replaceMissionRecords,
  sanitizeUserContextId,
  upsertMissionRecord,
} from "../../../../src/runtime/modules/services/missions/persistence/sqlite-store.js"
import type {
  Mission,
  MissionCategory,
  MissionConnection,
  MissionNode,
  MissionSettings,
} from "../types/index"
import { defaultMissionSettings } from "../types/index"

function sanitizeUserId(value: unknown): string {
  return sanitizeUserContextId(value)
}

function normalizeMission(raw: Partial<Mission>): Mission | null {
  if (!raw.id || !raw.createdAt || !raw.updatedAt) return null
  const settings: MissionSettings = {
    ...defaultMissionSettings(),
    ...(typeof raw.settings === "object" && raw.settings !== null ? raw.settings : {}),
  }
  return {
    id: raw.id,
    userId: String(raw.userId || ""),
    label: String(raw.label || "Untitled Mission"),
    description: String(raw.description || ""),
    category: (raw.category as MissionCategory) || "research",
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [],
    status: (raw.status as Mission["status"]) || "active",
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1,
    nodes: Array.isArray(raw.nodes) ? (raw.nodes as MissionNode[]) : [],
    connections: Array.isArray(raw.connections) ? (raw.connections as MissionConnection[]) : [],
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    settings,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastRunAt: raw.lastRunAt,
    lastSentLocalDate: raw.lastSentLocalDate,
    runCount: Number.isFinite(Number(raw.runCount)) ? Math.max(0, Number(raw.runCount)) : 0,
    successCount: Number.isFinite(Number(raw.successCount)) ? Math.max(0, Number(raw.successCount)) : 0,
    failureCount: Number.isFinite(Number(raw.failureCount)) ? Math.max(0, Number(raw.failureCount)) : 0,
    lastRunStatus: raw.lastRunStatus,
    integration: String(raw.integration || "telegram"),
    chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map(String).map((value) => value.trim()).filter(Boolean) : [],
  }
}

function loadScopedMissions(userId: string): Mission[] {
  const uid = sanitizeUserId(userId)
  if (!uid) return []
  return readMissionRecords(uid)
    .map((record) => normalizeMission(record as Partial<Mission>))
    .filter((mission): mission is Mission => mission !== null)
    .map((mission) => ({ ...mission, userId: uid }))
}

export async function loadMissions(options?: { userId?: string | null; allUsers?: boolean }): Promise<Mission[]> {
  if (options?.allUsers) return listMissionUserIds().flatMap(loadScopedMissions)
  return loadScopedMissions(options?.userId || "")
}

export async function saveMissions(missions: Mission[], options?: { userId?: string | null }): Promise<void> {
  if (options?.userId) {
    const uid = sanitizeUserId(options.userId)
    if (!uid) return
    replaceMissionRecords(uid, missions.map((mission) => ({ ...mission, userId: uid })))
    return
  }
  const byUser = new Map<string, Mission[]>()
  for (const mission of missions) {
    const uid = sanitizeUserId(mission.userId)
    if (!uid) continue
    const rows = byUser.get(uid) ?? []
    rows.push({ ...mission, userId: uid })
    byUser.set(uid, rows)
  }
  for (const [uid, rows] of byUser) replaceMissionRecords(uid, rows)
}

export async function upsertMission(mission: Mission, userId: string): Promise<void> {
  const uid = sanitizeUserId(userId)
  if (!uid || !mission?.id) return
  upsertMissionRecord(
    uid,
    mission.id,
    (existing) => normalizeMission(
      existing
        ? { ...(existing as Mission), ...mission, userId: uid, updatedAt: new Date().toISOString() }
        : { ...mission, userId: uid },
    ),
    mission,
  )
}

export interface MissionDeleteResult {
  ok: boolean
  deleted: boolean
  reason: "deleted" | "invalid_user" | "not_found"
}

export async function deleteMission(missionId: string, userId: string): Promise<MissionDeleteResult> {
  const uid = sanitizeUserId(userId)
  if (!uid) return { ok: false, deleted: false, reason: "invalid_user" }
  const id = String(missionId || "").trim()
  if (!id) return { ok: true, deleted: false, reason: "not_found" }
  const deleted = deleteMissionRecord(uid, id)
  return { ok: true, deleted, reason: deleted ? "deleted" : "not_found" }
}

export function buildMission(input: {
  userId?: string
  label?: string
  description?: string
  category?: MissionCategory
  tags?: string[]
  nodes?: MissionNode[]
  connections?: MissionConnection[]
  integration?: string
  chatIds?: string[]
}): Mission {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    userId: String(input.userId || ""),
    label: input.label?.trim() || "New Mission",
    description: input.description?.trim() || "",
    category: input.category || "research",
    tags: input.tags || [],
    status: "draft",
    version: 1,
    nodes: input.nodes || [],
    connections: input.connections || [],
    variables: [],
    settings: defaultMissionSettings(),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: input.integration || "telegram",
    chatIds: input.chatIds || [],
  }
}
