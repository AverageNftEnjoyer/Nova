import { useEffect, useMemo, useState } from "react"

import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings } from "@/lib/integrations/client-store"
import type { IntegrationsSettings } from "@/lib/integrations/client-store"

import { MOCK_REQUEST_VOLUME_BY_RANGE } from "../data/mock-analytics-data"
import { getIntegrationMetadata } from "../data/integration-metadata"
import type {
  AnalyticsDataBundle,
  AnalyticsDateRange,
  AnalyticsFilters,
  IntegrationMetricRow,
  IntegrationStatus,
  RequestTimeseriesPoint,
  UsageSlice,
  ActivityEvent,
  ApiBalanceRow,
} from "../types"

// ── Server config shape ────────────────────────────────────────────────────────

interface ServerConfigShape {
  config?: Partial<Record<string, unknown>>
}

// ── Real usage data shape (from /api/analytics/usage) ─────────────────────────

interface IntegrationStat {
  requests: number
  successCount: number
  totalLatencyMs: number
}

interface TokenTotal {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedCostUsd: number
}

interface UsageData {
  requestVolume: Record<AnalyticsDateRange, RequestTimeseriesPoint[]>
  activityFeed: ActivityEvent[]
  integrationStats: Record<string, IntegrationStat>
  tokenTotals: Record<string, TokenTotal>
  turnCount: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function integrationConnected(settings: IntegrationsSettings, key: string): boolean {
  const service = (settings as unknown as Record<string, unknown>)[key] as { connected?: boolean } | undefined
  return Boolean(service?.connected)
}

function pickServerKeys(payload: ServerConfigShape | null): string[] {
  if (!payload?.config) return []
  return Object.keys(payload.config).filter((key) => {
    const value = payload.config?.[key]
    if (key === "updatedAt" || key === "activeLlmProvider" || key === "agents") return false
    return typeof value === "object" && value !== null
  })
}

function buildIntegrationRows(
  settings: IntegrationsSettings,
  serverKeys: string[],
  integrationStats: Record<string, IntegrationStat>,
): IntegrationMetricRow[] {
  const localKeys = Object.keys(settings).filter((key) => {
    if (key === "activeLlmProvider" || key === "updatedAt") return false
    const service = (settings as unknown as Record<string, unknown>)[key] as { connected?: boolean } | undefined
    return typeof service === "object" && service !== null && Object.prototype.hasOwnProperty.call(service, "connected")
  })

  const mergedKeys = new Set([...serverKeys, ...localKeys])

  return Array.from(mergedKeys)
    .map((key) => {
      const metadata = getIntegrationMetadata(key)
      const connected = integrationConnected(settings, key)
      const status: IntegrationStatus = connected ? "active" : "inactive"
      const stat = integrationStats[key]

      // Use real data from logs when available; fall back to metadata defaults
      const requests = stat?.requests ?? 0
      const successRate = stat && stat.requests > 0
        ? Number(((stat.successCount / stat.requests) * 100).toFixed(1))
        : 0
      const avgLatencyMs = stat && stat.requests > 0
        ? Math.round(stat.totalLatencyMs / stat.requests)
        : metadata.latencyMs

      return {
        key,
        name: metadata.label,
        slug: metadata.slug,
        category: metadata.category,
        requests,
        successRate,
        avgLatencyMs,
        status,
        source: (serverKeys.includes(key) ? "server" : "local") as "server" | "local",
      }
    })
    .sort((a, b) => b.requests - a.requests)
}

function buildApiBalances(tokenTotals: Record<string, TokenTotal>): ApiBalanceRow[] {
  const PROVIDER_LABEL: Record<string, string> = {
    openai: "OpenAI",
    claude: "Claude",
    grok: "Grok",
    gemini: "Gemini",
  }

  return Object.entries(tokenTotals)
    .filter(([key]) => key in PROVIDER_LABEL)
    .map(([key, total]) => ({
      key,
      name: PROVIDER_LABEL[key] ?? key,
      // Show estimated cost when available, otherwise total tokens (in thousands)
      used: total.estimatedCostUsd > 0
        ? Number(total.estimatedCostUsd.toFixed(4))
        : Number((total.totalTokens / 1000).toFixed(1)),
      limit: 0,
      unit: (total.estimatedCostUsd > 0 ? "$" : "req") as "$" | "req" | "pages",
    }))
    .sort((a, b) => b.used - a.used)
}

function filterTimeseries(points: RequestTimeseriesPoint[], filters: AnalyticsFilters): RequestTimeseriesPoint[] {
  if (filters.category === "all") return points
  return points.map((point) => ({
    ...point,
    llm: filters.category === "llm" ? point.llm : 0,
    scraper: filters.category === "scraper" ? point.scraper : 0,
    messaging: filters.category === "messaging" ? point.messaging : 0,
    unclassified: filters.category === "unclassified" ? point.unclassified : 0,
  }))
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAnalyticsData(filters: AnalyticsFilters) {
  const [serverConfig, setServerConfig] = useState<ServerConfigShape | null>(null)
  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())
  const [usageData, setUsageData] = useState<UsageData | null>(null)

  useEffect(() => {
    const sync = () => setSettings(loadIntegrationsSettings())
    sync()
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, sync as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, sync as EventListener)
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    fetch("/api/integrations/config", { cache: "no-store", signal: ctrl.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as ServerConfigShape
        setServerConfig(res.ok ? data : null)
      })
      .catch((err: unknown) => { if ((err as { name?: string }).name !== "AbortError") setServerConfig(null) })
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    let mounted = true
    let inFlight: AbortController | null = null
    let pollId: number | null = null
    let consecutiveFailures = 0

    const visibleIntervalMs = 5000
    const hiddenIntervalMs = 30000
    const maxBackoffFactor = 6

    const clearPoll = () => {
      if (pollId !== null) {
        window.clearTimeout(pollId)
        pollId = null
      }
    }

    const currentBaseInterval = () => (document.visibilityState === "visible" ? visibleIntervalMs : hiddenIntervalMs)

    const scheduleNext = () => {
      clearPoll()
      const backoffFactor = Math.min(maxBackoffFactor, Math.max(1, consecutiveFailures + 1))
      const delayMs = currentBaseInterval() * backoffFactor
      pollId = window.setTimeout(fetchUsage, delayMs)
    }

    const fetchUsage = () => {
      inFlight?.abort()
      const ctrl = new AbortController()
      inFlight = ctrl

      fetch("/api/analytics/usage", { cache: "no-store", signal: ctrl.signal })
        .then(async (res) => {
          if (!mounted) return
          if (!res.ok) {
            consecutiveFailures += 1
            return
          }
          const data = (await res.json().catch(() => null)) as (UsageData & { ok?: boolean }) | null
          if (mounted && data?.ok) {
            consecutiveFailures = 0
            setUsageData(data)
          } else {
            consecutiveFailures += 1
          }
        })
        .catch((err: unknown) => {
          if ((err as { name?: string }).name !== "AbortError") {
            consecutiveFailures += 1
            console.warn("[analytics] usage fetch:", err)
          }
        })
        .finally(() => {
          if (inFlight === ctrl) inFlight = null
          if (mounted) scheduleNext()
        })
    }

    const handleVisibility = () => {
      if (!mounted) return
      scheduleNext()
    }

    fetchUsage()
    document.addEventListener("visibilitychange", handleVisibility)

    return () => {
      mounted = false
      clearPoll()
      document.removeEventListener("visibilitychange", handleVisibility)
      inFlight?.abort()
    }
  }, [])

