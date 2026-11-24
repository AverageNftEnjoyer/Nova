"use client"

import { Badge, Table, TBody, Td, Th, THead, Tr } from "@/components/ui"
import { BudgetBar, BudgetStateBadge, budgetReadout, taskBudgetView } from "@/components/agents/budget"
import { formatDuration, formatRelative, formatTokens, formatUsd } from "@/components/agents/run-format"
import type { RunActionKind } from "../hooks/use-run-actions"
import type { RunRow } from "../lib/run-rows"
import { RunRowActions } from "./run-row-actions"
import { RunStatusBadge } from "./run-status-badge"

interface RunsTableProps {
  rows: RunRow[]
  now: number
  selectedId: string
  busyId: string
  onOpen: (row: RunRow) => void
  onAction: (row: RunRow, action: RunActionKind) => void
  onRaiseBudget: (row: RunRow) => void
}

const KIND_LABEL = { task: "Task", automation: "Automation" } as const

function CostCell({ row }: { row: RunRow }) {
  if (!row.task) {
    const limit = row.run?.costBudgetUsd ?? null
    return <span className="font-mono text-xs text-faint">{limit !== null ? `budget ${formatUsd(limit)}` : "Not metered"}</span>
  }
  const view = taskBudgetView(row.task)
  return (
    <div className="flex min-w-0 flex-col items-end gap-1 py-1.5">
      <span className="whitespace-nowrap font-mono text-xs tabular-nums text-fg">{view.active ? budgetReadout(view) : formatUsd(view.spentUsd)}</span>
      {view.active ? (
        <div className="flex w-full items-center justify-end gap-1.5">
          <BudgetStateBadge state={row.budgetState} economyModel={view.economyModel} />
          <BudgetBar view={view} className="w-full max-w-24" />
        </div>
      ) : null}
    </div>
  )
}

/** Every run, newest first. Click a row (or its name) for the detail sheet. */
export function RunsTable({ rows, now, selectedId, busyId, onOpen, onAction, onRaiseBudget }: RunsTableProps) {
  return (
    <Table aria-label="Runs" stickyHeader className="table-fixed">
      <THead>
        <tr>
          <Th className="w-32">Status</Th>
          <Th>Name</Th>
          <Th className="hidden w-[16%] xl:table-cell">Deployment</Th>
          <Th className="w-24">Kind</Th>
          <Th className="w-32">Started</Th>
          <Th className="hidden w-40 xl:table-cell">Model</Th>
          <Th numeric className="w-20">Tokens</Th>
          <Th numeric className="w-40">Cost and budget</Th>
          <Th className="w-40">
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => {
          const started = row.startedAt ?? row.createdAt
          const duration = row.startedAt ? formatDuration(row.startedAt, row.finishedAt, now) : ""
          const tokens = row.task ? row.task.tokensIn + row.task.tokensOut : null
          return (
            <Tr key={row.id} interactive selected={row.id === selectedId} onClick={() => onOpen(row)}>
              <Td>
                <RunStatusBadge phase={row.phase} />
              </Td>
              <Td className="truncate">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpen(row)
                  }}
                  className="max-w-full truncate rounded-sm text-left font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  title={row.name}
                >
                  {row.name}
                </button>
              </Td>
              <Td muted className="hidden truncate xl:table-cell">
                {row.deployment ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{row.deployment.title}</span>
                    <Badge mono variant="outline">{`v${row.run?.deploymentRevision ?? row.deployment.revision}`}</Badge>
                  </span>
                ) : (
                  <span className="text-faint">Direct task</span>
                )}
              </Td>
              <Td muted>{KIND_LABEL[row.kind]}</Td>
              <Td mono muted className="truncate" title={new Date(started).toLocaleString()}>
                {formatRelative(started, now)}
                {duration ? <span className="ml-2 text-faint">{duration}</span> : null}
              </Td>
              <Td mono muted className="hidden truncate xl:table-cell" title={row.model ?? undefined}>
                {row.model ?? <span className="text-faint">Default</span>}
              </Td>
              <Td numeric mono muted>
                {tokens !== null ? formatTokens(tokens) : <span className="text-faint">-</span>}
              </Td>
              <Td numeric>
                <CostCell row={row} />
              </Td>
              <Td>
                <RunRowActions row={row} busy={busyId === row.id} onAction={onAction} onRaiseBudget={onRaiseBudget} />
              </Td>
            </Tr>
          )
        })}
      </TBody>
    </Table>
  )
}
