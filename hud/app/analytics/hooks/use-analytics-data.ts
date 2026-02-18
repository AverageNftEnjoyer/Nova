import { useEffect, useMemo, useState } from "react"

import { INTEGRATIONS_UPDATED_EVENT, loadIntegrationsSettings } from "@/lib/integrations/client-store"
import type { IntegrationsSettings } from "@/lib/integrations/client-store"

import { MOCK_ACTIVITY_FEED, MOCK_AGENT_ROSTER, MOCK_API_BALANCES, MOCK_REQUEST_VOLUME_BY_RANGE } from "../data/mock-analytics-data"
import { getIntegrationMetadata } from "../data/integration-metadata"
import type {
  AnalyticsDataBundle,
  AnalyticsDateRange,
  AnalyticsFilters,
  IntegrationMetricRow,
  IntegrationStatus,
  RequestTimeseriesPoint,
  UsageSlice,
} from "../types"

interface ServerConfigShape {
  config?: Partial<Record<string, unknown>>
}

const BASE_REQUESTS_BY_KEY: Record<string, number> = {
  openai: 12847,
  claude: 8432,
  gemini: 3291,
  grok: 1520,
  brave: 6723,
  firecrawl: 4102,
  telegram: 2891,
  discord: 1843,
  gmail: 1260,
}

const BASE_SUCCESS_RATE_BY_KEY: Record<string, number> = {
  openai: 99.2,
  claude: 98.8,
  gemini: 97.5,
  grok: 96.1,
  brave: 99.5,
  firecrawl: 98.1,
  telegram: 99.9,
  discord: 99.7,
  gmail: 99.4,
}

function integrationConnected(settings: IntegrationsSettings, key: string): boolean {
  const service = (settings as unknown as Record<string, unknown>)[key] as { connected?: boolean } | undefined
  return Boolean(service?.connected)
}

function buildIntegrationRows(settings: IntegrationsSettings, serverKeys: string[]): IntegrationMetricRow[] {
  const localKeys = Object.keys(settings).filter((key) => {
    if (key === "activeLlmProvider" || key === "updatedAt") return false
    const service = (settings as unknown as Record<string, unknown>)[key] as { connected?: boolean } | undefined
    return typeof service === "object" && service !== null && Object.prototype.hasOwnProperty.call(service, "connected")
  })

  const mergedKeys = new Set([...serverKeys, ...localKeys])

  return Array.from(mergedKeys)
    .map((key) => {
      const metadata = getIntegrationMetadata(key)
      const requests = BASE_REQUESTS_BY_KEY[key] ?? 480
      const successRate = BASE_SUCCESS_RATE_BY_KEY[key] ?? 97.2
      const connected = integrationConnected(settings, key)
      const status: IntegrationStatus = connected ? "active" : "inactive"
      return {
        key,
        name: metadata.label,
        slug: metadata.slug,
        category: metadata.category,
        requests,
        successRate,
        avgLatencyMs: metadata.latencyMs,
        status,
        source: (serverKeys.includes(key) ? "server" : "local") as "server" | "local",
      }
    })
    .sort((a, b) => b.requests - a.requests)
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

function pickServerKeys(payload: ServerConfigShape | null): string[] {
  if (!payload?.config) return []
  return Object.keys(payload.config).filter((key) => {
    const value = payload.config?.[key]
    if (key === "updatedAt" || key === "activeLlmProvider" || key === "agents") return false
    return typeof value === "object" && value !== null
  })
}

export function useAnalyticsData(filters: AnalyticsFilters) {
  const [serverConfig, setServerConfig] = useState<ServerConfigShape | null>(null)
  const [settings, setSettings] = useState<IntegrationsSettings>(() => loadIntegrationsSettings())

  useEffect(() => {
    const syncLocal = () => setSettings(loadIntegrationsSettings())
    syncLocal()
    window.addEventListener(INTEGRATIONS_UPDATED_EVENT, syncLocal as EventListener)
    return () => window.removeEventListener(INTEGRATIONS_UPDATED_EVENT, syncLocal as EventListener)
  }, [])

  useEffect(() => {
    let cancelled = false

    fetch("/api/integrations/config", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as ServerConfigShape
        if (!cancelled) setServerConfig(res.ok ? data : null)
      })
      .catch(() => {
        if (!cancelled) setServerConfig(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const integrationRows = useMemo(() => {
    const serverKeys = pickServerKeys(serverConfig)
    const rows = buildIntegrationRows(settings, serverKeys)
    return rows.filter((row) => {
      if (filters.category !== "all" && row.category !== filters.category) return false
      if (filters.integration !== "all" && row.slug !== filters.integration) return false
      return true
    })
  }, [filters.category, filters.integration, serverConfig, settings])

  const requestVolume = useMemo(() => {
    const points = MOCK_REQUEST_VOLUME_BY_RANGE[filters.dateRange as AnalyticsDateRange] || MOCK_REQUEST_VOLUME_BY_RANGE["24h"]
    return filterTimeseries(points, filters)
  }, [filters])

  const usageSlices = useMemo<UsageSlice[]>(() => {
    const rows = integrationRows.length > 0 ? integrationRows : buildIntegrationRows(settings, pickServerKeys(serverConfig))
    return rows
      .map((row) => ({ key: row.key, label: row.name, value: row.requests, category: row.category }))
      .sort((a, b) => b.value - a.value)
  }, [integrationRows, serverConfig, settings])

  const bundle = useMemo<AnalyticsDataBundle>(
    () => ({
      integrations: integrationRows,
      requestVolumeByRange: MOCK_REQUEST_VOLUME_BY_RANGE,
      activityFeed: MOCK_ACTIVITY_FEED,
      agentRoster: MOCK_AGENT_ROSTER,
      apiBalances: MOCK_API_BALANCES,
    }),
    [integrationRows],
  )

  return {
    data: bundle,
    integrationRows,
    requestVolume,
    usageSlices,
    activityFeed: MOCK_ACTIVITY_FEED,
    agentRoster: MOCK_AGENT_ROSTER,
    apiBalances: MOCK_API_BALANCES,
  }
}
