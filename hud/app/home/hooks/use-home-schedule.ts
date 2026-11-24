"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import type { CalendarEvent } from "@/lib/calendar/types"

export interface HomeScheduleState {
  /** Events that touch the local today, sorted by start (all-day first). */
  today: CalendarEvent[]
  /** missionId -> ISO start of its next scheduled occurrence within the next 7 days. */
  nextMissionRun: ReadonlyMap<string, string>
  loading: boolean
  error: string | null
  refresh: () => void
}

const REFRESH_MS = 5 * 60_000
const LOOKAHEAD_DAYS = 8

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function sameLocalDay(iso: string, day: Date): boolean {
  const date = new Date(iso)
  return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth() && date.getDate() === day.getDate()
}

/** One calendar read (today through the next week): today's agenda plus each automation's next scheduled run. */
export function useHomeSchedule(): HomeScheduleState {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dayKey, setDayKey] = useState(() => startOfLocalDay(new Date()).getTime())

  const load = useCallback(async () => {
    const start = startOfLocalDay(new Date())
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + LOOKAHEAD_DAYS)
    const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() })
    try {
      const res = await fetch(`/api/calendar/events?${params}`, { cache: "no-store", credentials: "include" })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; events?: unknown; error?: string } | null
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Calendar request failed (${res.status}).`)
      setEvents(Array.isArray(data.events) ? (data.events as CalendarEvent[]) : [])
      setError(null)
      setDayKey(start.getTime())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the schedule.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0)
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, REFRESH_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    const onUser = () => {
      setEvents([])
      setLoading(true)
      void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, onUser)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, onUser)
    }
  }, [load])

  const today = useMemo(() => {
    const day = new Date(dayKey)
    const unique = new Map(events.filter((event) => sameLocalDay(event.startAt, day) || sameLocalDay(event.endAt, day)).map((event) => [event.id, event]))
    return [...unique.values()].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
  }, [events, dayKey])

  const nextMissionRun = useMemo(() => {
    const now = Date.now()
    const next = new Map<string, string>()
    for (const event of events) {
      if (event.kind !== "mission" || event.status !== "scheduled") continue
      if (Date.parse(event.startAt) < now) continue
      const held = next.get(event.missionId)
      if (!held || Date.parse(event.startAt) < Date.parse(held)) next.set(event.missionId, event.startAt)
    }
    return next
  }, [events])

  const refresh = useCallback(() => {
    setLoading(true)
    void load()
  }, [load])

  return { today, nextMissionRun, loading, error, refresh }
}
