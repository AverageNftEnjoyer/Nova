/**
 * NovaChat Pending Messages
 *
 * Server-side storage for mission outputs that should be delivered to NovaChat.
 * The chat UI polls for these messages and creates new conversations.
 */

import "server-only"

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export interface PendingNovaChatMessage {
  id: string
  userId: string
  title: string
  content: string
  missionId?: string
  missionLabel?: string
  createdAt: string
  consumed: boolean
}

const DATA_FILE_NAME = "novachat-pending.json"
const LOCK_FILE_NAME = "novachat-pending.lock"
const LEGACY_DATA_DIR = path.join(process.cwd(), "data")
const LEGACY_DATA_FILE = path.join(LEGACY_DATA_DIR, DATA_FILE_NAME)
const LEGACY_LOCK_FILE = path.join(LEGACY_DATA_DIR, LOCK_FILE_NAME)

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
  return path.join(resolveUserContextRoot(), userId, DATA_FILE_NAME)
}

function resolveScopedLockFile(userId: string): string {
  return path.join(resolveUserContextRoot(), userId, LOCK_FILE_NAME)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureDataFile(userId: string) {
  const dataFile = resolveScopedDataFile(userId)
  await mkdir(path.dirname(dataFile), { recursive: true })
  try {
    await readFile(dataFile, "utf8")
  } catch {
    await writeFile(dataFile, "[]", "utf8")
  }
}

async function acquireLock(lockFile: string, timeoutMs = 3000): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await mkdir(path.dirname(lockFile), { recursive: true })
      await writeFile(lockFile, `${process.pid}`, { encoding: "utf8", flag: "wx" })
      return async () => {
        try {
          await unlink(lockFile)
        } catch {
          // ignore
        }
      }
    } catch (error) {
      if (!(error instanceof Error) || !String((error as NodeJS.ErrnoException).code || "").includes("EEXIST")) {
        throw error
      }
      await sleep(30)
    }
  }
  throw new Error("Failed to acquire NovaChat pending-message lock.")
}

async function withLockedStoreWrite<T>(
  userId: string,
  action: (messages: PendingNovaChatMessage[]) => PendingNovaChatMessage[] | T,
): Promise<T | void> {
  await ensureDataFile(userId)
  const dataFile = resolveScopedDataFile(userId)
  const lockFile = resolveScopedLockFile(userId)
  const release = await acquireLock(lockFile)
  try {
    const raw = await readFile(dataFile, "utf8").catch(() => "[]")
    const parsed = JSON.parse(raw) as PendingNovaChatMessage[]
    const messages = Array.isArray(parsed) ? parsed : []
    const result = action(messages)
    if (Array.isArray(result)) {
      await writeFile(dataFile, JSON.stringify(result, null, 2), "utf8")
      return
    }
    // If callback returned custom payload, assume callback already wrote file if needed.
    return result
  } finally {
    await release()
  }
}

async function listScopedUserIdsWithDataFile(): Promise<string[]> {
  const userContextRoot = resolveUserContextRoot()
  try {
    const entries = await readdir(userContextRoot, { withFileTypes: true })
    const userIds: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const userId = entry.name
      if (!/^[a-z0-9_-]+$/.test(userId)) continue
      const dataFile = resolveScopedDataFile(userId)
      try {
        await readFile(dataFile, "utf8")
        userIds.push(userId)
      } catch {
        // ignore
      }
    }
    return userIds
  } catch {
    return []
  }
}

