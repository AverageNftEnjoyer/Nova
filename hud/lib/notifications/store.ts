import "server-only"

import { mkdir, readdir, readFile, rename, writeFile, copyFile, stat } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"

export interface NotificationSchedule {
  id: string
  userId?: string
  integration: string
  label: string
  message: string
  time: string
  timezone: string
  enabled: boolean
  chatIds: string[]
  createdAt: string
  updatedAt: string
  lastSentLocalDate?: string
  runCount: number
  successCount: number
  failureCount: number
  lastRunAt?: string
  lastRunStatus?: "success" | "error" | "skipped"
}

interface NotificationScheduleStoreFile {
  version: number
  schedules: NotificationSchedule[]
  updatedAt: string
  migratedAt?: string
}

function normalizeIntegration(value: unknown, raw?: Partial<NotificationSchedule>): string {
  const integration = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (integration && /^[a-z0-9_-]+$/.test(integration)) return integration

  // Legacy records may not have an integration field. Use conservative inference.
  const chatIds = Array.isArray(raw?.chatIds) ? raw.chatIds.map((v) => String(v).toLowerCase()) : []
  if (chatIds.some((id) => id.includes("discord.com/api/webhooks") || id.includes("discordapp.com/api/webhooks"))) {
    return "discord"
  }

  const label = typeof raw?.label === "string" ? raw.label.toLowerCase() : ""
  const message = typeof raw?.message === "string" ? raw.message.toLowerCase() : ""
  if (label.includes("discord") || message.includes("discord") || label.includes("discor") || message.includes("discor")) {
    return "discord"
  }
  if (label.includes("telegram") || message.includes("telegram")) {
    return "telegram"
  }

  return "telegram"
}

const DATA_FILE_NAME = "notification-schedules.json"
const STATE_DIR_NAME = "state"
const STORE_SCHEMA_VERSION = 2
const LEGACY_DATA_DIR = path.join(process.cwd(), "data")
const LEGACY_DATA_FILE = path.join(LEGACY_DATA_DIR, DATA_FILE_NAME)
const writesByPath = new Map<string, Promise<void>>()

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  return path.basename(cwd).toLowerCase() === "hud" ? path.resolve(cwd, "..") : cwd
}

function resolveUserContextRoot(): string {
  return path.join(resolveWorkspaceRoot(), ".agent", "user-context")
}

function sanitizeUserContextId(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized.slice(0, 96)
}

function resolveScopedDataFile(userId: string): string {
  return path.join(resolveUserContextRoot(), userId, STATE_DIR_NAME, DATA_FILE_NAME)
}