  const integrationRows = useMemo(() => {
    const serverKeys = pickServerKeys(serverConfig)
    const stats = usageData?.integrationStats ?? {}
    const rows = buildIntegrationRows(settings, serverKeys, stats)
    return rows.filter((row) => {
      if (filters.category !== "all" && row.category !== filters.category) return false
      if (filters.integration !== "all" && row.slug !== filters.integration) return false
      return true
    })
  }, [filters.category, filters.integration, serverConfig, settings, usageData])

  const requestVolume = useMemo(() => {
    const range = filters.dateRange as AnalyticsDateRange
    const points = usageData?.requestVolume[range]
      ?? MOCK_REQUEST_VOLUME_BY_RANGE[range]
      ?? MOCK_REQUEST_VOLUME_BY_RANGE["24h"]
    return filterTimeseries(points, filters)
  }, [filters, usageData])

  const usageSlices = useMemo<UsageSlice[]>(() => {
    const serverKeys = pickServerKeys(serverConfig)
    const stats = usageData?.integrationStats ?? {}
    const rows = integrationRows.length > 0
      ? integrationRows
      : buildIntegrationRows(settings, serverKeys, stats)
    return rows
      .map((row) => ({ key: row.key, label: row.name, value: row.requests, category: row.category }))
      .sort((a, b) => b.value - a.value)
  }, [integrationRows, serverConfig, settings, usageData])

  const apiBalances = useMemo<ApiBalanceRow[]>(() => {
    if (!usageData?.tokenTotals || Object.keys(usageData.tokenTotals).length === 0) return []
    return buildApiBalances(usageData.tokenTotals)
  }, [usageData])

  const activityFeed = useMemo<ActivityEvent[]>(() => {
    return usageData?.activityFeed ?? []
  }, [usageData])

  const bundle = useMemo<AnalyticsDataBundle>(
    () => ({
      integrations: integrationRows,
      requestVolumeByRange: usageData?.requestVolume ?? MOCK_REQUEST_VOLUME_BY_RANGE,
      activityFeed,
      agentRoster: [],
      apiBalances,
    }),
    [integrationRows, usageData, activityFeed, apiBalances],
  )

  return {
    data: bundle,
    integrationRows,
    requestVolume,
    usageSlices,
    activityFeed,
    agentRoster: [],
    apiBalances,
  }
}
