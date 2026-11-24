import { USAGE_SOURCES, USAGE_SOURCE_LABELS, type UsageAnalytics, type UsageSource, type UsageTotals } from "@/lib/analytics/types"
import type { SelectOption } from "@/components/ui"

import { providerLabel } from "./format"

/**
 * What the page is narrowed to. The API splits totals and daily cost by source and by provider separately (never
 * both), so the filter is one choice: everything, one source, or one provider.
 */
export type AnalyticsScope = { kind: "all" } | { kind: "source"; value: UsageSource } | { kind: "provider"; value: string }

export const ALL_SCOPE: AnalyticsScope = { kind: "all" }

export function scopeKey(scope: AnalyticsScope): string {
  return scope.kind === "all" ? "all" : `${scope.kind}:${scope.value}`
}

export function parseScopeKey(key: string): AnalyticsScope {
  if (key.startsWith("source:")) {
    const value = key.slice(7) as UsageSource
    if (USAGE_SOURCES.includes(value)) return { kind: "source", value }
  }
  if (key.startsWith("provider:")) return { kind: "provider", value: key.slice(9) }
  return ALL_SCOPE
}

export function scopeOptions(usage: UsageAnalytics): SelectOption[] {
  return [
    { value: "all", label: "All calls" },
    ...USAGE_SOURCES.map((source) => ({ value: `source:${source}`, label: USAGE_SOURCE_LABELS[source], description: "Source" })),
    ...usage.byProvider.map((row) => ({ value: `provider:${row.provider}`, label: providerLabel(row.provider), description: "Provider" })),
  ]
}

export function scopedTotals(usage: UsageAnalytics, scope: AnalyticsScope): UsageTotals {
  if (scope.kind === "source") return usage.bySource.find((row) => row.source === scope.value) ?? emptyTotals()
  if (scope.kind === "provider") return usage.byProvider.find((row) => row.provider === scope.value) ?? emptyTotals()
  return usage.totals
}

function emptyTotals(): UsageTotals {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    uncachedInputTokens: 0,
    costUsd: 0,
    unpricedCalls: 0,
    cacheHitRate: 0,
    savingsUsd: 0,
  }
}
