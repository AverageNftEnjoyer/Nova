"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import type { DevLogsResponse, DevLogTurn } from "../types"

const POLL_MS = 3000

export function useDevLogsData() {
  const [data, setData] = useState<DevLogsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedTurnId, setSelectedTurnId] = useState("")

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/dev-logs?limit=240", { cache: "no-store" })
      const payload = (await res.json().catch(() => ({}))) as Partial<DevLogsResponse> & { error?: string }
      if (!res.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "Failed to load dev logs."))
      }
      const typed = payload as DevLogsResponse
      setData(typed)
      setSelectedTurnId((prev) => {
        if (prev && typed.turns.some((turn) => turn.turnId === prev)) return prev
        return String(typed.turns[0]?.turnId || "")
      })
    } catch (fetchError) {
      setData(null)
      setSelectedTurnId("")
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load dev logs.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(false)
    const timer = window.setInterval(() => {
      fetchData(true)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [fetchData])

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
