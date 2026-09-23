// Browser-storage keys that are mirrored into nova.db (kv_state, namespace "ui-storage").
//
// Why: localStorage belongs to the window's origin, and the packaged app's origin (port) is not guaranteed
// to be the same forever. Anything a user sets (name, photo, personalization, preferences) must survive
// closes, updates and origin changes, so the database is the source of truth and localStorage is only a
// fast cache in front of it. Add a prefix here when a new small, user-authored setting is stored in
// localStorage. Do not add caches (they are rebuilt from the server) or secrets (they never belong in
// browser storage).
//
// Shared by the server store and the browser client: keep this file free of server-only and DOM imports.

export const UI_STORAGE_NAMESPACE = "ui-storage"

export const SYNCED_KEY_PREFIXES = [
  "nova_user_settings", // profile, app/theme, notifications, personalization (per active user)
  "nova_calendar_categories", // custom calendar categories
  "nova_home_", // home screen preferences (crypto range, YouTube history, manual video)
] as const

/** One value is capped so a runaway write cannot bloat the database (profile photos are the largest legitimate value). */
export const MAX_SYNCED_VALUE_CHARS = 8_000_000
export const MAX_SYNCED_KEY_CHARS = 200
export const MAX_ITEMS_PER_REQUEST = 100

export function isSyncedKey(key: unknown): boolean {
  if (typeof key !== "string") return false
  if (key.length === 0 || key.length > MAX_SYNCED_KEY_CHARS) return false
  return SYNCED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}
