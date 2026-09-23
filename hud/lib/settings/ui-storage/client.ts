// Browser side of the settings mirror (see keys.ts for why it exists). localStorage stays the fast,
// synchronous cache every component already reads; nova.db (via /api/ui-storage) is the source of truth.
//
//  - persistUiStorageKey(): call after every localStorage write/remove of a synced key. The edit is queued
//    in a DURABLE pending queue (its own localStorage key, never synced) with a timestamp, then sent.
//  - hydrateUiStorage(): once at startup, before the app reads any setting. Edits that never reached the
//    server (offline, window closed mid-flight) are newer than the server copy and win: they are kept and
//    pushed, deletes included. Every other key takes the server value. See merge.ts for the rules.
import { isSyncedKey, MAX_ITEMS_PER_REQUEST } from "./keys"
import {
  PENDING_QUEUE_STORAGE_KEY,
  parsePendingQueue,
  planHydration,
  serializePendingQueue,
  type PendingEdit,
  type PendingQueue,
  type ServerItemInfo,
} from "./merge"

const ENDPOINT = "/api/ui-storage"
const WRITE_DEBOUNCE_MS = 250
// fetch(keepalive) bodies are capped at 64 KB by browsers; larger flushes use a normal request. A large
// edit that misses the unload flush is still safe: it stays in the durable queue and is sent next launch.
const KEEPALIVE_MAX_CHARS = 60_000

// In-memory mirror of the queue plus the last value per key, used when localStorage is unavailable or full.
const memoryQueue: PendingQueue = {}
const memoryValues = new Map<string, string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushChain: Promise<void> = Promise.resolve()
let lifecycleHooked = false

function readDurableQueue(): PendingQueue {
  try {
    return parsePendingQueue(localStorage.getItem(PENDING_QUEUE_STORAGE_KEY))
  } catch {
    return {}
  }
}

function writeDurableQueue(queue: PendingQueue): void {
  try {
    if (Object.keys(queue).length === 0) localStorage.removeItem(PENDING_QUEUE_STORAGE_KEY)
    else localStorage.setItem(PENDING_QUEUE_STORAGE_KEY, serializePendingQueue(queue))
  } catch {
    // Storage full or blocked: the in-memory mirror still covers this session.
  }
}

/** Durable queue (shared by all windows) merged with this window's mirror; the newest edit per key wins. */
function readQueue(): PendingQueue {
  const merged: PendingQueue = { ...readDurableQueue() }
  for (const [key, edit] of Object.entries(memoryQueue)) {
    if (!merged[key] || merged[key].updatedAt < edit.updatedAt) merged[key] = edit
  }
  return merged
}

function enqueue(key: string, edit: PendingEdit): void {
  memoryQueue[key] = edit
  const durable = readDurableQueue()
  durable[key] = edit
  writeDurableQueue(durable)
}

/** Remove entries that were acknowledged, unless a newer edit replaced them in the meantime. */
function settle(sent: PendingQueue): void {
  const durable = readDurableQueue()
  for (const [key, edit] of Object.entries(sent)) {
    if (durable[key]?.updatedAt === edit.updatedAt) delete durable[key]
    if (memoryQueue[key]?.updatedAt === edit.updatedAt) {
      delete memoryQueue[key]
      memoryValues.delete(key)
    }
  }
  writeDurableQueue(durable)
}

function currentValue(key: string, deleted: boolean): string | null {
  if (deleted) return null
  const remembered = memoryValues.get(key)
  if (remembered !== undefined) return remembered
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

async function sendItems(items: Record<string, string | null>, keepalive: boolean): Promise<boolean> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
      credentials: "include",
      keepalive,
    })
    return res.ok
  } catch {
    return false
  }
}

