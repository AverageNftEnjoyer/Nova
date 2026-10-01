"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import type { TownWardrobe, WardrobeUpdateRequest } from "@/lib/town/wardrobe-types"

export type WardrobeUpdateResult = { ok: true } | { ok: false; error: string }

export interface TownWardrobeState {
  wardrobe: TownWardrobe | null
  /** True until the first request settles (success or failure). */
  loading: boolean
  /** Last refresh error; `wardrobe` keeps the last good data when this is set. */
  error: string | null
  /** Refetch now (also restarts the poll countdown). */
  refresh: () => void
  /**
   * POST /api/town/wardrobe. What the server answers (the whole updated wardrobe) replaces the local copy; nothing is
   * applied before it does, so the city and the resident card always show what is saved.
   */
  update: (request: WardrobeUpdateRequest) => Promise<WardrobeUpdateResult>
}

const WARDROBE_ENDPOINT = "/api/town/wardrobe"
/** Slower than the town's own poll: unlocks also reach Home as `item-unlock` events through that poll. */
const POLL_INTERVAL_MS = 30_000

function isTownWardrobe(value: unknown): value is TownWardrobe {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<TownWardrobe>
  return Array.isArray(candidate.items) && !!candidate.residents && typeof candidate.residents === "object" && !Array.isArray(candidate.residents)
}

function readError(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === "string" && error.trim()) return error
  }
  return null
}

/**
 * Nova City's wardrobe (every cosmetic with its unlock state, and each resident's name and outfit) from
 * GET /api/town/wardrobe. Call it once per screen and hand the result down, so the scene and the resident card share
 * one copy. Polls every 30 s while the page is visible, refetches on focus / visibility, and resets on a user switch.
 */
export function useTownWardrobe(): TownWardrobeState {
  const [state, setState] = useState<Omit<TownWardrobeState, "refresh" | "update">>({ wardrobe: null, loading: true, error: null })
  const refreshRef = useRef<() => void>(() => {})
  /** Bumped by every saved update: a GET that started before it is stale and must not overwrite the saved copy. */
  const savedRef = useRef(0)

  useEffect(() => {
    let disposed = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight: AbortController | null = null

    const load = async () => {
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller
      const savedAtStart = savedRef.current
      try {
        const res = await fetch(WARDROBE_ENDPOINT, { method: "GET", cache: "no-store", credentials: "include", signal: controller.signal })
        const body: unknown = await res.json().catch(() => null)
        if (disposed || controller.signal.aborted || savedRef.current !== savedAtStart) return
        if (!res.ok || !isTownWardrobe(body)) throw new Error(readError(body) || `Wardrobe request failed (${res.status}).`)
        setState({ wardrobe: body, loading: false, error: null })
      } catch (err) {
        if (disposed || controller.signal.aborted) return
        const message = err instanceof Error ? err.message : "Wardrobe unavailable."
        setState((prev) => ({ wardrobe: prev.wardrobe, loading: false, error: message }))
      } finally {
        if (inFlight === controller) inFlight = null
      }
    }

    const schedule = () => {
      if (pollTimer) clearTimeout(pollTimer)
      pollTimer = setTimeout(async () => {
        if (disposed) return
        if (document.visibilityState === "visible") await load()
        if (!disposed) schedule()
      }, POLL_INTERVAL_MS)
    }

    const refreshNow = () => {
      if (disposed) return
      void load()
      schedule()
    }
    refreshRef.current = refreshNow

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshNow()
    }
    const onActiveUserChanged = () => {
      setState({ wardrobe: null, loading: true, error: null })
      refreshNow()
    }

    refreshNow()
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("focus", refreshNow)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, onActiveUserChanged)
    return () => {
      disposed = true
      refreshRef.current = () => {}
      if (pollTimer) clearTimeout(pollTimer)
      inFlight?.abort()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("focus", refreshNow)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, onActiveUserChanged)
    }
  }, [])

  const refresh = useCallback(() => refreshRef.current(), [])

  const update = useCallback(async (request: WardrobeUpdateRequest): Promise<WardrobeUpdateResult> => {
    try {
      const res = await fetch(WARDROBE_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      })
      const body: unknown = await res.json().catch(() => null)
      if (!res.ok || !isTownWardrobe(body)) return { ok: false, error: readError(body) || `Could not save (${res.status}).` }
      savedRef.current++
      setState({ wardrobe: body, loading: false, error: null })
      return { ok: true }
    } catch {
      return { ok: false, error: "Could not reach Nova to save. Try again." }
    }
  }, [])

  return useMemo(() => ({ ...state, refresh, update }), [state, refresh, update])
}
