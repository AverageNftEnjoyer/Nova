"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { usePageActive } from "@/lib/hooks/use-page-active"

import type { DevLogsResponse, DevLogTurn } from "../types"

// The route tails + parses the conversation log on every full response; poll slowly and rely
// on ETag/304 so an unchanged log costs a stat() instead of a multi-MB read.
export const DEV_LOGS_POLL_MS = 15_000

export function useDevLogsData() {
  const [data, setData] = useState<DevLogsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedTurnId, setSelectedTurnId] = useState("")
  const pageActive = usePageActive()
  const etagRef = useRef<string | null>(null)

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const headers: Record<string, string> = {}
      if (etagRef.current) headers["If-None-Match"] = etagRef.current
      const res = await fetch("/api/dev-logs?limit=240", { cache: "no-store", headers })
      if (res.status === 304) {
        // Log unchanged since the last full response: keep current state, skip parse/render.
        setError((prev) => (prev ? "" : prev))
        return
      }
      const payload = (await res.json()) as Partial<DevLogsResponse> & { error?: string }
      if (!res.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "Failed to load dev logs."))
      }
      const typed = payload as DevLogsResponse
      etagRef.current = res.headers.get("ETag")
      setError("")
      setData(typed)
      setSelectedTurnId((prev) => {
        if (prev && typed.turns.some((turn) => turn.turnId === prev)) return prev
        return String(typed.turns[0]?.turnId || "")
      })
    } catch (fetchError) {
      etagRef.current = null
      setData(null)
      setSelectedTurnId("")
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load dev logs.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  // Initial load (always, even if the page is momentarily unfocused).
  useEffect(() => {
    void fetchData(false)
  }, [fetchData])

  // Poll only while the page is active (visible + focused); refresh once on return.
  const wasActiveRef = useRef(pageActive)
  useEffect(() => {
    if (!pageActive) {
      wasActiveRef.current = false
      return
    }
    if (!wasActiveRef.current) {
      wasActiveRef.current = true
      void fetchData(true)
    }
    const timer = window.setInterval(() => {
      void fetchData(true)
    }, DEV_LOGS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [fetchData, pageActive])

  const selectedTurn = useMemo<DevLogTurn | null>(() => {
    if (!data?.turns?.length) return null
    return data.turns.find((turn) => turn.turnId === selectedTurnId) || data.turns[0] || null
  }, [data, selectedTurnId])

  return {
    data,
    loading,
    error,
    selectedTurn,
    selectedTurnId,
    setSelectedTurnId,
    refresh: () => fetchData(false),
  }
}
