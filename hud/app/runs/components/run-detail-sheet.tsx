"use client"

import Link from "next/link"
import { ShieldAlert } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"

import { Badge, Button, Separator, Sheet, Spinner, Stat, StatGroup } from "@/components/ui"
import {
  BUDGET_STATE_META,
  BudgetBar,
  BudgetStateBadge,
  UNPRICED_HINT,
  budgetReadout,
  taskBudgetView,
} from "@/components/agents/budget"
import { PERMISSION_MODE_LABELS } from "@/components/agents/permission-modes"
import { RaiseBudgetForm } from "@/components/agents/raise-budget-form"
import { formatDateTime, formatDuration, formatRelative, formatTokens, formatUsd } from "@/components/agents/run-format"
import type { ActionResult } from "@/app/deployments/hooks/use-deployments-data"
import type { BudgetEventRow, AnalyticsResponse } from "@/lib/analytics/types"
import type { RaiseAgentTaskBudgetInput } from "@/lib/agents/types"
import type { DeploymentEvent } from "@/lib/deployments/types"
import { RUN_ACTION_LABEL, availableActions, canRaiseBudget, type RunActionKind } from "../hooks/use-run-actions"
import { needsAttention, type RunRow } from "../lib/run-rows"
import { RunStatusBadge } from "./run-status-badge"

interface RunDetailSheetProps {
  row: RunRow | null
  /** The id from the URL that matched nothing (yet): shows a loading or not-found state instead of closing. */
  missingId: string
  loading: boolean
  events: DeploymentEvent[]
  now: number
  busy: boolean
  raiseOpen: boolean
  onRaiseOpenChange: (open: boolean) => void
  onClose: () => void
  onAction: (row: RunRow, action: RunActionKind) => void
  onRaiseBudget: (row: RunRow, input: RaiseAgentTaskBudgetInput) => Promise<ActionResult>
}

const EVENT_LABEL: Record<string, string> = {
  "deployment.run.created": "Run created",
  "deployment.run.approval_required": "Waiting for review",
  "deployment.run.approved": "Approved",
  "deployment.run.denied": "Denied",
  "deployment.run.task_queued": "Agent task queued",
  "deployment.run.automation_queued": "Automation queued",
  "deployment.run.pending": "Pending",
  "deployment.run.queued": "Queued",
  "deployment.run.running": "Started running",
  "deployment.run.paused": "Paused",
  "deployment.run.resumed": "Resumed",
  "deployment.run.succeeded": "Completed",
  "deployment.run.failed": "Failed",
  "deployment.run.dead": "Failed for good",
  "deployment.run.cancelled": "Cancelled",
  "deployment.run.budget_updated": "Budget raised",
}

const BUDGET_EVENT_LABEL: Record<BudgetEventRow["kind"], string> = {
  warning: "Reached 80% of budget",
  degraded: "Switched to the economy model",
  exhausted: "Budget spent, paused",
  raised: "Budget raised",
}

const KIND_LABEL = { task: "Agent task", automation: "Automation" } as const

function eventDetail(event: DeploymentEvent): string {
  const data = event.data ?? {}
  if (typeof data.error === "string" && data.error) return data.error
  if (typeof data.risk === "string") return `${data.risk} risk plan`
  if (event.type === "deployment.run.budget_updated") {
    const parts: string[] = []
    if (typeof data.costBudgetUsd === "number") parts.push(`cost ${formatUsd(data.costBudgetUsd)}`)
    if (typeof data.tokenBudget === "number") parts.push(`${formatTokens(data.tokenBudget)} tokens`)
    return parts.join(", ")
  }
  return ""
}

