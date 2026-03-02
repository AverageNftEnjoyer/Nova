/**
 * Calendar Reschedule Store - Phase 2
 *
 * Persists per-user calendar drag-drop reschedule overrides independently of
 * the Mission graph so Builder edits and calendar edits do not conflict.
 *
 * Stored at: .agent/user-context/<userId>/calendar/calendar-overrides.json
 * Keyed by: (userId, missionId) - no cross-user access possible.
 */

import "server-only"

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"

export interface RescheduleRecord {
  missionId: string
  userId: string
  originalTime: string
  overriddenTime: string
  overriddenBy: "calendar" | "builder"
  createdAt: string
  updatedAt: string
}

const CALENDAR_DIR_NAME = "calendar"
const OVERRIDES_FILE_NAME = "calendar-overrides.json"

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

function resolveOverridesFile(userId: string): string {
  return path.join(resolveUserContextRoot(), userId, CALENDAR_DIR_NAME, OVERRIDES_FILE_NAME)
}

const writesByPath = new Map<string, Promise<void>>()

async function atomicWriteJson(filePath: string, payload: unknown): Promise<void> {
  const resolved = path.resolve(filePath)
  const previous = writesByPath.get(resolved) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(resolved), { recursive: true })
      const tmpPath = `${resolved}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
      await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
      try {
        await copyFile(resolved, `${resolved}.bak`)
      } catch {
        // First write.
      }
      await rename(tmpPath, resolved)
    })
  writesByPath.set(resolved, next)
  await next
}

const locksByUserId = new Map<string, Promise<void>>()

function isValidIso(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false
  const ms = Date.parse(value)
  return Number.isFinite(ms) && ms > 0
}

function validateRescheduleRecord(raw: unknown): RescheduleRecord | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.missionId !== "string" || !r.missionId.trim()) return null
  if (typeof r.userId !== "string" || !r.userId.trim()) return null
  if (!isValidIso(r.overriddenTime)) return null
  if (!isValidIso(r.originalTime)) return null
  return {
    missionId: r.missionId.trim().slice(0, 128),
    userId: r.userId.trim().slice(0, 96),
    originalTime: r.originalTime as string,
    overriddenTime: r.overriddenTime as string,
    overriddenBy: r.overriddenBy === "builder" ? "builder" : "calendar",
    createdAt: isValidIso(r.createdAt) ? (r.createdAt as string) : new Date().toISOString(),
    updatedAt: isValidIso(r.updatedAt) ? (r.updatedAt as string) : new Date().toISOString(),
  }
}

async function readOverridesFile(filePath: string): Promise<RescheduleRecord[] | null> {
  try {
    const raw = await readFile(filePath, "utf8")
    if (!raw.trim()) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed
      .map(validateRescheduleRecord)
      .filter((record): record is RescheduleRecord => record !== null)
  } catch {
    return null
  }
}

export async function loadRescheduleOverrides(userId: string): Promise<RescheduleRecord[]> {
  const uid = sanitizeUserId(userId)
  if (!uid) return []

  const file = resolveOverridesFile(uid)

  const primary = await readOverridesFile(file)
  if (primary !== null) return primary

  const backup = await readOverridesFile(`${file}.bak`)
  if (backup !== null) {
    await atomicWriteJson(file, backup)
    return backup
  }

  return []
}

export async function getRescheduleOverride(
  userId: string,
  missionId: string,
): Promise<RescheduleRecord | null> {
  const overrides = await loadRescheduleOverrides(userId)
  return overrides.find((record) => record.missionId === missionId) ?? null
}

export async function setRescheduleOverride(
  userId: string,
  missionId: string,
  newStartAt: string,
  originalTime: string,
): Promise<RescheduleRecord> {
  const uid = sanitizeUserId(userId)
  if (!uid) throw new Error("Invalid userId")

  const prev = locksByUserId.get(uid) ?? Promise.resolve()
  let result!: RescheduleRecord
  const next = prev.catch(() => undefined).then(async () => {
    const overrides = await loadRescheduleOverrides(uid)
    const now = new Date().toISOString()
    const existing = overrides.find((record) => record.missionId === missionId)
    if (existing) {
      existing.overriddenTime = newStartAt
      existing.updatedAt = now
      result = existing
    } else {
      result = {
        missionId,
        userId: uid,
        originalTime,
        overriddenTime: newStartAt,
        overriddenBy: "calendar",
        createdAt: now,
        updatedAt: now,
      }
      overrides.push(result)
    }
    await atomicWriteJson(resolveOverridesFile(uid), overrides)
  })
  locksByUserId.set(uid, next)
  await next
  return result
}

export async function deleteRescheduleOverride(
  userId: string,
  missionId: string,
): Promise<boolean> {
  const uid = sanitizeUserId(userId)
  if (!uid) return false

  const prev = locksByUserId.get(uid) ?? Promise.resolve()
  let deleted = false
  const next = prev.catch(() => undefined).then(async () => {
    const overrides = await loadRescheduleOverrides(uid)
    const before = overrides.length
    const after = overrides.filter((record) => record.missionId !== missionId)
    deleted = after.length < before
    if (deleted) {
      await atomicWriteJson(resolveOverridesFile(uid), after)
    }
  })
  locksByUserId.set(uid, next)
  await next
  return deleted
}
