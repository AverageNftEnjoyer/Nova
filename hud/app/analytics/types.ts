export type AnalyticsDateRange = "24h" | "7d" | "30d" | "90d"
export type AnalyticsCategory = "all" | "llm" | "scraper" | "messaging" | "unclassified"

export interface AnalyticsFilters {
  dateRange: AnalyticsDateRange
  category: AnalyticsCategory
  integration: string
}

export type AnalyticsModuleKey =
  | "stats"
  | "requestVolume"
  | "usageDistribution"
  | "integrationBreakdown"
  | "apiBalances"
  | "activityFeed"

export interface AnalyticsModuleConfig {
  key: AnalyticsModuleKey
  label: string
  description: string
  defaultEnabled: boolean
}

export interface AnalyticsLayoutState {
  moduleVisibility: Record<AnalyticsModuleKey, boolean>
}

export type IntegrationStatus = "active" | "inactive" | "error"

export interface IntegrationMetricRow {
  key: string
  name: string
  slug: string
  category: AnalyticsCategory
  requests: number
  successRate: number
  avgLatencyMs: number
  status: IntegrationStatus
  source: "server" | "local" | "fallback"
}

export interface RequestTimeseriesPoint {
  time: string
  llm: number
  scraper: number
  messaging: number
  unclassified: number
}

export interface UsageSlice {
  key: string
  label: string
  value: number
  category: AnalyticsCategory
}

export type ActivityStatus = "success" | "warning" | "error"

export interface ActivityEvent {
  id: string
  service: string
  action: string
  timeAgo: string
  status: ActivityStatus
}

export type AgentStatus = "active" | "idle" | "paused"

export interface AgentHealthRow {
  id: string
  name: string
  role: string
  status: AgentStatus
  tasksCompleted: number
  tokensUsed: number
  uptime: string
  avgLatencyMs: number
  errorRatePct: number
  lastTask: string
  model?: string
}

export interface ApiBalanceRow {
  key: string
  name: string
  used: number
  limit: number
  unit: "$" | "req" | "pages"
}

export interface AnalyticsDataBundle {
  integrations: IntegrationMetricRow[]
  requestVolumeByRange: Record<AnalyticsDateRange, RequestTimeseriesPoint[]>
  activityFeed: ActivityEvent[]
  agentRoster: AgentHealthRow[]
  apiBalances: ApiBalanceRow[]
}