async function flushOnce(options: { unloading?: boolean }): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const entries: Array<[string, PendingEdit, string | null]> = []
  for (const [key, edit] of Object.entries(readQueue())) {
    const value = currentValue(key, edit.deleted)
    if (!edit.deleted && value === null) {
      settle({ [key]: edit }) // nothing left to send
      continue
    }
    entries.push([key, edit, value])
  }

  for (let i = 0; i < entries.length; i += MAX_ITEMS_PER_REQUEST) {
    const slice = entries.slice(i, i + MAX_ITEMS_PER_REQUEST)
    const batch = Object.fromEntries(slice.map(([key, , value]) => [key, value]))
    const keepalive = Boolean(options.unloading) && JSON.stringify(batch).length <= KEEPALIVE_MAX_CHARS
    const ok = await sendItems(batch, keepalive)
    // On failure the entries simply stay queued (durably) for the next flush or launch.
    if (ok) settle(Object.fromEntries(slice.map(([key, edit]) => [key, edit])))
  }
}

/** Sends everything queued. Calls are serialised so two flushes never race on the same queue. */
export function flushUiStorage(options: { unloading?: boolean } = {}): Promise<void> {
  flushChain = flushChain.then(() => flushOnce(options)).catch(() => {})
  return flushChain
}

function hookLifecycle(): void {
  if (lifecycleHooked || typeof window === "undefined") return
  lifecycleHooked = true
  window.addEventListener("pagehide", () => void flushUiStorage({ unloading: true }))
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushUiStorage({ unloading: true })
  })
}

/** Queue a mirrored write (string) or delete (null) for a synced key. No-op for keys that are not synced. */
export function persistUiStorageKey(key: string, value: string | null): void {
  if (typeof window === "undefined" || !isSyncedKey(key)) return
  hookLifecycle()
  if (value === null) memoryValues.delete(key)
  else memoryValues.set(key, value)
  enqueue(key, { deleted: value === null, updatedAt: Date.now() })
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flushUiStorage(), WRITE_DEBOUNCE_MS)
}

function localSyncedValues(): Record<string, string> {
  const values: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !isSyncedKey(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) values[key] = value
  }
  return values
}

/**
 * Reconcile localStorage with the server copy, then push whatever is newer locally. Resolves (never
 * rejects) so a slow or unreachable server can never block the app: it simply falls back to the cache,
 * and unsent edits stay queued for the next attempt.
 */
export async function hydrateUiStorage(timeoutMs = 2500): Promise<void> {
  if (typeof window === "undefined") return
  hookLifecycle()
  try {
    const res = await fetch(ENDPOINT, {
      cache: "no-store",
      credentials: "include",
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return
    const data = (await res.json()) as { ok?: boolean; items?: Record<string, { value?: unknown; updatedAt?: unknown }> }
    if (!data?.ok || !data.items) return

    const server: Record<string, ServerItemInfo> = {}
    for (const [key, item] of Object.entries(data.items)) {
      if (!isSyncedKey(key) || typeof item?.value !== "string") continue
      server[key] = { value: item.value, updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "" }
    }

    const pending = readQueue()
    const plan = planHydration(server, pending, localSyncedValues())

    for (const [key, value] of Object.entries(plan.applyServer)) {
      if (localStorage.getItem(key) !== value) localStorage.setItem(key, value)
    }
    for (const key of plan.removeLocal) localStorage.removeItem(key)

    const durable = readDurableQueue()
    for (const key of plan.dropPending) {
      delete durable[key]
      delete memoryQueue[key]
      memoryValues.delete(key)
    }
    const now = Date.now()
    for (const [key, value] of Object.entries(plan.push)) {
      const edit = pending[key] ?? { deleted: value === null, updatedAt: now }
      memoryQueue[key] = edit
      durable[key] = edit
      if (value !== null) memoryValues.set(key, value)
    }
    writeDurableQueue(durable)

    // Not awaited: startup must stay bounded by the timeout above, not by the upload.
    if (Object.keys(plan.push).length > 0) void flushUiStorage()
  } catch {
    // Server unavailable or timed out: keep using the browser cache; queued edits stay durable.
  }
}
