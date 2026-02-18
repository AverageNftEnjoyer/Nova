import type { AnalyticsDateRange, AnalyticsFilters, AnalyticsModuleConfig } from "./types"

export const DEFAULT_ANALYTICS_FILTERS: AnalyticsFilters = {
  dateRange: "24h",
  category: "all",
  integration: "all",
}

export const ANALYTICS_DATE_RANGE_OPTIONS: Array<{ value: AnalyticsDateRange; label: string }> = [
  { value: "24h", label: "Last 24 Hours" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
]

export const ANALYTICS_MODULES: AnalyticsModuleConfig[] = [
  { key: "stats", label: "Stats Strip", description: "Key totals and success rates", defaultEnabled: true },
  { key: "integrationBreakdown", label: "Integration Breakdown", description: "Per-service metrics table", defaultEnabled: true },
  { key: "apiBalances", label: "API Balances", description: "Credits and quota consumption", defaultEnabled: true },
  { key: "activityFeed", label: "Activity Feed", description: "Recent events across services", defaultEnabled: true },
]

export const ANALYTICS_LAYOUT_STORAGE_KEY = "nova:analytics:layout:v1"
export const ANALYTICS_FILTER_STORAGE_KEY = "nova:analytics:filters:v1"
