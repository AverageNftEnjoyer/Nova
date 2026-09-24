"use client"

import { useEffect, useState } from "react"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import { AGENT_TASK_BUDGET_WINDOW_EVENT } from "@/lib/agents/task-budget"
import type { AnalyticsSummary, AnalyticsSummaryResponse } from "@/lib/analytics/types"

/** Figures the Home Analytics panel renders, normalised so a partial payload never breaks the panel. */
export interface HomeAnalyticsSummary {
  date: string
  costUsd: number
  calls: number
  unpricedCalls: number
  /** Input + output tokens today. */
  tokens: number
  /** 0..1 */
  cacheHitRate: number
  /** Agent tasks in the "warning" or "degraded" budget state. */
  budgetWarning: number
  budgetExhausted: number
  generatedAt: string
}

export interface HomeAnalyticsSummaryState {
  summary: HomeAnalyticsSummary | null
  /** True until the first request settles (success or failure). */
  loading: boolean
  /** Last refresh error; `summary` keeps the last good data when this is set. */
  error: string | null
}

const SUMMARY_ENDPOINT = "/api/analytics/summary"
const POLL_INTERVAL_MS = 60_000
/** Budget events arrive in bursts while a task runs; one refresh per burst is enough. */
const BUDGET_EVENT_DEBOUNCE_MS = 2_000

function finiteNonNegative(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeSummary(raw: AnalyticsSummary): HomeAnalyticsSummary {
  const today = raw.today
  const budget = raw.budget
  return {
    date: String(raw.date || ""),
    costUsd: finiteNonNegative(today?.costUsd),
    calls: finiteNonNegative(today?.calls),
    unpricedCalls: finiteNonNegative(today?.unpricedCalls),
    tokens: finiteNonNegative(today?.inputTokens) + finiteNonNegative(today?.outputTokens),
    cacheHitRate: Math.min(1, finiteNonNegative(today?.cacheHitRate)),
    budgetWarning: finiteNonNegative(budget?.warning) + finiteNonNegative(budget?.degraded),
    budgetExhausted: finiteNonNegative(budget?.exhausted),
    generatedAt: String(raw.generatedAt || ""),
  }
}

/**
 * Polls GET /api/analytics/summary every 60 s while the page is visible, refreshes when the tab becomes visible
 * again, on an agent-task budget event (debounced) and when the active user changes.
 */
export function useHomeAnalyticsSummary(): HomeAnalyticsSummaryState {
  const [state, setState] = useState<HomeAnalyticsSummaryState>({ summary: null, loading: true, error: null })

  useEffect(() => {
    let disposed = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight: AbortController | null = null

    const load = async () => {
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller
      try {
        const res = await fetch(SUMMARY_ENDPOINT, {
          method: "GET",
          cache: "no-store",
          credentials: "include",
          signal: controller.signal,
        })
        const data = (await res.json().catch(() => null)) as AnalyticsSummaryResponse | null
        if (disposed || controller.signal.aborted) return
        if (!res.ok || !data?.ok || !data.summary) {
          throw new Error(data?.error || `Usage summary request failed (${res.status}).`)
        }
        const summary = normalizeSummary(data.summary)
        setState({ summary, loading: false, error: null })
      } catch (err) {
        if (disposed || controller.signal.aborted) return
        const message = err instanceof Error ? err.message : "Usage summary unavailable."
        setState((prev) => ({ summary: prev.summary, loading: false, error: message }))
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

    /** Refresh now and restart the 60 s countdown so a manual refresh is not followed by an immediate poll. */
    const refreshNow = () => {
      if (disposed) return
      void load()
      schedule()
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshNow()
    }

    const onBudgetEvent = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        if (document.visibilityState === "visible") refreshNow()
      }, BUDGET_EVENT_DEBOUNCE_MS)
    }

    const onActiveUserChanged = () => {
      setState({ summary: null, loading: true, error: null })
      refreshNow()
    }

    refreshNow()
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener(AGENT_TASK_BUDGET_WINDOW_EVENT, onBudgetEvent)
    window.addEventListener(ACTIVE_USER_CHANGED_EVENT, onActiveUserChanged)
    return () => {
      disposed = true
      if (pollTimer) clearTimeout(pollTimer)
      if (debounceTimer) clearTimeout(debounceTimer)
      inFlight?.abort()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener(AGENT_TASK_BUDGET_WINDOW_EVENT, onBudgetEvent)
      window.removeEventListener(ACTIVE_USER_CHANGED_EVENT, onActiveUserChanged)
    }
  }, [])

  return state
}
