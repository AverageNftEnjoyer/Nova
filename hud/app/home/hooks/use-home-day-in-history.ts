"use client"

import { useCallback, useEffect, useLayoutEffect, useState } from "react"

export interface DayInHistoryEvent {
  year: number
  month: number
  day: number
  event: string
}

const STORAGE_KEY = "nova-day-in-history"

interface StoredCache {
  date: string
  events: DayInHistoryEvent[]
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function readCache(): StoredCache | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCache
    if (parsed.date === todayKey() && Array.isArray(parsed.events) && parsed.events.length > 0) {
      return parsed
    }
  } catch { /* ignore */ }
  return null
}

function writeCache(events: DayInHistoryEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayKey(), events }))
  } catch { /* ignore */ }
}

export function useHomeDayInHistory() {
  const [events, setEvents] = useState<DayInHistoryEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Hydrate from localStorage synchronously — no flash, no API call needed
  useLayoutEffect(() => {
    const cached = readCache()
    if (cached) {
      setEvents(cached.events)
      setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    // Skip API call if we already have today's data
    const cached = readCache()
    if (cached) {
      setEvents(cached.events)
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/day-in-history", {
        cache: "no-store",
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to fetch")
        return
      }
      const fetched = Array.isArray(data.events) ? data.events : []
      setEvents(fetched)
      if (fetched.length > 0) writeCache(fetched)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Only fetch if localStorage didn't have today's data
    const cached = readCache()
    if (!cached) void refresh()
  }, [refresh])

  return { events, loading, error, refresh }
}
