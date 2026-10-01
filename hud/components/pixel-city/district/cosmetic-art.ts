import { useEffect, useSyncExternalStore } from "react"

/**
 * Cosmetic sheets (`/pixel-city/town/cosmetics/<id>.png`, same grid as the character sheets): loaded on demand and
 * remembered. A sheet that fails to load is cached as "missing" so it is never requested again (the renderer is asked
 * for it every frame); everything that wears or shows a cosmetic falls back to the default look until its art exists.
 */

export type CosmeticStatus = "loading" | "ready" | "missing"

const COSMETIC_BASE = "/pixel-city/town/cosmetics"

interface Entry {
  status: CosmeticStatus
  image: HTMLImageElement | null
}

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
/** Bumps whenever any entry settles, so React consumers re-read. */
let version = 0

export function cosmeticUrl(id: string): string {
  return `${COSMETIC_BASE}/${encodeURIComponent(id)}.png`
}

function settle(id: string, entry: Entry): void {
  entries.set(id, entry)
  version++
  for (const listener of listeners) listener()
}

/** Starts loading a cosmetic's sheet once. Safe to call every frame. */
export function ensureCosmetic(id: string): void {
  if (typeof document === "undefined" || entries.has(id)) return
  entries.set(id, { status: "loading", image: null })
  const image = new Image()
  image.decoding = "async"
  image.onload = () => settle(id, { status: "ready", image })
  image.onerror = () => settle(id, { status: "missing", image: null })
  image.src = cosmeticUrl(id)
}

/** The loaded sheet, or null while it loads / when the art does not exist. Starts the load on first ask. */
export function cosmeticImage(id: string): HTMLImageElement | null {
  ensureCosmetic(id)
  return entries.get(id)?.image ?? null
}

export function cosmeticStatus(id: string): CosmeticStatus | "idle" {
  return entries.get(id)?.status ?? "idle"
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Status of one cosmetic's art for React, loading it on first use. `undefined` id = nothing equipped. */
export function useCosmeticStatus(id: string | undefined): CosmeticStatus | "none" {
  useSyncExternalStore(subscribe, () => version, () => 0)
  useEffect(() => {
    if (id) ensureCosmetic(id)
  }, [id])
  if (!id) return "none"
  return entries.get(id)?.status ?? "loading"
}