function resolveLegacyScopedDataFile(userId: string): string {
  return path.join(resolveUserContextRoot(), userId, DATA_FILE_NAME)
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function migrateLegacyScopedDataFileIfNeeded(userId: string): Promise<void> {
  const target = resolveScopedDataFile(userId)
  const legacy = resolveLegacyScopedDataFile(userId)
  if (await fileExists(target)) return
  if (!(await fileExists(legacy))) return
  await mkdir(path.dirname(target), { recursive: true })
  try {
    await rename(legacy, target)
  } catch {
    try {
      await copyFile(legacy, target)
    } catch {
      // Best effort migration only.
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
      // Best effort migration only.
    }
  }
}

function defaultStorePayload(): NotificationScheduleStoreFile {
  return {
    version: STORE_SCHEMA_VERSION,
    schedules: [],
    updatedAt: new Date().toISOString(),
  }
}

function sortSchedulesDeterministically(rows: NotificationSchedule[]): NotificationSchedule[] {
  return [...rows].sort((a, b) => {
    const byCreatedAt = String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    if (byCreatedAt !== 0) return byCreatedAt
    return String(a.id || "").localeCompare(String(b.id || ""))
  })
}

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
      await rename(tmpPath, resolved)
      try {
        await copyFile(resolved, `${resolved}.bak`)
      } catch {
        // Best effort backup only.
      }
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

async function ensureScopedDataFile(userId: string) {
  await migrateLegacyScopedDataFileIfNeeded(userId)
  const dataFile = resolveScopedDataFile(userId)
  await mkdir(path.dirname(dataFile), { recursive: true })
  try {
    await readFile(dataFile, "utf8")
  } catch {
    await atomicWriteJson(dataFile, defaultStorePayload())
  }
}

function normalizeRecord(raw: Partial<NotificationSchedule>): NotificationSchedule | null {
  if (!raw.id || !raw.message || !raw.time || !raw.timezone || !raw.createdAt || !raw.updatedAt) {
    return null
  }

  const runCount = Number.isFinite(Number(raw.runCount)) ? Math.max(0, Number(raw.runCount)) : 0
  const successCount = Number.isFinite(Number(raw.successCount)) ? Math.max(0, Number(raw.successCount)) : 0
  const failureCount = Number.isFinite(Number(raw.failureCount)) ? Math.max(0, Number(raw.failureCount)) : 0

  return {
    id: raw.id,
    userId: typeof raw.userId === "string" ? raw.userId.trim() : "",
    integration: normalizeIntegration(raw.integration, raw),
    label: raw.label?.trim() || "Scheduled notification",
    message: raw.message,
    time: raw.time,
    timezone: raw.timezone,
    enabled: raw.enabled ?? true,
    chatIds: Array.isArray(raw.chatIds) ? raw.chatIds.map((c) => String(c).trim()).filter(Boolean) : [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastSentLocalDate: raw.lastSentLocalDate,
    runCount,
    successCount,
    failureCount,
    lastRunAt: raw.lastRunAt,
    lastRunStatus:
      raw.lastRunStatus === "success" || raw.lastRunStatus === "error" || raw.lastRunStatus === "skipped"
        ? raw.lastRunStatus
        : undefined,
  }
}

function normalizeStorePayload(
  parsed: unknown,
  scopedUserId: string,
): { store: NotificationScheduleStoreFile; mutated: boolean } {
  const normalizedUserId = sanitizeUserContextId(scopedUserId)
  const inputObject =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  const inputSchedules = Array.isArray(parsed)
    ? parsed
    : Array.isArray(inputObject?.schedules)
      ? inputObject?.schedules
      : []

  const schedules = inputSchedules
    .map((row) => normalizeRecord(row as Partial<NotificationSchedule>))
    .filter((row): row is NotificationSchedule => row !== null)
    .map((row) => ({ ...row, userId: normalizedUserId }))
  const deterministic = sortSchedulesDeterministically(schedules)
  const normalized: NotificationScheduleStoreFile = {
    version: STORE_SCHEMA_VERSION,
    schedules: deterministic,
    updatedAt: new Date().toISOString(),
  }

  const sourceVersion = inputObject?.version
  const hasValidVersion = Number.isInteger(sourceVersion) && Number(sourceVersion) === STORE_SCHEMA_VERSION
  const sourceUpdatedAt = typeof inputObject?.updatedAt === "string" ? inputObject.updatedAt : ""
  const shouldCarryUpdatedAt = Boolean(sourceUpdatedAt)
  if (shouldCarryUpdatedAt) {
    normalized.updatedAt = sourceUpdatedAt
  }
  if (!hasValidVersion || Array.isArray(parsed)) {
    normalized.migratedAt = new Date().toISOString()
  } else if (typeof inputObject?.migratedAt === "string" && inputObject.migratedAt.trim()) {
    normalized.migratedAt = inputObject.migratedAt
  }

  const sourceComparable = inputObject
    ? {
        version: Number.isFinite(Number(inputObject.version)) ? Number(inputObject.version) : -1,
        schedules: Array.isArray(inputObject.schedules) ? inputObject.schedules : [],
      }
    : {
        version: Array.isArray(parsed) ? 1 : -1,
        schedules: Array.isArray(parsed) ? parsed : [],
      }
  const normalizedComparable = {
    version: STORE_SCHEMA_VERSION,
    schedules: deterministic,
  }

  const mutated =
    JSON.stringify(sourceComparable) !== JSON.stringify(normalizedComparable) ||
    !hasValidVersion ||
    Array.isArray(parsed)

  return {
    store: normalized,
    mutated,
  }
}

async function listScopedUserIdsWithDataFile(): Promise<string[]> {
  const userContextRoot = resolveUserContextRoot()
  try {
    const entries = await readdir(userContextRoot, { withFileTypes: true })
    const matches = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => /^[a-z0-9_-]+$/.test(name))
      .map(async (name) => {
        if (await fileExists(resolveScopedDataFile(name))) return name
        if (await fileExists(resolveLegacyScopedDataFile(name))) return name
        return ""
      }))
    return matches.filter(Boolean)
  } catch {
    return []
  }
}

async function loadScopedUserSchedules(userId: string): Promise<NotificationSchedule[]> {
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) return []
  await ensureScopedDataFile(scopedUserId)
  const dataFile = resolveScopedDataFile(scopedUserId)
  try {
    const raw = await readFile(dataFile, "utf8")
    const parsed = JSON.parse(raw) as unknown
    const { store, mutated } = normalizeStorePayload(parsed, scopedUserId)
    if (mutated) {
      await atomicWriteJson(dataFile, {
        ...store,
        updatedAt: new Date().toISOString(),
      })
    }
    return store.schedules
  } catch {
    try {
      const backupRaw = await readFile(`${dataFile}.bak`, "utf8")
      const parsedBackup = JSON.parse(backupRaw) as unknown
      const { store } = normalizeStorePayload(parsedBackup, scopedUserId)
      await atomicWriteJson(dataFile, {
        ...store,
        updatedAt: new Date().toISOString(),
      })
      return store.schedules
    } catch {
      await atomicWriteJson(dataFile, defaultStorePayload())
      return []
    }
  }
}

