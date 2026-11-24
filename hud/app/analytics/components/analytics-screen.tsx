"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"

import { PageContainer } from "@/components/shell"
import {
  Button,
  EmptyState,
  IconButton,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  Stat,
  StatGroup,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
} from "@/components/ui"
import { systemTimeZone } from "@/lib/analytics/time-zone"
import { ANALYTICS_TIME_ZONE_PARAM, USAGE_SOURCE_LABELS, type AnalyticsData, type AnalyticsResponse } from "@/lib/analytics/types"
import { cn } from "@/lib/shared/utils"

import { AgentTaskSection } from "./agent-task-section"
import { BudgetSection } from "./budget-section"
import { ModelTable, SourceTable, TierTable } from "./breakdown-tables"
import { useChartTokens } from "./chart-kit"
import { SpendChart, TokensChart, type SpendGrouping } from "./usage-charts"
import { formatCount, formatPercent, formatTokens, formatUsd, providerLabel } from "../lib/format"
import { ALL_SCOPE, parseScopeKey, scopedTotals, scopeKey, scopeOptions, type AnalyticsScope } from "../lib/scope"

type RangeKey = "1" | "7" | "30" | "90"

const RANGES: Array<{ value: RangeKey; label: string }> = [
  { value: "1", label: "Today" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
]

function rangeLabelFor(days: number): string {
  return days === 1 ? "today" : `the last ${days} days`
}

function scopeLabel(scope: AnalyticsScope): string {
  if (scope.kind === "source") return USAGE_SOURCE_LABELS[scope.value]
  if (scope.kind === "provider") return providerLabel(scope.value)
  return ""
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading analytics">
      <Skeleton className="h-[4.75rem] w-full rounded-lg" />
      <Skeleton className="h-[19rem] w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  )
}

export function AnalyticsScreen() {
  const tokens = useChartTokens()
  const [range, setRange] = useState<RangeKey>("30")
  const [scope, setScope] = useState<AnalyticsScope>(ALL_SCOPE)
  const [grouping, setGrouping] = useState<SpendGrouping>("source")
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const hashScrolledRef = useRef(false)
  const days = Number(range)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setRefreshing(true)
      try {
        const query = new URLSearchParams({ days: String(days), [ANALYTICS_TIME_ZONE_PARAM]: systemTimeZone() })
        const response = await fetch(`/api/analytics?${query.toString()}`, { cache: "no-store", signal: controller.signal })
        const data = (await response.json()) as AnalyticsResponse
        if (data.ok && data.analytics) {
          setAnalytics(data.analytics)
          setLoadError(null)
        } else {
          setLoadError(data.error || "Could not load analytics.")
        }
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("Failed to load analytics:", error)
        setLoadError("Could not reach the Nova server. Check that Nova is running, then try again.")
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [days, reloadToken])

  // /analytics#budgets (linked from Home): scroll once the section has rendered.
  useEffect(() => {
    if (!analytics || hashScrolledRef.current) return
    if (typeof window === "undefined" || window.location.hash !== "#budgets") return
    const frame = window.requestAnimationFrame(() => {
      hashScrolledRef.current = true
      document.getElementById("budgets")?.scrollIntoView({ block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [analytics])

  const reload = useCallback(() => setReloadToken((value) => value + 1), [])

  const usage = analytics?.usage
  const options = usage ? scopeOptions(usage) : [{ value: "all", label: "All calls" }]
  // A provider can drop out of a shorter range; fall back to everything rather than show an empty scope.
  const activeScope = scope.kind === "provider" && usage && !usage.byProvider.some((row) => row.provider === scope.value) ? ALL_SCOPE : scope

  const actions = (
    <>
      <Select
        value={scopeKey(activeScope)}
        options={options}
        onValueChange={(value) => setScope(parseScopeKey(value))}
        size="sm"
        aria-label="Filter by source or provider"
        className="w-40"
      />
      <Tabs value={range} onValueChange={(value) => setRange(value as RangeKey)} variant="segmented">
        <TabsList aria-label="Time range">
          {RANGES.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Tooltip content="Refresh">
        <IconButton aria-label="Refresh analytics" size="sm" variant="outline" onClick={reload} disabled={refreshing}>
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </IconButton>
      </Tooltip>
    </>
  )

  const header = (
    <PageHeader
      title="Analytics"
      description={
        usage
          ? `Spend, tokens and caching for every model call, ${rangeLabelFor(days)}. History is kept for ${usage.range.retentionDays} days.`
          : "Spend, tokens and caching for every model call."
      }
      actions={actions}
    />
  )

  if (!analytics || !usage) {
    return (
      <PageContainer width="wide">
        {header}
        {loading ? (
          <LoadingState />
        ) : (
          <Panel>
            <EmptyState
              tone="danger"
              title="Analytics did not load"
              description={loadError ?? "Something went wrong while reading the usage ledger."}
              action={
                <Button variant="outline" onClick={reload}>
                  Try again
                </Button>
              }
            />
          </Panel>
        )}
      </PageContainer>
    )
  }

  const totals = scopedTotals(usage, activeScope)
  const hasUsage = usage.totals.calls > 0
  const timeline = analytics.timeline.slice(-days)
  const providers = usage.byProvider.map((row) => row.provider)
  const scopeSuffix = activeScope.kind === "all" ? "" : ` (${scopeLabel(activeScope)})`

  return (
    <PageContainer width="wide">
      {header}
      {loadError ? (
        <p role="alert" className="mb-4 rounded-md border border-danger-muted bg-danger-muted px-3 py-2 text-sm text-danger">
          {loadError} Showing the last figures that loaded.
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4" aria-label="Model usage">
          <StatGroup>
            <Stat
              label={`Spend${scopeSuffix}`}
              value={formatUsd(totals.costUsd)}
              hint={totals.unpricedCalls > 0 ? "Priced calls only" : "All calls priced"}
            />
            <Stat label="Input tokens" value={formatTokens(totals.inputTokens)} hint={`${formatTokens(totals.uncachedInputTokens)} uncached`} />
            <Stat label="Output tokens" value={formatTokens(totals.outputTokens)} />
            <Stat
              label="Cached input"
              value={totals.inputTokens > 0 ? formatPercent(totals.cacheHitRate) : "None"}
              hint={`${formatUsd(totals.savingsUsd)} saved by caching`}
            />
            <Stat label="Calls" value={formatCount(totals.calls)} />
            <Stat
              label="Unpriced calls"
              value={<span className={cn(totals.unpricedCalls > 0 && "text-warning")}>{formatCount(totals.unpricedCalls)}</span>}
              hint="Not in spend"
            />
          </StatGroup>

          {!hasUsage ? (
            <Panel>
              <EmptyState
                title={days === 90 ? "No model calls recorded yet" : `No model calls in ${rangeLabelFor(days)}`}
                description={
                  days === 90
                    ? "No model calls recorded yet. Usage appears here after your first chat or run."
                    : "Usage appears here after a chat, run or automation calls a model."
                }
                action={
                  days === 90 ? undefined : (
                    <Button variant="outline" onClick={() => setRange("90")}>
                      Show 90 days
                    </Button>
                  )
                }
              />
            </Panel>
          ) : (
            <>
              <SpendChart
                daily={usage.daily}
                providers={providers}
                scope={activeScope}
                grouping={grouping}
                onGroupingChange={setGrouping}
                tokens={tokens}
              />
              <TokensChart daily={usage.daily} scope={activeScope} tokens={tokens} />
              <ModelTable usage={usage} scope={activeScope} tokens={tokens} />
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <SourceTable usage={usage} tokens={tokens} />
                <TierTable usage={usage} tokens={tokens} />
              </div>
              {usage.savings.savingsUsd < 0 || usage.savings.unpricedCachedInputTokens > 0 ? (
                <p className="text-xs text-muted">
                  {usage.savings.savingsUsd < 0
                    ? "Caching savings are negative this range: cache writes cost more than plain input until they are read again. "
                    : ""}
                  {usage.savings.unpricedCachedInputTokens > 0
                    ? `${formatTokens(usage.savings.unpricedCachedInputTokens)} cached tokens on unpriced models are not counted in savings.`
                    : ""}
                </p>
              ) : null}
            </>
          )}
        </section>

        <AgentTaskSection analytics={analytics} timeline={timeline} tokens={tokens} />
        <BudgetSection budgets={analytics.budgets} rangeLabel={rangeLabelFor(days)} />
      </div>
    </PageContainer>
  )
}
