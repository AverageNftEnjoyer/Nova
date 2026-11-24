"use client"

import Link from "next/link"

import { Badge, Button, EmptyState, Panel, SectionHeader, Table, TBody, Td, Th, THead, Tr, type BadgeProps } from "@/components/ui"
import { openSettings } from "@/components/shell"
import { AGENT_TASK_TERMINAL, type AgentTaskBudgetState } from "@/lib/agents/types"
import type { BudgetAnalytics, BudgetEventKind, BudgetEventRow, BudgetTaskRow } from "@/lib/analytics/types"
import { cn } from "@/lib/shared/utils"

import { formatDateTime, formatPercent, formatRelative, formatTokens, formatUsd, providerLabel } from "../lib/format"

type Tone = NonNullable<BadgeProps["tone"]>

const STATE_META: Record<AgentTaskBudgetState, { label: string; tone: Tone }> = {
  ok: { label: "Within budget", tone: "neutral" },
  warning: { label: "Warning", tone: "warning" },
  degraded: { label: "Economy model", tone: "warning" },
  exhausted: { label: "Exhausted", tone: "danger" },
}

const EVENT_META: Record<BudgetEventKind, { label: string; tone: Tone }> = {
  warning: { label: "Warning", tone: "warning" },
  degraded: { label: "Economy model", tone: "warning" },
  exhausted: { label: "Exhausted", tone: "danger" },
  raised: { label: "Budget raised", tone: "info" },
}

function spendText(spentUsd: number, spentTokens: number, costBudgetUsd: number | null, tokenBudget: number | null): string {
  const parts: string[] = []
  if (costBudgetUsd !== null) parts.push(`${formatUsd(spentUsd)} of ${formatUsd(costBudgetUsd)}`)
  if (tokenBudget !== null) parts.push(`${formatTokens(spentTokens)} of ${formatTokens(tokenBudget)} tokens`)
  if (parts.length === 0) parts.push(`${formatUsd(spentUsd)}, ${formatTokens(spentTokens)} tokens, no limit`)
  return parts.join(", ")
}

function meterTone(state: AgentTaskBudgetState): string {
  if (state === "exhausted") return "bg-danger"
  if (state === "warning" || state === "degraded") return "bg-warning"
  return "bg-accent"
}

function BudgetRows({ rows, showUpdated }: { rows: BudgetTaskRow[]; showUpdated: boolean }) {
  return (
    <Table density="compact">
      <THead>
        <tr>
          <Th>Task</Th>
          <Th>State</Th>
          <Th>Spend</Th>
          <Th numeric>Used</Th>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => {
          const finished = AGENT_TASK_TERMINAL.includes(row.status)
          const meta = STATE_META[row.budgetState]
          const pct = Math.min(1, Math.max(0, row.fraction)) * 100
          return (
            <Tr key={row.id} className={cn(finished && "text-muted")}>
              <Td className="max-w-[16rem]">
                <Link href={`/runs?run=${encodeURIComponent(row.id)}`} className="block truncate font-medium text-fg hover:underline" title={row.name}>
                  {row.name || "Untitled task"}
                </Link>
                <span className="block truncate text-xs text-muted">
                  <span className="font-mono">{row.model || "default model"}</span>
                  {`, ${providerLabel(row.provider)}`}
                  {row.pauseReason === "budget" ? ", paused by budget" : finished ? `, ${row.status}` : ""}
                  {showUpdated ? `, ${formatRelative(row.updatedAt)}` : ""}
                </span>
              </Td>
              <Td>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </Td>
              <Td className="min-w-[10rem]">
                <div
                  className="h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-3"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(pct)}
                  aria-label={`${row.name} budget used`}
                >
                  <div className={cn("h-full rounded-[2px]", meterTone(row.budgetState))} style={{ width: `${pct}%` }} />
                </div>
                <span className="mt-1 block font-mono text-2xs tabular-nums text-muted">
                  {spendText(row.spentUsd, row.spentTokens, row.costBudgetUsd, row.tokenBudget)}
                </span>
              </Td>
              <Td numeric mono>{formatPercent(row.fraction)}</Td>
            </Tr>
          )
        })}
      </TBody>
    </Table>
  )
}

