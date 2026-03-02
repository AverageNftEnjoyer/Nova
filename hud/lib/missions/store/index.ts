/**
 * Mission Store
 *
 * Persistence layer for the Mission format. Stores missions.json per user.
 */

import "server-only"

import { mkdir, readdir, readFile, rename, writeFile, copyFile, stat } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"
import type {
  Mission,
  MissionNode,
  MissionConnection,
  MissionCategory,
  MissionSettings,
} from "../types/index"
import { defaultMissionSettings } from "../types/index"

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MISSIONS_FILE_NAME = "missions.json"
const STATE_DIR_NAME = "state"
const MISSIONS_SCHEMA_VERSION = 1
const writesByPath = new Map<string, Promise<void>>()
// Per-user lock for read-modify-write operations (upsert/delete) — prevents lost updates
// under concurrent requests for the same user.
const upsertLocksByUserId = new Map<string, Promise<void>>()

// ─────────────────────────────────────────────────────────────────────────────
// Path Helpers
// ─────────────────────────────────────────────────────────────────────────────

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

function resolveUserContextRoot(): string {
  return path.join(resolveWorkspaceRoot(), ".agent", "user-context")
}

function sanitizeUserId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96)
}

function resolveMissionsFile(userId: string): string {
  return path.join(resolveUserContextRoot(), userId, STATE_DIR_NAME, MISSIONS_FILE_NAME)
}

