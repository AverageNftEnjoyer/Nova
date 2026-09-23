// Browser side of the settings mirror (see keys.ts for why it exists). localStorage stays the fast,
// synchronous cache every component already reads; nova.db (via /api/ui-storage) is the source of truth.
//
//  - hydrateUiStorage(): once at startup, before the app reads any setting. The server's copy wins; a key
//    that exists only in this browser (settings saved before the mirror existed) is uploaded instead.
//  - persistUiStorageKey(): call after every localStorage write/remove of a synced key.
import { isSyncedKey, MAX_ITEMS_PER_REQUEST } from "./keys"

const ENDPOINT = "/api/ui-storage"
const WRITE_DEBOUNCE_MS = 250
// fetch(keepalive) bodies are capped at 64 KB by browsers; larger flushes use a normal request.
const KEEPALIVE_MAX_CHARS = 60_000

const pending = new Map<string, string | null>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lifecycleHooked = false

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

async function flushPending(options: { unloading?: boolean } = {}): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pending.size === 0) return

  const entries = [...pending.entries()]
  pending.clear()
  for (let i = 0; i < entries.length; i += MAX_ITEMS_PER_REQUEST) {
    const batch = Object.fromEntries(entries.slice(i, i + MAX_ITEMS_PER_REQUEST))
    const keepalive = Boolean(options.unloading) && JSON.stringify(batch).length <= KEEPALIVE_MAX_CHARS
    const ok = await sendItems(batch, keepalive)
    if (!ok) {
      // Keep the newest local value queued so a later write or the next launch's hydrate can retry.
      for (const [key, value] of Object.entries(batch)) {
        if (!pending.has(key)) pending.set(key, value)
      }
    }
  }
}

function hookLifecycle(): void {
  if (lifecycleHooked || typeof window === "undefined") return
  lifecycleHooked = true
  window.addEventListener("pagehide", () => void flushPending({ unloading: true }))
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushPending({ unloading: true })
  })
}

/** Queue a mirrored write (string) or delete (null) for a synced key. No-op for keys that are not synced. */
export function persistUiStorageKey(key: string, value: string | null): void {
  if (typeof window === "undefined" || !isSyncedKey(key)) return
  hookLifecycle()
  pending.set(key, value)
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flushPending(), WRITE_DEBOUNCE_MS)
}

function localSyncedKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key && isSyncedKey(key)) keys.push(key)
  }
  return keys
}

/**
 * Pull the server copy into localStorage, and upload anything only this browser has. Resolves (never
 * rejects) so a slow or unreachable server can never block the app: it simply falls back to the cache.
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
    const data = (await res.json()) as { ok?: boolean; items?: Record<string, { value?: unknown }> }
    if (!data?.ok || !data.items) return

    const serverKeys = new Set<string>()
    for (const [key, item] of Object.entries(data.items)) {
      if (!isSyncedKey(key) || typeof item?.value !== "string") continue
      serverKeys.add(key)
      if (localStorage.getItem(key) !== item.value) localStorage.setItem(key, item.value)
    }

    const localOnly: Record<string, string | null> = {}
    for (const key of localSyncedKeys()) {
      if (serverKeys.has(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) localOnly[key] = value
    }
    if (Object.keys(localOnly).length > 0) {
      for (const [key, value] of Object.entries(localOnly)) pending.set(key, value)
      await flushPending()
    }
  } catch {
    // Server unavailable or timed out: keep using the browser cache.
  }
}