async function saveScopedUserSchedules(userId: string, schedules: NotificationSchedule[]): Promise<void> {
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) return
  await ensureScopedDataFile(scopedUserId)
  const dataFile = resolveScopedDataFile(scopedUserId)
  const normalized = sortSchedulesDeterministically(
    schedules
    .map((row) => normalizeRecord(row))
    .filter((row): row is NotificationSchedule => row !== null)
    .map((row) => ({ ...row, userId: scopedUserId }))
  )
  await atomicWriteJson(dataFile, {
    version: STORE_SCHEMA_VERSION,
    schedules: normalized,
    updatedAt: new Date().toISOString(),
  } satisfies NotificationScheduleStoreFile)
}

let legacyMigrationPromise: Promise<void> | null = null
async function migrateLegacySchedulesIfNeeded(): Promise<void> {
  if (legacyMigrationPromise) {
    await legacyMigrationPromise
    return
  }

  legacyMigrationPromise = (async () => {
    let parsed: unknown
    try {
      const raw = await readFile(LEGACY_DATA_FILE, "utf8")
      parsed = JSON.parse(raw)
    } catch {
      parsed = []
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return

    const normalized = parsed
      .map((row) => normalizeRecord(row as Partial<NotificationSchedule>))
      .filter((row): row is NotificationSchedule => row !== null)

    const byUser = new Map<string, NotificationSchedule[]>()
    for (const row of normalized) {
      const scopedUserId = sanitizeUserContextId(row.userId || "")
      if (!scopedUserId) continue
      if (!byUser.has(scopedUserId)) byUser.set(scopedUserId, [])
      byUser.get(scopedUserId)!.push({ ...row, userId: scopedUserId })
    }

    for (const [userId, incoming] of byUser.entries()) {
      const existing = await loadScopedUserSchedules(userId)
      const merged = [...existing]
      const seen = new Set(existing.map((row) => row.id))
      for (const row of incoming) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        merged.push(row)
      }
      await saveScopedUserSchedules(userId, merged)
    }

    await mkdir(LEGACY_DATA_DIR, { recursive: true })
    await atomicWriteJson(LEGACY_DATA_FILE, [])
  })()

  try {
    await legacyMigrationPromise
  } finally {
    legacyMigrationPromise = null
  }
}

export async function loadSchedules(options?: { userId?: string | null; allUsers?: boolean }): Promise<NotificationSchedule[]> {
  await migrateLegacySchedulesIfNeeded()

  if (options?.allUsers) {
    const userIds = await listScopedUserIdsWithDataFile()
    const grouped = await Promise.all(userIds.map(async (userId) => loadScopedUserSchedules(userId)))
    return grouped.flat()
  }

  const userId = sanitizeUserContextId(options?.userId || "")
  if (!userId) return []
  return loadScopedUserSchedules(userId)
}

export async function saveSchedules(
  schedules: NotificationSchedule[],
  options?: { userId?: string | null; allUsers?: boolean },
): Promise<void> {
  await migrateLegacySchedulesIfNeeded()
  const normalized = schedules
    .map((row) => normalizeRecord(row))
    .filter((row): row is NotificationSchedule => row !== null)
  if (!options || options.allUsers) {
    const byUser = new Map<string, NotificationSchedule[]>()
    for (const row of normalized) {
      const userId = sanitizeUserContextId(row.userId || "")
      if (!userId) continue
      if (!byUser.has(userId)) byUser.set(userId, [])
      byUser.get(userId)!.push({ ...row, userId })
    }

    const existingUserIds = await listScopedUserIdsWithDataFile()
    const touched = new Set<string>(existingUserIds)
    for (const userId of byUser.keys()) touched.add(userId)

    await Promise.all(
      [...touched].map(async (userId) => {
        const next = byUser.get(userId) || []
        await saveScopedUserSchedules(userId, next)
      }),
    )
    return
  }
  const userId = sanitizeUserContextId(options?.userId || "")
  if (!userId) {
    return
  }
  await saveScopedUserSchedules(userId, normalized.map((row) => ({ ...row, userId })))
}

export function parseDailyTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null

  return { hour, minute }
}

export function buildSchedule(input: {
  id?: string
  userId?: string
  integration?: string
  label?: string
  message: string
  time: string
  timezone?: string
  enabled?: boolean
  chatIds?: string[]
}): NotificationSchedule {
  const now = new Date().toISOString()

  return {
    id: String(input.id || "").trim() || crypto.randomUUID(),
    userId: String(input.userId || "").trim(),
    integration: normalizeIntegration(input.integration),
    label: input.label?.trim() || "Scheduled notification",
    message: input.message.trim(),
    time: input.time,
    timezone: input.timezone || "America/New_York",
    enabled: input.enabled ?? true,
    chatIds: (input.chatIds ?? []).map((c) => c.trim()).filter(Boolean),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    lastRunAt: undefined,
    lastRunStatus: undefined,
  }
}
