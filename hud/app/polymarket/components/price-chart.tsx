"use client"

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { ChartTooltip, axisTick, useChartTokens } from "@/app/analytics/components/chart-kit"
import { EmptyState, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/ui"
import type { PolymarketPricePoint } from "@/lib/integrations/polymarket/api"
import { cn } from "@/lib/shared/utils"

import { formatPreciseCents, formatSignedPct } from "../lib/format"

export type PriceChartRange = "1h" | "6h" | "1d" | "1w" | "1m" | "all"

const RANGES: Array<{ id: PriceChartRange; label: string }> = [
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "1d", label: "1d" },
  { id: "1w", label: "1w" },
  { id: "1m", label: "1m" },
  { id: "all", label: "All" },
]

interface PriceChartProps {
  points: PolymarketPricePoint[]
  range: PriceChartRange
  onRangeChange: (range: PriceChartRange) => void
  outcomeLabel: string
  loading: boolean
  error: string
}

function formatTick(ts: number, range: PriceChartRange): string {
  const date = new Date(ts)
  if (range === "1h" || range === "6h" || range === "1d") return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  if (range === "1w" || range === "1m") return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
}

function formatTooltipTime(value: unknown): string {
  const ts = Number(value)
  if (!Number.isFinite(ts)) return ""
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Price history of the selected outcome (0-100c), with a crosshair tooltip and the change over the range. */
export function PriceChart({ points, range, onRangeChange, outcomeLabel, loading, error }: PriceChartProps) {
  const tokens = useChartTokens()
  const first = points[0]?.p ?? 0
  const last = points[points.length - 1]?.p ?? 0
  const change = first > 0 ? ((last - first) / first) * 100 : 0
  const data = points.map((point) => ({ t: point.t, p: point.p }))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xl tabular-nums text-fg">{points.length > 0 ? formatPreciseCents(last) : "None"}</span>
          {points.length > 1 ? (
            <span className={cn("font-mono text-xs tabular-nums", change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-muted")}>
              {formatSignedPct(change)}
            </span>
          ) : null}
          <span className="text-xs text-muted">{outcomeLabel}</span>
        </div>
        <Tabs value={range} onValueChange={(value) => onRangeChange(value as PriceChartRange)} variant="segmented">
          <TabsList aria-label="Chart range">
            {RANGES.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full rounded-md" />
      ) : error ? (
        <EmptyState size="compact" tone="danger" title="Price history did not load" description={error} />
      ) : points.length < 2 ? (
        <EmptyState size="compact" title="No price history for this range" description="Pick a longer range, or another outcome." />
      ) : (
        <ResponsiveContainer width="100%" height={192}>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={tokens.grid} vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tick={axisTick(tokens)}
              tickFormatter={(value: number) => formatTick(value, range)}
              axisLine={{ stroke: tokens.axis }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[(min: number) => Math.max(0, Math.floor(min * 20) / 20), (max: number) => Math.min(1, Math.ceil(max * 20) / 20)]}
              tick={axisTick(tokens)}
              tickFormatter={(value: number) => `${Math.round(value * 100)}c`}
              width={36}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: tokens.axis }}
              isAnimationActive={false}
              content={({ active, payload, label }) => (
                <ChartTooltip active={active} payload={payload} label={label} formatLabel={formatTooltipTime} formatValue={formatPreciseCents} />
              )}
            />
            <Line
              type="monotone"
              dataKey="p"
              name={outcomeLabel || "Price"}
              stroke={tokens.series[0]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: tokens.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