let legacyMigrationPromise: Promise<void> | null = null
async function migrateLegacyPendingIfNeeded(): Promise<void> {
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

    const byUser = new Map<string, PendingNovaChatMessage[]>()
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue
      const msg = row as Partial<PendingNovaChatMessage>
      const scopedUserId = sanitizeUserContextId(msg.userId || "")
      if (!scopedUserId || !msg.id || !msg.title || !msg.content || !msg.createdAt) continue
      const normalized: PendingNovaChatMessage = {
        id: String(msg.id),
        userId: scopedUserId,
        title: String(msg.title),
        content: String(msg.content),
        missionId: msg.missionId ? String(msg.missionId) : undefined,
        missionLabel: msg.missionLabel ? String(msg.missionLabel) : undefined,
        createdAt: String(msg.createdAt),
        consumed: Boolean(msg.consumed),
      }
      if (!byUser.has(scopedUserId)) byUser.set(scopedUserId, [])
      byUser.get(scopedUserId)!.push(normalized)
    }

    for (const [userId, incoming] of byUser.entries()) {
      await withLockedStoreWrite(userId, (messages) => {
        const merged = [...messages]
        const seen = new Set(messages.map((msg) => msg.id))
        for (const row of incoming) {
          if (seen.has(row.id)) continue
          seen.add(row.id)
          merged.push(row)
        }
        return merged
      })
    }

    await mkdir(LEGACY_DATA_DIR, { recursive: true })
    await writeFile(LEGACY_DATA_FILE, "[]", "utf8")
    try {
      await unlink(LEGACY_LOCK_FILE)
    } catch {
      // ignore
    }
  })()

  try {
    await legacyMigrationPromise
  } finally {
    legacyMigrationPromise = null
  }
}

/**
 * Load all pending messages for a user.
 */
export async function loadPendingMessages(userId: string): Promise<PendingNovaChatMessage[]> {
  await migrateLegacyPendingIfNeeded()
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) return []
  await ensureDataFile(scopedUserId)
  const dataFile = resolveScopedDataFile(scopedUserId)
  try {
    const raw = await readFile(dataFile, "utf8")
    const parsed = JSON.parse(raw) as PendingNovaChatMessage[]
    if (!Array.isArray(parsed)) return []
    // Return unconsumed messages for this user
    return parsed.filter(
      (msg) => msg.userId === scopedUserId && !msg.consumed
    )
  } catch {
    return []
  }
}

/**
 * Add a new pending message.
 */
export async function addPendingMessage(input: {
  userId: string
  title: string
  content: string
  missionId?: string
  missionLabel?: string
}): Promise<PendingNovaChatMessage> {
  await migrateLegacyPendingIfNeeded()
  const scopedUserId = sanitizeUserContextId(input.userId)
  if (!scopedUserId) throw new Error("Missing userId for pending NovaChat message")
  await ensureDataFile(scopedUserId)

  const message: PendingNovaChatMessage = {
    id: crypto.randomUUID(),
    userId: scopedUserId,
    title: input.title,
    content: input.content,
    missionId: input.missionId,
    missionLabel: input.missionLabel,
    createdAt: new Date().toISOString(),
    consumed: false,
  }

  await withLockedStoreWrite(scopedUserId, (messages) => {
    messages.push(message)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return messages.filter(
      (msg) => !msg.consumed || new Date(msg.createdAt).getTime() > cutoff
    )
  })
  return message
}

/**
 * Mark a message as consumed (picked up by the chat UI).
 */
export async function markMessageConsumed(messageId: string): Promise<void> {
  await migrateLegacyPendingIfNeeded()
  const userIds = await listScopedUserIdsWithDataFile()
  for (const userId of userIds) {
    await withLockedStoreWrite(userId, (messages) =>
      messages.map((msg) =>
        msg.id === messageId ? { ...msg, consumed: true } : msg
      ),
    )
  }
}

/**
 * Mark multiple messages as consumed.
 */
export async function markMessagesConsumed(messageIds: string[]): Promise<void> {
  await migrateLegacyPendingIfNeeded()
  const idSet = new Set(messageIds.map((id) => String(id || "").trim()).filter(Boolean))
  if (idSet.size === 0) return
  const userIds = await listScopedUserIdsWithDataFile()
  for (const userId of userIds) {
    await withLockedStoreWrite(userId, (messages) =>
      messages.map((msg) =>
        idSet.has(msg.id) ? { ...msg, consumed: true } : msg
      ),
    )
  }
}

/**
 * Mark multiple messages as consumed for a specific user.
 */
export async function markMessagesConsumedForUser(userId: string, messageIds: string[]): Promise<void> {
  await migrateLegacyPendingIfNeeded()
  const scopedUserId = sanitizeUserContextId(userId)
  if (!scopedUserId) return
  const idSet = new Set(messageIds.map((id) => String(id || "").trim()).filter(Boolean))
  if (idSet.size === 0) return
  await withLockedStoreWrite(scopedUserId, (messages) =>
    messages.map((msg) =>
      msg.userId === scopedUserId && idSet.has(msg.id)
        ? { ...msg, consumed: true }
        : msg
    )
  )
}