/** Budget history of one agent task, from the analytics ledger. Loaded when the sheet opens on a task-backed run. */
function useBudgetHistory(taskId: string | null): { history: BudgetEventRow[]; loading: boolean } {
  const [state, setState] = useState<{ taskId: string; history: BudgetEventRow[] } | null>(null)
  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    fetch(`/api/analytics?days=90&tz=${encodeURIComponent(timeZone)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<AnalyticsResponse>)
      .then((data) => {
        if (cancelled) return
        const history = data.analytics?.budgets?.history ?? []
        setState({ taskId, history: history.filter((entry) => entry.taskId === taskId) })
      })
      .catch(() => {
        if (!cancelled) setState({ taskId, history: [] })
      })
    return () => {
      cancelled = true
    }
  }, [taskId])
  if (!taskId) return { history: [], loading: false }
  return { history: state?.taskId === taskId ? state.history : [], loading: state?.taskId !== taskId }
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-fg">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

interface DetailItem {
  label: string
  value: ReactNode
  mono?: boolean
}

function detailItems(row: RunRow): DetailItem[] {
  const { run, task } = row
  const items: DetailItem[] = []
  if (run) items.push({ label: "Run", value: run.id, mono: true })
  if (task) items.push({ label: "Agent task", value: task.id, mono: true })
  if (run?.jobRunId) items.push({ label: "Job run", value: run.jobRunId, mono: true })
  if (run && row.deployment) items.push({ label: "Revision", value: `v${run.deploymentRevision}`, mono: true })
  if (task) {
    items.push(
      { label: "Provider", value: task.agent },
      { label: "Model", value: task.model, mono: true },
      { label: "Priority", value: task.priority },
      { label: "Permission mode", value: PERMISSION_MODE_LABELS[task.permissionMode] },
    )
  } else if (row.model) {
    items.push({ label: "Model", value: row.model, mono: true })
  }
  if (task?.contextId) items.push({ label: "Context", value: task.contextId, mono: true })
  if (task?.branchName) items.push({ label: "Branch", value: task.branchName, mono: true })
  if (task?.worktreePath) items.push({ label: "Worktree", value: task.worktreePath, mono: true })
  if (task?.attachedFiles?.length) items.push({ label: "Files", value: task.attachedFiles.join("\n"), mono: true })
  items.push({ label: "Created", value: formatDateTime(row.createdAt) })
  if (row.finishedAt) items.push({ label: "Finished", value: formatDateTime(row.finishedAt) })
  return items
}

function DetailList({ items }: { items: DetailItem[] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(({ label, value, mono }) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className={mono ? "min-w-0 whitespace-pre-wrap break-all font-mono text-xs leading-5 text-fg" : "min-w-0 text-fg"}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Everything about one run: what it is waiting for, budget, output, errors, tool calls, timeline and identifiers. */
export function RunDetailSheet({
  row,
  missingId,
  loading,
  events,
  now,
  busy,
  raiseOpen,
  onRaiseOpenChange,
  onClose,
  onAction,
  onRaiseBudget,
}: RunDetailSheetProps) {
  const open = Boolean(row || missingId)
  const task = row?.task ?? null
  const run = row?.run ?? null
  const { history, loading: historyLoading } = useBudgetHistory(open ? task?.id ?? null : null)
  const runEvents = useMemo(() => (run ? events.filter((event) => event.runId === run.id) : []), [events, run])

  if (!row) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && onClose()} title={loading ? "Loading run" : "Run not found"} size="lg">
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          {loading ? (
            <Spinner />
          ) : (
            <>
              <p className="text-md font-medium text-fg">This run is not in your list</p>
              <p className="max-w-sm text-sm text-muted">It may have been deleted, or the link is from another account.</p>
              <Button variant="outline" size="sm" onClick={onClose}>
                Back to all runs
              </Button>
            </>
          )}
        </div>
      </Sheet>
    )
  }

  const view = task ? taskBudgetView(task) : null
  const actions = availableActions(row)
  const raisable = canRaiseBudget(row)
  const plan = row.deployment?.plan ?? null
  const failedEvent = [...runEvents].reverse().find((event) => typeof event.data?.error === "string")
  const errorText = task?.error && row.phase !== "budget" ? task.error : !task && failedEvent ? String(failedEvent.data.error) : ""
  const permissionMode = task?.permissionMode ?? run?.permissionMode ?? "default"
  const destructive = new Set<RunActionKind>(["delete", "cancel", "deny", "deny-tool"])

  const footer = (
    <>
      {actions
        .filter((action) => destructive.has(action))
        .map((action) => (
          <Button key={action} variant="ghost" size="md" disabled={busy} onClick={() => onAction(row, action)} className="first:mr-auto">
            {RUN_ACTION_LABEL[action]}
          </Button>
        ))}
      {raisable && !raiseOpen ? (
        <Button variant="outline" disabled={busy} onClick={() => onRaiseOpenChange(true)}>
          Raise budget
        </Button>
      ) : null}
      {actions
        .filter((action) => !destructive.has(action))
        .map((action, index, list) => (
          <Button
            key={action}
            variant={index === list.length - 1 ? "primary" : "secondary"}
            loading={busy && index === list.length - 1}
            disabled={busy}
            onClick={() => onAction(row, action)}
          >
            {RUN_ACTION_LABEL[action]}
          </Button>
        ))}
    </>
  )

  return (
    <Sheet
      open
      onOpenChange={(next) => !next && onClose()}
      title={row.name}
      description={
        row.deployment ? (
          <>
            {KIND_LABEL[row.kind]} from{" "}
            <Link href={`/deployments?deployment=${encodeURIComponent(row.deployment.id)}`} className="text-accent-text hover:underline">
              {row.deployment.title}
            </Link>
          </>
        ) : (
          "Agent task started directly. It appears under a deployment once it finishes."
        )
      }
      size="lg"
      footer={actions.length > 0 || raisable ? footer : undefined}
    >
      <div className="flex flex-col gap-6 px-4 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <RunStatusBadge phase={row.phase} />
          {view ? <BudgetStateBadge state={row.budgetState} economyModel={view.economyModel} /> : null}
          {permissionMode !== "default" ? (
            <Badge tone={permissionMode === "bypass" ? "danger" : "neutral"} variant="outline">
              {permissionMode === "bypass" ? <ShieldAlert /> : null}
              {PERMISSION_MODE_LABELS[permissionMode]}
            </Badge>
          ) : null}
        </div>

        {needsAttention(row) ? (
          <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-muted px-3.5 py-3 text-sm">
            {row.phase === "review" ? (
              <>
                <p className="font-medium text-fg">This deployment asks for your review before it runs.</p>
                {plan ? (
                  <p className="text-muted">
                    {plan.risk[0].toUpperCase() + plan.risk.slice(1)} risk.{" "}
                    {plan.budgetEstimate.costUsd !== null ? `Estimated cost about ${formatUsd(plan.budgetEstimate.costUsd)}. ` : ""}
                    {plan.rationale}
                  </p>
                ) : null}
                {plan && plan.acceptanceCriteria.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-5 text-muted">
                    {plan.acceptanceCriteria.map((criterion) => (
                      <li key={criterion}>{criterion}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : row.phase === "approval" && task?.pendingApproval ? (
              <>
                <p className="font-medium text-fg">
                  Wants to run <span className="font-mono text-xs">{task.pendingApproval.toolName}</span>
                </p>
                <p className="text-muted">{task.pendingApproval.reason}</p>
                <p className="text-xs text-muted">
                  Approval expires {formatRelative(task.pendingApproval.expiresAt, now)}. Deny stops the run.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-fg">Paused before a model call that would go over budget.</p>
                <p className="text-muted">
                  {view && view.fraction < 1
                    ? "Resume re-runs the task from the start. Steps that already had side effects are not repeated."
                    : "Its budget is spent. Raise the budget to resume; the task restarts and side effects are not repeated."}
                </p>
              </>
            )}
          </div>
        ) : null}

        <StatGroup>
          <Stat size="sm" label="Started" value={formatRelative(row.startedAt ?? row.createdAt, now) || "-"} hint={formatDateTime(row.startedAt ?? row.createdAt)} />
          <Stat size="sm" label="Duration" value={row.startedAt ? formatDuration(row.startedAt, row.finishedAt, now) : "-"} />
          <Stat size="sm" label="Tokens" value={task ? formatTokens(task.tokensIn + task.tokensOut) : "-"} hint={task && task.cachedInputTokens > 0 ? `${formatTokens(task.cachedInputTokens)} cached` : undefined} />
          <Stat size="sm" label="Cost" value={task ? formatUsd(view?.spentUsd ?? task.costUsd) : "-"} />
        </StatGroup>

        {view ? (
          <Section title="Budget" aside={<span className="font-mono text-xs tabular-nums text-muted">{view.active ? budgetReadout(view) : "No limit"}</span>}>
            {view.active ? <BudgetBar view={view} /> : null}
            <p className="text-xs text-muted">
              {view.active ? BUDGET_STATE_META[view.state].hint : "No budget applies to this run."}
              {view.economyModel && view.state === "degraded" ? ` Now using ${view.economyModel}.` : ""}
            </p>
            {view.costBlind ? <p className="text-xs text-warning">Unpriced model: the cost budget cannot stop it. {UNPRICED_HINT}</p> : null}
            {raiseOpen && raisable ? (
              <div className="rounded-lg border border-border bg-surface-2 p-3">
                <RaiseBudgetForm
                  limitUsd={view.limitUsd}
                  limitTokens={view.limitTokens}
                  spentUsd={view.spentUsd}
                  spentTokens={view.spentTokens}
                  resumes={row.phase === "budget"}
                  onCancel={() => onRaiseOpenChange(false)}
                  onSubmit={async (input) => {
                    const result = await onRaiseBudget(row, input)
                    if (result.ok) onRaiseOpenChange(false)
                    return result
                  }}
                />
              </div>
            ) : null}
            {historyLoading ? (
              <p className="text-xs text-faint">Loading budget history</p>
            ) : history.length > 0 ? (
              <ol className="flex flex-col gap-1 border-l border-border pl-3">
                {history.map((entry) => (
                  <li key={entry.id} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-fg">
                      {BUDGET_EVENT_LABEL[entry.kind]}
                      {entry.economyModel ? <span className="ml-1.5 font-mono text-muted">{entry.economyModel}</span> : null}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-muted">
                      {formatUsd(entry.spentUsd)}
                      {entry.costBudgetUsd !== null ? ` / ${formatUsd(entry.costBudgetUsd)}` : ""} {formatRelative(entry.ts, now)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </Section>
        ) : null}

        {errorText ? (
          <Section title="Error">
            <p className="whitespace-pre-wrap rounded-lg border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-fg">{errorText}</p>
          </Section>
        ) : null}

        {task?.result ? (
          <Section title="Output">
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 px-3 py-2.5 font-mono text-xs leading-5 text-fg">
              {task.result}
            </pre>
          </Section>
        ) : null}

        {task?.toolCalls && task.toolCalls.length > 0 ? (
          <Section title="Tool calls" aside={<span className="font-mono text-xs text-muted">{task.toolCalls.length}</span>}>
            <ol className="flex flex-wrap gap-1">
              {task.toolCalls.map((tool, index) => (
                <li key={`${tool}-${index}`}>
                  <Badge mono variant="outline">
                    {tool}
                  </Badge>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {task?.prompt || row.deployment?.outcome ? (
          <Section title={task ? "Prompt" : "Outcome"}>
            <p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-6 text-muted">{task?.prompt || row.deployment?.outcome}</p>
          </Section>
        ) : null}

        {run ? (
          <Section title="Activity">
            {runEvents.length === 0 ? (
              <p className="text-xs text-faint">No activity recorded yet.</p>
            ) : (
              <ol className="flex flex-col">
                {runEvents.map((event) => {
                  const detail = eventDetail(event)
                  return (
                    <li key={event.eventId} className="grid grid-cols-[5.5rem_1fr] gap-3 border-l border-border py-1 pl-3 text-sm">
                      <time dateTime={event.ts} title={formatDateTime(event.ts)} className="font-mono text-xs tabular-nums leading-5 text-muted">
                        {new Date(event.ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                      </time>
                      <span className="min-w-0">
                        <span className="text-fg">{EVENT_LABEL[event.type] ?? event.type}</span>
                        {detail ? <span className="ml-2 text-muted">{detail}</span> : null}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>
        ) : null}

        <Separator subtle />

        <Section title="Details">
          <DetailList items={detailItems(row)} />
        </Section>
      </div>
    </Sheet>
  )
}
