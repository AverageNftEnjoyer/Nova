"use client"

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { EmptyState, Panel, SectionHeader, Stat, StatGroup, Table, TBody, Td, Th, THead, Tr } from "@/components/ui"
import type { AnalyticsData, TaskDailyStats } from "@/lib/analytics/types"

import { ChartLegend, ChartTooltip, axisTick, type ChartTokens } from "./chart-kit"
import { providerColor } from "./usage-charts"
import { formatCount, formatDayLong, formatDayShort, formatTokens, formatUsd, formatUsdTick, providerLabel } from "../lib/format"

const CHART_HEIGHT = 220

export function AgentTaskSection({ analytics, timeline, tokens }: { analytics: AnalyticsData; timeline: TaskDailyStats[]; tokens: ChartTokens }) {
  const hasTasks = analytics.totalTasks > 0
  const providerRows = Object.entries(analytics.byProvider).sort(([, a], [, b]) => b.totalCost - a.totalCost)
  const lines = [
    { key: "totalTasks", label: "All tasks", color: tokens.series[0] },
    { key: "successfulTasks", label: "Succeeded", color: tokens.success },
    { key: "failedTasks", label: "Failed", color: tokens.danger },
  ]

  return (
    <section className="flex flex-col gap-4" aria-labelledby="agent-tasks-heading">
      <SectionHeader
        title={<span id="agent-tasks-heading">Agent tasks</span>}
        description="Task counts and cost from the agent task store, across all time."
      />
      <StatGroup>
        <Stat label="Tasks" value={formatCount(analytics.totalTasks)} hint={`${analytics.todayTasks} today, ${analytics.weekTasks} this week`} />
        <Stat label="Task cost" value={formatUsd(analytics.totalCost)} hint={`${formatUsd(analytics.averageCostPerTask)} per task on average`} />
        <Stat label="Success rate" value={hasTasks ? `${analytics.successRate.toFixed(1)}%` : "None"} hint="Completed successfully" />
        <Stat
          label="Task tokens"
          value={formatTokens(analytics.totalTokensIn + analytics.totalTokensOut)}
          hint={`${formatTokens(analytics.totalTokensIn)} in, ${formatTokens(analytics.totalTokensOut)} out`}
        />
      </StatGroup>

      {!hasTasks ? (
        <Panel>
          <EmptyState size="compact" title="No agent tasks yet" description="Tasks you deploy show their counts and cost here." />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Tasks per day" description="Started per local day, by outcome.">
              <div className="flex flex-col gap-3">
                <ChartLegend items={lines} />
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <LineChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={tokens.grid} vertical={false} />
                    <XAxis dataKey="date" tick={axisTick(tokens)} tickFormatter={formatDayShort} axisLine={{ stroke: tokens.axis }} tickLine={false} minTickGap={16} />
                    <YAxis tick={axisTick(tokens)} allowDecimals={false} width={32} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ stroke: tokens.axis }}
                      isAnimationActive={false}
                      content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} formatLabel={formatDayLong} formatValue={formatCount} />}
                    />
                    {lines.map((line) => (
                      <Line
                        key={line.key}
                        type="monotone"
                        dataKey={line.key}
                        name={line.label}
                        stroke={line.color}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, stroke: tokens.surface, strokeWidth: 2 }}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Task cost per day" description="Cost recorded on agent tasks.">
              <ResponsiveContainer width="100%" height={CHART_HEIGHT + 28}>
                <BarChart data={timeline} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
                  <CartesianGrid stroke={tokens.grid} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick(tokens)} tickFormatter={formatDayShort} axisLine={{ stroke: tokens.axis }} tickLine={false} minTickGap={16} />
                  <YAxis tick={axisTick(tokens)} tickFormatter={formatUsdTick} width={60} axisLine={false} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: tokens.grid, opacity: 0.6 }}
                    isAnimationActive={false}
                    content={({ active, payload, label }) => <ChartTooltip active={active} payload={payload} label={label} formatLabel={formatDayLong} formatValue={formatUsd} />}
                  />
                  <Bar dataKey="totalCost" name="Cost" fill={tokens.series[0]} maxBarSize={28} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel title="Task models by cost" flush>
              <Table density="compact">
                <THead>
                  <tr>
                    <Th>Model</Th>
                    <Th>Provider</Th>
                    <Th numeric>Tasks</Th>
                    <Th numeric>Input</Th>
                    <Th numeric>Output</Th>
                    <Th numeric>Cost</Th>
                  </tr>
                </THead>
                <TBody>
                  {analytics.byModel.slice(0, 10).map((model, index) => (
                    <Tr key={`${model.provider}-${model.model}-${index}`}>
                      <Td mono className="max-w-[20rem]">
                        <span className="block truncate" title={model.model}>
                          {model.model || "default model"}
                        </span>
                      </Td>
                      <Td muted>{providerLabel(model.provider)}</Td>
                      <Td numeric mono>{formatCount(model.taskCount)}</Td>
                      <Td numeric mono>{formatTokens(model.tokensIn)}</Td>
                      <Td numeric mono>{formatTokens(model.tokensOut)}</Td>
                      <Td numeric mono>{formatUsd(model.totalCost)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Panel>
            <Panel title="Tasks by provider" flush>
              <Table density="compact">
                <THead>
                  <tr>
                    <Th>Provider</Th>
                    <Th numeric>Tasks</Th>
                    <Th numeric>Succeeded</Th>
                    <Th numeric>Cost</Th>
                  </tr>
                </THead>
                <TBody>
                  {providerRows.map(([provider, stats]) => (
                    <Tr key={provider || "unknown"}>
                      <Td className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden className="size-2 rounded-[2px]" style={{ backgroundColor: providerColor(tokens, provider) }} />
                          {providerLabel(provider)}
                        </span>
                      </Td>
                      <Td numeric mono>{formatCount(stats.taskCount)}</Td>
                      <Td numeric mono muted>{formatCount(stats.successCount)}</Td>
                      <Td numeric mono>{formatUsd(stats.totalCost)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </Panel>
          </div>
        </>
      )}
    </section>
  )
}
