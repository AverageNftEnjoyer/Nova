"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ACTIVE_USER_CHANGED_EVENT } from "@/lib/auth/active-user"
import { AGENT_TASK_BUDGET_WINDOW_EVENT } from "@/lib/agents/task-budget"
import { systemTimeZone } from "@/lib/analytics/time-zone"
import {
  ANALYTICS_TIME_ZONE_PARAM,
  type AnalyticsResponse,
  type AnalyticsSummary,
  type AnalyticsSummaryResponse,
  type UsageAnalytics,
} from "@/lib/analytics/types"

/** One local day of the last week, oldest first. */
export interface HomeUsageDay {
  date: string
  costUsd: number
  tokens: number
}

/** The last 7 local days (today included) from the usage ledger. */
export interface HomeUsageWeek {
  costUsd: number
  tokens: number
  calls: number
  unpricedCalls: number
  days: HomeUsageDay[]
}

/** Figures the Home usage panel renders, normalised so a partial payload never breaks the panel. */
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
  /** Null until the weekly figures load (or when they fail; `error` then says why). */
  week: HomeUsageWeek | null
  /** True until the first request settles (success or failure). */
  loading: boolean
  /** Last refresh error; `summary` keeps the last good data when this is set. */
  error: string | null
  /** Refetch now (the Retry action). */
  refresh: () => void
}

type LoadedState = Omit<HomeAnalyticsSummaryState, "refresh">

const SUMMARY_ENDPOINT = "/api/analytics/summary"
const WEEK_ENDPOINT = "/api/analytics?days=7"
const POLL_INTERVAL_MS = 60_000
/** The weekly query reads the whole ledger range; it refreshes less often than today's summary. */
const WEEK_REFRESH_MS = 5 * 60_000
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

function normalizeWeek(usage: UsageAnalytics | undefined): HomeUsageWeek | null {
  if (!usage?.totals) return null
  const days = Array.isArray(usage.daily) ? usage.daily : []
  return {
    costUsd: finiteNonNegative(usage.totals.costUsd),
    tokens: finiteNonNegative(usage.totals.inputTokens) + finiteNonNegative(usage.totals.outputTokens),
    calls: finiteNonNegative(usage.totals.calls),
    unpricedCalls: finiteNonNegative(usage.totals.unpricedCalls),
    days: days
      .map((day) => ({
        date: String(day.date || ""),
        costUsd: finiteNonNegative(day.costUsd),
        tokens: finiteNonNegative(day.inputTokens) + finiteNonNegative(day.outputTokens),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/**
 * Polls GET /api/analytics/summary every 60 s while the page is visible, refreshes when the tab becomes visible
 * again, on an agent-task budget event (debounced) and when the active user changes. The 7-day series
 * (GET /api/analytics?days=7) rides along at most every 5 minutes.
 */
export function useHomeAnalyticsSummary(): HomeAnalyticsSummaryState {
  const [state, setState] = useState<LoadedState>({ summary: null, week: null, loading: true, error: null })
  const refreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    let disposed = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight: AbortController | null = null
    let weekLoadedAt = 0

    const load = async (forceWeek = false) => {
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller
      try {
        // The viewer's zone decides where "today" starts (exact for half-hour / 45-minute offsets and DST).
        const zone = `${ANALYTICS_TIME_ZONE_PARAM}=${encodeURIComponent(systemTimeZone())}`
        const wantWeek = forceWeek || Date.now() - weekLoadedAt >= WEEK_REFRESH_MS
        const init: RequestInit = { method: "GET", cache: "no-store", credentials: "include", signal: controller.signal }
        const [res, weekRes] = await Promise.all([
          fetch(`${SUMMARY_ENDPOINT}?${zone}`, init),
          wantWeek ? fetch(`${WEEK_ENDPOINT}&${zone}`, init) : Promise.resolve(null),
        ])
        const data = (await res.json().catch(() => null)) as AnalyticsSummaryResponse | null
        const weekData = weekRes ? ((await weekRes.json().catch(() => null)) as AnalyticsResponse | null) : null
        if (disposed || controller.signal.aborted) return
        if (!res.ok || !data?.ok || !data.summary) {
          throw new Error(data?.error || `Usage summary request failed (${res.status}).`)
        }
        const summary = normalizeSummary(data.summary)
        const week = weekRes && weekRes.ok && weekData?.ok ? normalizeWeek(weekData.analytics?.usage) : null
        if (week) weekLoadedAt = Date.now()
        setState((prev) => ({ summary, week: week ?? prev.week, loading: false, error: null }))
      } catch (err) {
        if (disposed || controller.signal.aborted) return
        const message = err instanceof Error ? err.message : "Usage summary unavailable."
        setState((prev) => ({ ...prev, loading: false, error: message }))
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
    const refreshNow = (forceWeek = false) => {
      if (disposed) return
      void load(forceWeek)
      schedule()
    }
    refreshRef.current = () => {
      setState((prev) => ({ ...prev, loading: prev.summary === null, error: null }))
      refreshNow(true)
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
      setState({ summary: null, week: null, loading: true, error: null })
      refreshNow(true)
    }

    refreshNow(true)
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

  return { ...state, refresh }
}
