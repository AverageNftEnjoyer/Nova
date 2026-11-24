"use client"

import Link from "next/link"
import { useState } from "react"
import { BarChart3 } from "lucide-react"

import { Button, EmptyState, Panel, Skeleton, Stat, StatGroup } from "@/components/ui"
import { cn } from "@/lib/shared/utils"
import type { HomeAnalyticsSummaryState, HomeUsageDay } from "../hooks/use-home-analytics-summary"
import { formatTokens, formatUsd } from "../format"

interface HomeUsageProps {
  usage: HomeAnalyticsSummaryState
}

function dayLabel(date: string, style: "short" | "long"): string {
  const [y, m, d] = date.split("-").map(Number)
  const value = new Date(y, (m || 1) - 1, d || 1)
  if (Number.isNaN(value.getTime())) return date
  return style === "short"
    ? value.toLocaleDateString(undefined, { weekday: "narrow" })
    : value.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}

/** Seven daily cost columns on one baseline, single series (the title names it), hover/focus for the exact day. */
function CostColumns({ days }: { days: HomeUsageDay[] }) {
  const [active, setActive] = useState<number | null>(null)
  const max = Math.max(...days.map((day) => day.costUsd), 0)
  const shown = active === null ? null : days[active]

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-4 items-baseline justify-between text-xs">
        <span className="text-muted">Daily spend</span>
        <span className="font-mono tabular-nums text-muted" aria-live="polite">
          {shown ? `${dayLabel(shown.date, "long")}  ${formatUsd(shown.costUsd)}  ${formatTokens(shown.tokens)} tok` : ""}
        </span>
      </div>
      <div className="relative" onPointerLeave={() => setActive(null)}>
        <div className="flex h-12 items-end gap-[2px] border-b border-border-subtle" aria-hidden>
          {days.map((day, index) => {
            const height = max > 0 ? Math.max((day.costUsd / max) * 100, day.costUsd > 0 ? 4 : 0) : 0
            return (
              <div
                key={day.date}
                className="flex h-full flex-1 items-end justify-center"
                onPointerEnter={() => setActive(index)}
              >
                <div
                  className={cn("w-full max-w-6 rounded-t-sm transition-opacity", active !== null && active !== index && "opacity-50")}
                  style={{ height: `${height}%`, background: "var(--chart-1)" }}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex gap-[2px]" aria-hidden>
          {days.map((day, index) => (
            <span
              key={day.date}
              className={cn("flex-1 text-center text-2xs", index === days.length - 1 ? "text-muted" : "text-faint")}
            >
              {dayLabel(day.date, "short")}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Spend per day, last 7 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Spend</th>
            <th scope="col">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{dayLabel(day.date, "long")}</td>
              <td>{formatUsd(day.costUsd)}</td>
              <td>{formatTokens(day.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Today and 7-day spend and tokens from the LLM usage ledger, plus agent-task budget alerts. */
export function HomeUsage({ usage }: HomeUsageProps) {
  const { summary, week, loading, error, refresh } = usage
  const budgetAlerts = summary ? summary.budgetWarning + summary.budgetExhausted : 0

  return (
    <Panel
      title="Usage"
      icon={<BarChart3 />}
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href="/analytics">Analytics</Link>
        </Button>
      }
      flush
    >
      {error && !summary ? (
        <EmptyState
          size="compact"
          tone="danger"
          title="Could not load usage"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={refresh}>
              Retry
            </Button>
          }
        />
      ) : loading && !summary ? (
        <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading usage">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : summary ? (
        <div className="flex flex-col gap-4 p-4">
          <StatGroup className="grid-flow-row grid-cols-2 divide-x-0 [&>*:nth-child(odd)]:border-r [&>*:nth-child(odd)]:border-border-subtle [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-border-subtle [&>*]:px-3 [&>*]:py-2.5">
            <Stat size="sm" label="Today" value={formatUsd(summary.costUsd)} hint={`${summary.calls.toLocaleString()} calls`} />
            <Stat size="sm" label="Last 7 days" value={week ? formatUsd(week.costUsd) : <Skeleton className="inline-block h-4 w-14" />} hint={week ? `${week.calls.toLocaleString()} calls` : undefined} />
            <Stat size="sm" label="Tokens today" value={formatTokens(summary.tokens)} hint={`${Math.round(summary.cacheHitRate * 100)}% cached input`} />
            <Stat size="sm" label="Tokens, 7 days" value={week ? formatTokens(week.tokens) : <Skeleton className="inline-block h-4 w-12" />} />
          </StatGroup>
          {week && week.days.length > 1 && week.days.some((day) => day.costUsd > 0) ? <CostColumns days={week.days} /> : null}
          <div className="flex flex-col gap-1 text-xs">
            {budgetAlerts > 0 ? (
              <Link href="/analytics#budgets" className="text-warning hover:underline">
                {summary.budgetExhausted > 0
                  ? `${summary.budgetExhausted} ${summary.budgetExhausted === 1 ? "task has" : "tasks have"} spent its budget`
                  : `${summary.budgetWarning} ${summary.budgetWarning === 1 ? "task is" : "tasks are"} close to its budget`}
              </Link>
            ) : (
              <span className="text-muted">All agent tasks are within budget.</span>
            )}
            {summary.unpricedCalls > 0 ? (
              <span className="text-faint">
                {summary.unpricedCalls} {summary.unpricedCalls === 1 ? "call" : "calls"} today used a model without a known price.
              </span>
            ) : null}
            {error ? <span className="text-danger">Last refresh failed: {error}</span> : null}
          </div>
        </div>
      ) : null}
    </Panel>
  )
}
