// Pure, dependency-free logic behind the browser client (client.ts): the durable pending-edit queue format
// and the hydrate merge. Kept import-free so the smoke test can load it directly.
//
// A "pending edit" is a local change (write or delete) that the server has not acknowledged yet. The value
// itself is not stored in the queue: for a write it is whatever localStorage currently holds for the key.

export interface PendingEdit {
  /** true = the key was removed locally (a delete must not be resurrected by the server copy). */
  deleted: boolean
  /** Epoch ms of the local edit. */
  updatedAt: number
}

export type PendingQueue = Record<string, PendingEdit>

/** localStorage key of the durable queue. It must never match a synced prefix (it is not mirrored itself). */
export const PENDING_QUEUE_STORAGE_KEY = "nova_ui_storage_pending_v1"

export function parsePendingQueue(raw: string | null): PendingQueue {
  const queue: PendingQueue = {}
  if (!raw) return queue
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return queue
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const e = entry as { deleted?: unknown; updatedAt?: unknown } | null
      if (e && typeof e.deleted === "boolean" && typeof e.updatedAt === "number" && Number.isFinite(e.updatedAt)) {
        queue[key] = { deleted: e.deleted, updatedAt: e.updatedAt }
      }
    }
  } catch {
    // corrupt queue: treat as empty
  }
  return queue
}

export function serializePendingQueue(queue: PendingQueue): string {
  return JSON.stringify(queue)
}

export interface ServerItemInfo {
  value: string
  /** ISO timestamp from the server. */
  updatedAt: string
}

export interface HydrationPlan {
  /** Keys whose localStorage value must be set to the server copy. */
  applyServer: Record<string, string>
  /** Keys whose local edit is kept and must be pushed (string = write, null = delete). */
  push: Record<string, string | null>
  /** Keys to remove from localStorage (pending local deletes that stay deleted). */
  removeLocal: string[]
  /** Pending edits that lost to a newer server copy or are otherwise obsolete: drop from the queue. */
  dropPending: string[]
}

/**
 * Decide what hydrate does per key.
 *  - pending local edit newer than the server copy -> local wins and is pushed (deletes stay deleted);
 *  - pending edit not newer than the server copy    -> server wins, pending dropped;
 *  - no pending edit                                -> server wins; keys only present locally are uploaded.
 * `localValues` maps every synced key currently in localStorage to its value.
 */
export function planHydration(
  server: Record<string, ServerItemInfo>,
  pending: PendingQueue,
  localValues: Record<string, string>,
): HydrationPlan {
  const plan: HydrationPlan = { applyServer: {}, push: {}, removeLocal: [], dropPending: [] }

  for (const [key, item] of Object.entries(server)) {
    const edit = pending[key]
    const serverTime = Date.parse(item.updatedAt)
    const localWins = edit !== undefined && (!Number.isFinite(serverTime) || edit.updatedAt > serverTime)
    if (edit && localWins) {
      if (edit.deleted) {
        plan.push[key] = null
        plan.removeLocal.push(key)
      } else if (typeof localValues[key] === "string") {
        plan.push[key] = localValues[key]
      } else {
        plan.dropPending.push(key)
        plan.applyServer[key] = item.value
      }
    } else {
      if (edit) plan.dropPending.push(key)
      plan.applyServer[key] = item.value
    }
  }

  for (const [key, edit] of Object.entries(pending)) {
    if (key in server) continue
    if (edit.deleted) {
      plan.removeLocal.push(key)
      plan.dropPending.push(key)
    } else if (typeof localValues[key] === "string") {
      plan.push[key] = localValues[key]
    } else {
      plan.dropPending.push(key)
    }
  }

  // Legacy: a key that exists only in this browser (saved before the mirror existed) is uploaded.
  for (const [key, value] of Object.entries(localValues)) {
    if (key in server || key in pending) continue
    plan.push[key] = value
  }
  return plan
}
