"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { EmptyState, Panel, Tabs, TabsList, TabsTrigger } from "@/components/ui"
import { USAGE_SOURCES, USAGE_SOURCE_LABELS, type UsageDailyRow, type UsageSource } from "@/lib/analytics/types"

import { ChartLegend, ChartTooltip, axisTick, type ChartTokens, type LegendItem } from "./chart-kit"
import { formatDayLong, formatDayShort, formatTokens, formatUsd, formatUsdTick, providerLabel } from "../lib/format"
import type { AnalyticsScope } from "../lib/scope"

export type SpendGrouping = "source" | "provider"

const CHART_HEIGHT = 240

interface SeriesDef {
  key: string
  label: string
  color: string
}

function StackedBars({
  data,
  series,
  tokens,
  valueFormatter,
  tickFormatter,
  yWidth,
}: {
  data: Array<Record<string, string | number>>
  series: SeriesDef[]
  tokens: ChartTokens
  valueFormatter: (value: number) => string
  tickFormatter: (value: number) => string
  yWidth: number
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={tokens.grid} vertical={false} />
        <XAxis
          dataKey="date"
          tick={axisTick(tokens)}
          tickFormatter={formatDayShort}
          axisLine={{ stroke: tokens.axis }}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis tick={axisTick(tokens)} tickFormatter={tickFormatter} width={yWidth} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: tokens.grid, opacity: 0.6 }}
          isAnimationActive={false}
          content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} formatLabel={formatDayLong} formatValue={valueFormatter} total />}
        />
        {series.map((entry, index) => (
          <Bar
            key={entry.key}
            dataKey={entry.key}
            name={entry.label}
            stackId="stack"
            fill={entry.color}
            stroke={tokens.surface}
            strokeWidth={2}
            maxBarSize={28}
            isAnimationActive={false}
            radius={index === series.length - 1 ? [4, 4, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function sourceColor(tokens: ChartTokens, source: UsageSource): string {
  return tokens.series[USAGE_SOURCES.indexOf(source)] ?? tokens.faint
}

/** Colour follows the provider, never its rank. */
export function providerColor(tokens: ChartTokens, provider: string): string {
  switch (provider) {
    case "openai":
      return tokens.series[0]
    case "gemini":
      return tokens.series[1]
    case "grok":
      return tokens.series[2]
    case "claude":
      return tokens.series[3]
    default:
      return tokens.series[4]
  }
}

interface SpendChartProps {
  daily: UsageDailyRow[]
  providers: string[]
  scope: AnalyticsScope
  grouping: SpendGrouping
  onGroupingChange: (value: SpendGrouping) => void
  tokens: ChartTokens
}

export function SpendChart({ daily, providers, scope, grouping, onGroupingChange, tokens }: SpendChartProps) {
  const effective: SpendGrouping = scope.kind === "source" ? "source" : scope.kind === "provider" ? "provider" : grouping
  const series: SeriesDef[] =
    effective === "source"
      ? USAGE_SOURCES.filter((source) => scope.kind !== "source" || scope.value === source).map((source) => ({
          key: source,
          label: USAGE_SOURCE_LABELS[source],
          color: sourceColor(tokens, source),
        }))
      : providers
          .filter((provider) => scope.kind !== "provider" || scope.value === provider)
          .map((provider) => ({ key: `p:${provider}`, label: providerLabel(provider), color: providerColor(tokens, provider) }))

  const data = daily.map((day) => {
    const row: Record<string, string | number> = { date: day.date }
    if (effective === "source") for (const source of USAGE_SOURCES) row[source] = day.bySource[source]?.costUsd ?? 0
    else for (const provider of providers) row[`p:${provider}`] = day.costByProvider[provider] ?? 0
    return row
  })

  const legend: LegendItem[] = series.map((entry) => ({ key: entry.key, label: entry.label, color: entry.color }))

  return (
    <Panel
      title="Spend over time"
      description="Per local day. Unpriced calls add tokens but no cost."
      actions={
        <Tabs value={effective} onValueChange={(value) => onGroupingChange(value as SpendGrouping)} variant="segmented">
          <TabsList aria-label="Group spend by">
            <TabsTrigger value="source" disabled={scope.kind === "provider"}>
              Source
            </TabsTrigger>
            <TabsTrigger value="provider" disabled={scope.kind === "source"}>
              Provider
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
    >
      <div className="flex flex-col gap-3">
        <ChartLegend items={legend} />
        <StackedBars data={data} series={series} tokens={tokens} valueFormatter={formatUsd} tickFormatter={formatUsdTick} yWidth={60} />
      </div>
    </Panel>
  )
}

export function TokensChart({ daily, scope, tokens }: { daily: UsageDailyRow[]; scope: AnalyticsScope; tokens: ChartTokens }) {
  if (scope.kind === "provider") {
    return (
      <Panel title="Tokens over time" description="Input and output tokens per local day.">
        <EmptyState
          size="compact"
          title="Daily tokens are not split by provider"
          description="Clear the provider filter to see tokens per day. The model table below is filtered."
        />
      </Panel>
    )
  }

  if (scope.kind === "source") {
    const color = sourceColor(tokens, scope.value as UsageSource)
    const data = daily.map((day) => ({ date: day.date, tokens: day.bySource[scope.value as UsageSource]?.tokens ?? 0 }))
    return (
      <Panel title="Tokens over time" description={`${USAGE_SOURCE_LABELS[scope.value as UsageSource]}: input plus output tokens per local day.`}>
        <StackedBars
          data={data}
          series={[{ key: "tokens", label: "Tokens", color }]}
          tokens={tokens}
          valueFormatter={formatTokens}
          tickFormatter={formatTokens}
          yWidth={44}
        />
      </Panel>
    )
  }

  const series: SeriesDef[] = [
    { key: "cached", label: "Cached input", color: tokens.series[1] },
    { key: "uncached", label: "Uncached input", color: tokens.series[0] },
    { key: "output", label: "Output", color: tokens.series[2] },
  ]
  const data = daily.map((day) => ({
    date: day.date,
    cached: day.cachedInputTokens,
    uncached: Math.max(0, day.inputTokens - day.cachedInputTokens),
    output: day.outputTokens,
  }))
  return (
    <Panel title="Tokens over time" description="Uncached input includes cache writes.">
      <div className="flex flex-col gap-3">
        <ChartLegend items={series} />
        <StackedBars data={data} series={series} tokens={tokens} valueFormatter={formatTokens} tickFormatter={formatTokens} yWidth={44} />
      </div>
    </Panel>
  )
}