function HistoryRow({ event }: { event: BudgetEventRow }) {
  const meta = EVENT_META[event.kind]
  const deleted = event.taskName === null
  const detail =
    event.kind === "degraded" && event.economyModel
      ? `Switched to ${event.economyModel}`
      : event.kind === "raised"
        ? "Raised by you"
        : event.model
  return (
    <Tr>
      <Td mono muted className="whitespace-nowrap">
        <time dateTime={event.ts} title={new Date(event.ts).toLocaleString()}>
          {formatDateTime(event.ts)}
        </time>
      </Td>
      <Td>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </Td>
      <Td className="max-w-[18rem]">
        <span className={cn("block truncate", deleted ? "italic text-muted" : "text-fg")} title={deleted ? `Deleted task (${event.taskId})` : event.taskName ?? ""}>
          {deleted ? "Deleted task" : event.taskName || "Untitled task"}
        </span>
        {detail ? <span className="block truncate font-mono text-2xs text-muted">{detail}</span> : null}
      </Td>
      <Td mono muted className="whitespace-nowrap text-right">
        {spendText(event.spentUsd, event.spentTokens, event.costBudgetUsd, event.tokenBudget)}
        {event.fraction > 0 ? `, ${formatPercent(event.fraction)}` : ""}
      </Td>
    </Tr>
  )
}

export function BudgetSection({ budgets, rangeLabel }: { budgets: BudgetAnalytics; rangeLabel: string }) {
  const defaults = [
    budgets.defaults.costBudgetUsd !== null ? formatUsd(budgets.defaults.costBudgetUsd) : null,
    budgets.defaults.tokenBudget !== null ? `${formatTokens(budgets.defaults.tokenBudget)} tokens` : null,
  ].filter(Boolean)

  return (
    <section id="budgets" className="flex scroll-mt-6 flex-col gap-4" aria-labelledby="budgets-heading">
      <SectionHeader
        title={<span id="budgets-heading">Agent task budgets</span>}
        description={`Default budget per task: ${defaults.length > 0 ? defaults.join(" and ") : "none"}. Resume a paused task or raise its budget from Runs.`}
        actions={
          <>
            <Badge tone={budgets.counts.warning > 0 ? "warning" : "neutral"}>{budgets.counts.warning} warning</Badge>
            <Badge tone={budgets.counts.degraded > 0 ? "warning" : "neutral"}>{budgets.counts.degraded} economy</Badge>
            <Badge tone={budgets.counts.exhausted > 0 ? "danger" : "neutral"}>{budgets.counts.exhausted} exhausted</Badge>
            <Button variant="outline" size="sm" onClick={() => openSettings("agent-budgets")}>
              Budget settings
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/runs">Open runs</Link>
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Tasks with a budget" description="Highest share of budget used first." flush>
          {budgets.tasks.length > 0 ? (
            <div className="max-h-[26rem] overflow-y-auto">
              <BudgetRows rows={budgets.tasks} showUpdated={false} />
            </div>
          ) : (
            <EmptyState size="compact" title="No task has a budget" description="Set a default in Settings, or a budget when you deploy a task." />
          )}
        </Panel>
        <Panel title="Budget alerts" description="Tasks near or over budget, most recently updated first." flush>
          {budgets.alerts.length > 0 ? (
            <div className="max-h-[26rem] overflow-y-auto">
              <BudgetRows rows={budgets.alerts} showUpdated />
            </div>
          ) : (
            <EmptyState size="compact" title="No budget alerts" description="Tasks that cross 80% of their budget show up here." />
          )}
        </Panel>
      </div>
      <Panel
        title="Budget history"
        description={`Warnings, economy switches, stops and raises for ${rangeLabel}, newest first${budgets.historyTruncated ? ` (latest ${budgets.history.length} shown)` : ""}. Spend is as it was at that moment.`}
        flush
      >
        {budgets.history.length > 0 ? (
          <div className="max-h-[26rem] overflow-y-auto">
            <Table density="compact" stickyHeader>
              <THead>
                <tr>
                  <Th>When</Th>
                  <Th>Event</Th>
                  <Th>Task</Th>
                  <Th numeric>Spend</Th>
                </tr>
              </THead>
              <TBody>
                {budgets.history.map((event) => (
                  <HistoryRow key={event.id} event={event} />
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          <EmptyState size="compact" title={`No budget events for ${rangeLabel}`} description="Events appear when a task nears, hits or raises its budget." />
        )}
      </Panel>
    </section>
  )
}
