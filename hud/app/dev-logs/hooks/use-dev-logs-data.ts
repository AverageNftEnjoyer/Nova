"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { usePageActive } from "@/lib/hooks/use-page-active"

import type { DevLogsResponse } from "../types"

// The route tails + parses the conversation log on every full response; poll slowly and rely
// on ETag/304 so an unchanged log costs a stat() instead of a multi-MB read.
export const DEV_LOGS_POLL_MS = 15_000

export function useDevLogsData(autoRefresh: boolean) {
  const [data, setData] = useState<DevLogsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState("")
  const pageActive = usePageActive()
  const etagRef = useRef<string | null>(null)

  const fetchData = useCallback(async (silent: boolean, force = false) => {
    if (!silent) setRefreshing(true)
    try {
      const headers: Record<string, string> = {}
      if (etagRef.current && !force) headers["If-None-Match"] = etagRef.current
      const res = await fetch("/api/dev-logs?limit=240", { cache: "no-store", headers })
      if (res.status === 304) {
        // Log unchanged since the last full response: keep current state, skip parse/render.
        setError("")
        return
      }
      const payload = (await res.json()) as Partial<DevLogsResponse> & { error?: string }
      if (!res.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "Failed to load dev logs."))
      }
      etagRef.current = res.headers.get("ETag")
      setError("")
      setData(payload as DevLogsResponse)
    } catch (fetchError) {
      etagRef.current = null
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load dev logs.")
    } finally {
      setLoading(false)
      if (!silent) setRefreshing(false)
    }
  }, [])

  // Initial load (always, even if the page is momentarily unfocused).
  useEffect(() => {
    void fetchData(false)
  }, [fetchData])

  // Poll only while auto refresh is on and the page is active (visible + focused); refresh once on return.
  const wasActiveRef = useRef(pageActive)
  useEffect(() => {
    if (!autoRefresh || !pageActive) {
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
  }, [autoRefresh, fetchData, pageActive])

  return {
    data,
    loading,
    refreshing,
    error,
    refresh: () => fetchData(false, true),
  }
}
