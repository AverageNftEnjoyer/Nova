// Server-side only (imports the SQLite layer). Kept free of `server-only` so plain-Node smokes can import it.
import { kvDelete, kvList, kvSet } from "../../../../src/db/index.js"
import {
  isSyncedKey,
  MAX_ITEMS_PER_REQUEST,
  MAX_SYNCED_VALUE_CHARS,
  UI_STORAGE_NAMESPACE,
} from "./keys"

export interface UiStorageItem {
  value: string
  updatedAt: string
}

export class UiStorageValidationError extends Error {}

function normalizeUserId(userId: string): string {
  const uid = String(userId || "").trim()
  if (!uid) throw new UiStorageValidationError("A user id is required.")
  return uid
}

export function listUiStorage(userId: string): Record<string, UiStorageItem> {
  const items: Record<string, UiStorageItem> = {}
  for (const row of kvList(normalizeUserId(userId), UI_STORAGE_NAMESPACE)) {
    const stored = row.value as { value?: unknown } | null
    if (!isSyncedKey(row.key) || typeof stored?.value !== "string") continue
    items[row.key] = { value: stored.value, updatedAt: row.updatedAt }
  }
  return items
}

/** Applies a batch of writes (string value) and deletes (null). Validates everything before writing anything. */
export function writeUiStorage(userId: string, items: Record<string, string | null>): { written: number; deleted: number } {
  const uid = normalizeUserId(userId)
  const entries = Object.entries(items)
  if (entries.length === 0) return { written: 0, deleted: 0 }
  if (entries.length > MAX_ITEMS_PER_REQUEST) {
    throw new UiStorageValidationError(`At most ${MAX_ITEMS_PER_REQUEST} items per request.`)
  }
  for (const [key, value] of entries) {
    if (!isSyncedKey(key)) throw new UiStorageValidationError(`Key is not a synced setting: ${key.slice(0, 60)}`)
    if (value !== null && typeof value !== "string") throw new UiStorageValidationError(`Value for ${key} must be a string or null.`)
    if (typeof value === "string" && value.length > MAX_SYNCED_VALUE_CHARS) {
      throw new UiStorageValidationError(`Value for ${key} is too large.`)
    }
  }

  let written = 0
  let deleted = 0
  for (const [key, value] of entries) {
    if (value === null) {
      if (kvDelete(uid, UI_STORAGE_NAMESPACE, key)) deleted += 1
    } else {
      kvSet(uid, UI_STORAGE_NAMESPACE, key, { value })
      written += 1
    }
  }
  return { written, deleted }
}
