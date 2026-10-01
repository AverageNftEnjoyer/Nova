"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import type { ResidentNames, ResidentRenameRequest } from "@/lib/town/residents"

export type ResidentRenameResult = { ok: true } | { ok: false; error: string }

const NO_NAMES: Readonly<ResidentNames> = Object.freeze({})

export interface TownResidentsState {
  /** Resident id -> the name the user chose; residents without an entry use their default name. */
  names: Readonly<ResidentNames>
  /** True until the first request settles (success or failure). */
  loading: boolean
  /** Last refresh error; `names` keeps the last good data when this is set. */
  error: string | null
  /** Refetch now (also restarts the poll countdown). */
  refresh: () => void
  /**
   * POST /api/town/residents. What the server answers (all names) replaces the local copy; nothing is applied before it
   * does, so the city and the resident card always show what is saved. `name: null` restores the default name.
   */
  rename: (request: ResidentRenameRequest) => Promise<ResidentRenameResult>
}

const RESIDENTS_ENDPOINT = "/api/town/residents"
const POLL_INTERVAL_MS = 30_000

function readNames(value: unknown): ResidentNames | null {
  if (!value || typeof value !== "object" || !("names" in value)) return null
  const names = (value as { names: unknown }).names
  if (!names || typeof names !== "object" || Array.isArray(names)) return null
  const out: ResidentNames = {}
  for (const [id, name] of Object.entries(names)) if (typeof name === "string") out[id] = name
  return out
}

function readError(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === "string" && error.trim()) return error
  }
  return null
}

/**
 * The names the user gave Nova City's residents, from GET /api/town/residents. Call it once per screen and hand the
 * result down, so the scene and the resident card share one copy. Polls every 30 s while the page is visible,
 * refetches on focus / visibility, and resets on a user switch.
 */
export function useTownResidents(): TownResidentsState {
  const [state, setState] = useState<Omit<TownResidentsState, "refresh" | "rename">>({ names: NO_NAMES, loading: true, error: null })
  const refreshRef = useRef<() => void>(() => {})
  /** Bumped by every saved rename: a GET that started before it is stale and must not overwrite the saved copy. */
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
        const res = await fetch(RESIDENTS_ENDPOINT, { method: "GET", cache: "no-store", credentials: "include", signal: controller.signal })
        const body: unknown = await res.json().catch(() => null)
        if (disposed || controller.signal.aborted || savedRef.current !== savedAtStart) return
        const names = readNames(body)
        if (!res.ok || !names) throw new Error(readError(body) || `Resident names request failed (${res.status}).`)
        setState({ names, loading: false, error: null })
      } catch (err) {
        if (disposed || controller.signal.aborted) return
        const message = err instanceof Error ? err.message : "Resident names unavailable."
        setState((prev) => ({ names: prev.names, loading: false, error: message }))
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
      setState({ names: NO_NAMES, loading: true, error: null })
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

  const rename = useCallback(async (request: ResidentRenameRequest): Promise<ResidentRenameResult> => {
    try {
      const res = await fetch(RESIDENTS_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      })
      const body: unknown = await res.json().catch(() => null)
      const names = readNames(body)
      if (!res.ok || !names) return { ok: false, error: readError(body) || `Could not save (${res.status}).` }
      savedRef.current++
      setState({ names, loading: false, error: null })
      return { ok: true }
    } catch {
      return { ok: false, error: "Could not reach Nova to save. Try again." }
    }
  }, [])

  return useMemo(() => ({ ...state, refresh, rename }), [state, refresh, rename])
}
