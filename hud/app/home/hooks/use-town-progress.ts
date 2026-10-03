"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { systemTimeZone } from "@/lib/analytics/time-zone"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import type { TownAckRequest, TownProgress } from "@/lib/town/types"

export interface TownProgressState {
  progress: TownProgress | null
  /** True until the first request settles (success or failure). */
  loading: boolean
  /** Last refresh error; `progress` keeps the last good data when this is set. */
  error: string | null
  /** Refetch now (also restarts the poll countdown). */
  refresh: () => void
  /**
   * POST /api/town/ack, then refetch. Acked event ids and tutorial changes are applied to the local copy at once so
   * the UI does not wait on the round trip; the refetch brings the server's view back. Resolves false on failure.
   */
  ack: (request: TownAckRequest) => Promise<boolean>
}

const TOWN_ENDPOINT = "/api/town"
const TOWN_ACK_ENDPOINT = "/api/town/ack"
const POLL_INTERVAL_MS = 15_000

function isTownProgress(value: unknown): value is TownProgress {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<TownProgress>
  return (
    !!candidate.level &&
    typeof candidate.level === "object" &&
    Array.isArray(candidate.quests) &&
    Array.isArray(candidate.sources) &&
    Array.isArray(candidate.buildings) &&
    Array.isArray(candidate.pendingEvents) &&
    !!candidate.tutorial &&
    typeof candidate.tutorial === "object"
  )
}

/** Accepts the bare `TownProgress` body or an `{ ok, progress }` envelope. */
function readProgress(body: unknown): TownProgress | null {
  if (isTownProgress(body)) return body
  if (body && typeof body === "object" && "progress" in body) {
    const inner = (body as { progress: unknown }).progress
    if (isTownProgress(inner)) return inner
  }
  return null
}

function readError(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === "string" && error.trim()) return error
  }
  return null
}

function applyAckLocally(progress: TownProgress, request: TownAckRequest): TownProgress {
  let next = progress
  if (request.eventIds?.length) {
    const acked = new Set(request.eventIds)
    next = { ...next, pendingEvents: next.pendingEvents.filter((event) => !acked.has(event.id)) }
  }
  if (request.tutorial === "skip") next = { ...next, tutorial: { ...next.tutorial, active: false, skipped: true } }
  else if (request.tutorial === "finish") next = { ...next, tutorial: { ...next.tutorial, active: false } }
  return next
}

/**
 * U.B Agents City progression (level, XP, quests, tutorial, celebrations) from GET /api/town?tz=<viewer zone>. Polls every 15 s while the
 * page is visible, refetches when the window regains focus or the tab becomes visible, and resets on a user switch.
 */
export function useTownProgress(): TownProgressState {
  const [state, setState] = useState<Omit<TownProgressState, "refresh" | "ack">>({ progress: null, loading: true, error: null })
  const refreshRef = useRef<() => void>(() => {})

  useEffect(() => {
    let disposed = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight: AbortController | null = null

    const load = async () => {
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller
      try {
        // The viewer's zone decides when daily quests roll over.
        const url = `${TOWN_ENDPOINT}?tz=${encodeURIComponent(systemTimeZone())}`
        const res = await fetch(url, { method: "GET", cache: "no-store", credentials: "include", signal: controller.signal })
        const body: unknown = await res.json().catch(() => null)
        if (disposed || controller.signal.aborted) return
        if (res.status === 404 && !readProgress(body)) throw new Error("Town progress is not available in this build yet.")
        const progress = res.ok ? readProgress(body) : null
        if (!progress) throw new Error(readError(body) || `Town progress request failed (${res.status}).`)
        setState({ progress, loading: false, error: null })
      } catch (err) {
        if (disposed || controller.signal.aborted) return
        const message = err instanceof Error ? err.message : "Town progress unavailable."
        setState((prev) => ({ progress: prev.progress, loading: false, error: message }))
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
      setState({ progress: null, loading: true, error: null })
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

  const ack = useCallback(async (request: TownAckRequest): Promise<boolean> => {
    setState((prev) => (prev.progress ? { ...prev, progress: applyAckLocally(prev.progress, request) } : prev))
    try {
      const res = await fetch(TOWN_ACK_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      })
      return res.ok
    } catch {
      return false
    } finally {
      refreshRef.current()
    }
  }, [])

  return useMemo(() => ({ ...state, refresh, ack }), [state, refresh, ack])
}