function resolveLegacyMissionsFile(userId: string): string {
  return path.join(resolveUserContextRoot(), userId, MISSIONS_FILE_NAME)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function migrateLegacyMissionsFileIfNeeded(userId: string): Promise<void> {
  const target = resolveMissionsFile(userId)
  const legacy = resolveLegacyMissionsFile(userId)
  if (await fileExists(target)) return
  if (!(await fileExists(legacy))) return
  await mkdir(path.dirname(target), { recursive: true })
  try {
    await rename(legacy, target)
  } catch {
    try {
      await copyFile(legacy, target)
    } catch {
      // Best effort migration.
    }
  }

  const legacyBak = `${legacy}.bak`
  const targetBak = `${target}.bak`
  if (await fileExists(targetBak)) return
  if (!(await fileExists(legacyBak))) return
  try {
    await rename(legacyBak, targetBak)
  } catch {
    try {
      await copyFile(legacyBak, targetBak)
    } catch {
      // Best effort migration.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic Write
// ─────────────────────────────────────────────────────────────────────────────

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const resolved = path.resolve(filePath)
  const previous = writesByPath.get(resolved) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true })
      const tmpPath = `${resolved}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
      const body = `${JSON.stringify(payload, null, 2)}\n`
      await writeFile(tmpPath, body, "utf8")
      // Backup the current file BEFORE overwriting it, so .bak is never stale
      try {
        await copyFile(resolved, `${resolved}.bak`)
      } catch {
        // Best-effort — file may not exist yet on first write.
      }
      await rename(tmpPath, resolved)
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

// ─────────────────────────────────────────────────────────────────────────────
// Store File Format
// ─────────────────────────────────────────────────────────────────────────────

interface MissionsStoreFile {
  version: number
  missions: Mission[]
  deletedIds?: string[]
  updatedAt: string
  migratedAt?: string
}

function defaultStorePayload(): MissionsStoreFile {
  return {
    version: MISSIONS_SCHEMA_VERSION,
    missions: [],
    updatedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

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
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)).filter(Boolean) : [],
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
    chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map((c) => String(c).trim()).filter(Boolean) : [],
  }
}

function sortMissions(rows: Mission[]): Mission[] {
  return [...rows].sort((a, b) => {
    const byCreated = String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    if (byCreated !== 0) return byCreated
    return String(a.id || "").localeCompare(String(b.id || ""))
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoped Load / Save
// ─────────────────────────────────────────────────────────────────────────────

async function ensureMissionsFile(userId: string): Promise<void> {
  await migrateLegacyMissionsFileIfNeeded(userId)
  const file = resolveMissionsFile(userId)
  await mkdir(path.dirname(file), { recursive: true })
  try {
    await readFile(file, "utf8")
  } catch {
    await atomicWriteJson(file, defaultStorePayload())
  }
}

async function readRawStoreFile(userId: string): Promise<MissionsStoreFile | null> {
  const sanitized = sanitizeUserId(userId)
  if (!sanitized) return null
  await migrateLegacyMissionsFileIfNeeded(sanitized)
  const file = resolveMissionsFile(sanitized)
  try {
    const raw = await readFile(file, "utf8")
    return JSON.parse(raw) as MissionsStoreFile
  } catch {
    return null
  }
}

async function loadScopedMissions(userId: string): Promise<Mission[]> {
  const sanitized = sanitizeUserId(userId)
  if (!sanitized) return []
  await ensureMissionsFile(sanitized)
  const file = resolveMissionsFile(sanitized)
  try {
    const raw = await readFile(file, "utf8")
    const parsed = JSON.parse(raw) as MissionsStoreFile
    return (Array.isArray(parsed.missions) ? parsed.missions : [])
      .map((m) => normalizeMission(m as Partial<Mission>))
      .filter((m): m is Mission => m !== null)
      .map((m) => ({ ...m, userId: sanitized }))
  } catch {
    try {
      const backupRaw = await readFile(`${file}.bak`, "utf8")
      const parsed = JSON.parse(backupRaw) as MissionsStoreFile
      return (Array.isArray(parsed.missions) ? parsed.missions : [])
        .map((m) => normalizeMission(m as Partial<Mission>))
        .filter((m): m is Mission => m !== null)
        .map((m) => ({ ...m, userId: sanitized }))
    } catch {
      await atomicWriteJson(file, defaultStorePayload())
      return []
    }
  }
}

async function saveScopedMissions(userId: string, missions: Mission[], deletedIds?: string[]): Promise<void> {
  const sanitized = sanitizeUserId(userId)
  if (!sanitized) return
  const file = resolveMissionsFile(sanitized)
  const normalized = sortMissions(
    missions
      .map((m) => normalizeMission(m))
      .filter((m): m is Mission => m !== null)
      .map((m) => ({ ...m, userId: sanitized })),
  )
  // If no deletedIds provided, preserve existing ones from disk so they survive all writes.
  let finalDeletedIds = deletedIds
  if (finalDeletedIds === undefined) {
    const raw = await readRawStoreFile(sanitized)
    finalDeletedIds = Array.isArray(raw?.deletedIds) ? raw.deletedIds : []
  }
  // Cap tombstone list to 500 entries — trim oldest (head) to prevent unbounded growth
  if (finalDeletedIds.length > 500) {
    finalDeletedIds = finalDeletedIds.slice(finalDeletedIds.length - 500)
  }
  const payload: MissionsStoreFile = {
    version: MISSIONS_SCHEMA_VERSION,
    missions: normalized,
    updatedAt: new Date().toISOString(),
  }
  if (finalDeletedIds.length > 0) {
    payload.deletedIds = finalDeletedIds
  }
  await atomicWriteJson(file, payload)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function loadMissions(options?: { userId?: string | null; allUsers?: boolean }): Promise<Mission[]> {
  if (options?.allUsers) {
    const userContextRoot = resolveUserContextRoot()
    let userIds: string[] = []
    try {
      const entries = await readdir(userContextRoot, { withFileTypes: true })
      userIds = entries.filter((e) => e.isDirectory()).map((e) => e.name).filter((n) => /^[a-z0-9_-]+$/.test(n))
    } catch {
      return []
    }
    const grouped = await Promise.all(userIds.map(async (uid) => loadScopedMissions(uid)))
    return grouped.flat()
  }

  const userId = sanitizeUserId(options?.userId || "")
  if (!userId) return []
  return loadScopedMissions(userId)
}

export async function saveMissions(
  missions: Mission[],
  options?: { userId?: string | null },
): Promise<void> {
  if (!options?.userId) {
    // Group by userId
    const byUser = new Map<string, Mission[]>()
    for (const m of missions) {
      const uid = sanitizeUserId(m.userId || "")
      if (!uid) continue
      if (!byUser.has(uid)) byUser.set(uid, [])
      byUser.get(uid)!.push(m)
    }
    await Promise.all(
      [...byUser.entries()].map(async ([uid, userMissions]) => {
        await saveScopedMissions(uid, userMissions)
      }),
    )
    return
  }
  const uid = sanitizeUserId(options.userId)
  if (!uid) return
  await saveScopedMissions(uid, missions.map((m) => ({ ...m, userId: uid })))
}

export async function upsertMission(mission: Mission, userId: string): Promise<void> {
  const uid = sanitizeUserId(userId)
  if (!uid) return
  // Serialize all upserts per user to prevent read-modify-write races
  const prev = upsertLocksByUserId.get(uid) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const existing = await loadScopedMissions(uid)
    const idx = existing.findIndex((m) => m.id === mission.id)
    if (idx >= 0) {
      // Preserve existing execution metadata (lastRunAt, lastRunStatus, etc.) unless the
      // incoming mission explicitly overwrites them.
      existing[idx] = { ...existing[idx], ...mission, userId: uid, updatedAt: new Date().toISOString() }
    } else {
      existing.push({ ...mission, userId: uid })
    }
    await saveScopedMissions(uid, existing)
  })
  upsertLocksByUserId.set(uid, next)
  try {
    await next
  } finally {
    if (upsertLocksByUserId.get(uid) === next) {
      upsertLocksByUserId.delete(uid)
    }
  }
}

export interface MissionDeleteResult {
  ok: boolean
  deleted: boolean
  reason: "deleted" | "invalid_user" | "not_found"
}

export async function deleteMission(missionId: string, userId: string): Promise<MissionDeleteResult> {
  const uid = sanitizeUserId(userId)
  if (!uid) return { ok: false, deleted: false, reason: "invalid_user" }
  const targetMissionId = String(missionId || "").trim()
  if (!targetMissionId) return { ok: true, deleted: false, reason: "not_found" }

  let result: MissionDeleteResult = { ok: true, deleted: false, reason: "not_found" }
  // Serialize with upserts to prevent concurrent read-modify-write races
  const prev = upsertLocksByUserId.get(uid) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const existing = await loadScopedMissions(uid)
    const filtered = existing.filter((m) => m.id !== targetMissionId)
    if (filtered.length === existing.length) return
    const rawStore = await readRawStoreFile(uid)
    const existingDeletedIds = Array.isArray(rawStore?.deletedIds) ? rawStore.deletedIds : []
    const updatedDeletedIds = [...new Set([...existingDeletedIds, targetMissionId])]
    await saveScopedMissions(uid, filtered, updatedDeletedIds)
    result = { ok: true, deleted: true, reason: "deleted" }
  })
  upsertLocksByUserId.set(uid, next)
  try {
    await next
  } finally {
    if (upsertLocksByUserId.get(uid) === next) {
      upsertLocksByUserId.delete(uid)
    }
  }
  return result
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
