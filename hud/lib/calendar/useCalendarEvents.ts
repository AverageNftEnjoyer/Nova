"use client"

import { useState, useEffect, useCallback } from "react"
import type { CalendarEvent } from "./types"

interface UseCalendarEventsResult {
  events: CalendarEvent[]
  loading: boolean
  error: string | null
  refetch: () => void
  reschedule: (missionId: string, newStartAt: string) => Promise<{ ok: boolean; conflict: boolean; error?: string }>
  removeOverride: (missionId: string) => Promise<{ ok: boolean; error?: string }>
}

export function useCalendarEvents(rangeStart: Date, rangeEnd: Date): UseCalendarEventsResult {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      start: rangeStart.toISOString(),
      end: rangeEnd.toISOString(),
    })

    fetch(`/api/calendar/events?${params}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.ok) {
          setEvents(data.events ?? [])
        } else {
          setError(data.error ?? "Failed to load events.")
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Network error.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart.toISOString(), rangeEnd.toISOString(), tick])

  const reschedule = useCallback(async (
    missionId: string,
    newStartAt: string,
  ): Promise<{ ok: boolean; conflict: boolean; error?: string }> => {
    try {
      const res = await fetch("/api/calendar/reschedule", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ missionId, newStartAt }),
      })
      const data = await res.json()
      if (data.ok) {
        // Refetch so the calendar reflects the new time
        setTick((t) => t + 1)
        return { ok: true, conflict: data.conflict ?? false }
      }
      return { ok: false, conflict: false, error: data.error ?? "Reschedule failed." }
    } catch (err) {
      return { ok: false, conflict: false, error: err instanceof Error ? err.message : "Network error." }
    }
  }, [])

  const removeOverride = useCallback(async (
    missionId: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/calendar/reschedule/${encodeURIComponent(missionId)}`, {
        method: "DELETE",
        credentials: "include",
      })
      const data = await res.json()
      if (data.ok) {
        setTick((t) => t + 1)
        return { ok: true }
      }
      return { ok: false, error: data.error ?? "Remove override failed." }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error." }
    }
  }, [])

  return { events, loading, error, refetch, reschedule, removeOverride }
}
