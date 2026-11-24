"use client"

import { Badge, Panel } from "@/components/ui"
import { budgetReadout, taskBudgetView } from "@/components/agents/budget"
import { formatRelative, formatUsd } from "@/components/agents/run-format"
import type { RunActionKind } from "../hooks/use-run-actions"
import type { RunRow } from "../lib/run-rows"
import { RunRowActions } from "./run-row-actions"

interface WaitingForYouProps {
  rows: RunRow[]
  now: number
  busyId: string
  onOpen: (row: RunRow, withRaise?: boolean) => void
  onAction: (row: RunRow, action: RunActionKind) => void
}

/** One line on what the run is asking for. */
function askOf(row: RunRow): string {
  if (row.phase === "review") {
    const plan = row.deployment?.plan
    if (!plan) return "Plan needs your review before it runs"
    const estimate = plan.budgetEstimate.costUsd !== null ? `, about ${formatUsd(plan.budgetEstimate.costUsd)}` : ""
    return `Plan needs review: ${plan.risk} risk${estimate}`
  }
  if (row.phase === "approval" && row.task?.pendingApproval) {
    return `Wants to run ${row.task.pendingApproval.toolName}: ${row.task.pendingApproval.reason}`
  }
  if (row.task) return `Paused on budget at ${budgetReadout(taskBudgetView(row.task))}`
  return "Paused on budget"
}

/** Runs blocked on the user, above everything else on /runs. */
export function WaitingForYou({ rows, now, busyId, onOpen, onAction }: WaitingForYouProps) {
  return (
    <Panel title="Waiting for you" flush actions={<Badge tone="warning">{rows.length}</Badge>} className="border-warning/40">
      <ul className="divide-y divide-border-subtle">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="max-w-full truncate rounded-sm text-left text-sm font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {row.name}
              </button>
              <p className="truncate text-xs text-muted" title={askOf(row)}>
                {askOf(row)}
              </p>
            </div>
            <span className="hidden shrink-0 font-mono text-xs tabular-nums text-faint lg:inline">{formatRelative(row.createdAt, now)}</span>
            <RunRowActions row={row} busy={busyId === row.id} onAction={onAction} onRaiseBudget={(target) => onOpen(target, true)} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}
