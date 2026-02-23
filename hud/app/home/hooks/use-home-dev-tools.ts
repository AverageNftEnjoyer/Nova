"use client"
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react"
import { readShellUiCache, writeShellUiCache, type DevToolsMetricsCacheItem } from "@/lib/settings/shell-ui-cache"

const POLL_MS = 5000

type DevLogTurn = {
  status?: { ok?: boolean } | null
  timing?: { latencyMs?: number } | null
  quality?: { score?: number } | null
  output?: { assistant?: { text?: string } } | null
}

type DevLogsResponse = {
  ok: boolean
  summary?: {
    totalTurns?: number
    totalTokens?: number
    latencyMs?: { average?: number }
    quality?: { average?: number }
  } | null
  turns?: DevLogTurn[]
}

const EMPTY_METRICS: DevToolsMetricsCacheItem = {
  totalTraces: 0,
  totalTokens: 0,
  errors: 0,
  warnings: 0,
  avgLatencyMs: 0,
  avgQuality: 0,
}

function deriveStatus(turn: DevLogTurn): "ok" | "warn" | "error" {
  if (turn.status?.ok === false) return "error"
  const latency = Number(turn.timing?.latencyMs || 0)
  const quality = Number(turn.quality?.score || 0)
  const hasOutput = String(turn.output?.assistant?.text || "").trim().length > 0
  if (!hasOutput || latency >= 4000 || (quality > 0 && quality < 85)) return "warn"
  return "ok"
}

export function useHomeDevTools() {
  const [metrics, setMetrics] = useState<DevToolsMetricsCacheItem>(() => {
    const cached = readShellUiCache().devToolsMetrics
    if (!cached) return EMPTY_METRICS
    return {
      totalTraces: Number(cached.totalTraces || 0),
      totalTokens: Number(cached.totalTokens || 0),
      errors: Number(cached.errors || 0),
      warnings: Number(cached.warnings || 0),
      avgLatencyMs: Number(cached.avgLatencyMs || 0),
      avgQuality: Number(cached.avgQuality || 0),
    }
  })

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dev-logs?limit=120", { cache: "no-store" })
      const payload = (await res.json().catch(() => ({}))) as Partial<DevLogsResponse> & { error?: string }
      if (!res.ok || payload?.ok !== true) return
      const typed = payload as DevLogsResponse
      const turns = Array.isArray(typed?.turns) ? typed.turns : []
      let warningCount = 0
      let errorCount = 0
      for (const turn of turns) {
        const status = deriveStatus(turn)
        if (status === "warn") warningCount += 1
        if (status === "error") errorCount += 1
      }
      const nextMetrics: DevToolsMetricsCacheItem = {
        totalTraces: Number(typed?.summary?.totalTurns || 0),
        totalTokens: Number(typed?.summary?.totalTokens || 0),
        errors: errorCount,
        warnings: warningCount,
        avgLatencyMs: Number(typed?.summary?.latencyMs?.average || 0),
        avgQuality: Number(typed?.summary?.quality?.average || 0),
      }
      setMetrics(nextMetrics)
      writeShellUiCache({ devToolsMetrics: nextMetrics })
    } catch {
      // Keep previous metrics on transient fetch failures.
    }
  }, [])

  useEffect(() => {
    fetchData()
    const timer = window.setInterval(fetchData, POLL_MS)
    return () => window.clearInterval(timer)
  }, [fetchData])

  return { devToolsMetrics: metrics }
}
