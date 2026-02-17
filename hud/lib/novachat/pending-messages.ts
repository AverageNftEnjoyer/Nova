/**
 * NovaChat Pending Messages
 *
 * Server-side storage for mission outputs that should be delivered to NovaChat.
 * The chat UI polls for these messages and creates new conversations.
 */

import "server-only"

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
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

const DATA_DIR = path.join(process.cwd(), "data")
const DATA_FILE = path.join(DATA_DIR, "novachat-pending.json")
const LOCK_FILE = path.join(DATA_DIR, "novachat-pending.lock")

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureDataFile() {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(DATA_FILE, "utf8")
  } catch {
    await writeFile(DATA_FILE, "[]", "utf8")
  }
}

async function acquireLock(timeoutMs = 3000): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await writeFile(LOCK_FILE, `${process.pid}`, { encoding: "utf8", flag: "wx" })
      return async () => {
        try {
          await unlink(LOCK_FILE)
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

async function withLockedStoreWrite<T>(action: (messages: PendingNovaChatMessage[]) => PendingNovaChatMessage[] | T): Promise<T | void> {
  await ensureDataFile()
  const release = await acquireLock()
  try {
    const raw = await readFile(DATA_FILE, "utf8").catch(() => "[]")
    const parsed = JSON.parse(raw) as PendingNovaChatMessage[]
    const messages = Array.isArray(parsed) ? parsed : []
    const result = action(messages)
    if (Array.isArray(result)) {
      await writeFile(DATA_FILE, JSON.stringify(result, null, 2), "utf8")
      return
    }
    // If callback returned custom payload, assume callback already wrote file if needed.
    return result
  } finally {
    await release()
  }
}

/**
 * Load all pending messages for a user.
 */
export async function loadPendingMessages(userId: string): Promise<PendingNovaChatMessage[]> {
  await ensureDataFile()
  try {
    const raw = await readFile(DATA_FILE, "utf8")
    const parsed = JSON.parse(raw) as PendingNovaChatMessage[]
    if (!Array.isArray(parsed)) return []
    // Return unconsumed messages for this user
    return parsed.filter(
      (msg) => msg.userId === userId && !msg.consumed
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
  await ensureDataFile()

  const message: PendingNovaChatMessage = {
    id: crypto.randomUUID(),
    userId: input.userId,
    title: input.title,
    content: input.content,
    missionId: input.missionId,
    missionLabel: input.missionLabel,
    createdAt: new Date().toISOString(),
    consumed: false,
  }

  await withLockedStoreWrite((messages) => {
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
  await withLockedStoreWrite((messages) =>
    messages.map((msg) =>
      msg.id === messageId ? { ...msg, consumed: true } : msg
    )
  )
}

/**
 * Mark multiple messages as consumed.
 */
export async function markMessagesConsumed(messageIds: string[]): Promise<void> {
  const idSet = new Set(messageIds.map((id) => String(id || "").trim()).filter(Boolean))
  if (idSet.size === 0) return
  await withLockedStoreWrite((messages) =>
    messages.map((msg) =>
      idSet.has(msg.id) ? { ...msg, consumed: true } : msg
    )
  )
}

/**
 * Mark multiple messages as consumed for a specific user.
 */
export async function markMessagesConsumedForUser(userId: string, messageIds: string[]): Promise<void> {
  const scopedUserId = String(userId || "").trim()
  if (!scopedUserId) return
  const idSet = new Set(messageIds.map((id) => String(id || "").trim()).filter(Boolean))
  if (idSet.size === 0) return
  await withLockedStoreWrite((messages) =>
    messages.map((msg) =>
      msg.userId === scopedUserId && idSet.has(msg.id)
        ? { ...msg, consumed: true }
        : msg
    )
  )
}
