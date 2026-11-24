"use client"

import Link from "next/link"
import { useState } from "react"
import { Activity, ShieldAlert } from "lucide-react"

import { Badge, Button, EmptyState, Panel, SkeletonRows, StatusDot, type StatusTone } from "@/components/ui"
import { isRunActive, runNeedsReview, type DeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import { budgetFraction, taskBudgetSpend } from "@/lib/agents/task-budget"
import type { AgentTask, AgentTaskBudgetState, AgentTaskUiAction } from "@/lib/agents/types"
import type { DeploymentRun, DeploymentRunStatus } from "@/lib/deployments/types"
import { cn } from "@/lib/shared/utils"
import type { AgentTasksState } from "../hooks/use-agent-tasks"
import { useNow } from "../hooks/use-now"
import { formatElapsed, formatRelative, formatUsd } from "../format"

interface HomeLiveWorkProps {
  deployments: DeploymentsData
  agentTasks: AgentTasksState
}

function runHref(id: string): string {
  return `/runs?run=${encodeURIComponent(id)}`
}

function isTaskAwaitingApproval(task: AgentTask): boolean {
  return task.status === "paused" && task.pauseReason === "approval" && Boolean(task.pendingApproval)
}

const BUDGET_LABEL: Record<Exclude<AgentTaskBudgetState, "ok">, string> = {
  warning: "Budget 80%",
  degraded: "Economy model",
  exhausted: "Budget spent",
}

function BudgetBadge({ state }: { state: AgentTaskBudgetState | undefined }) {
  if (!state || state === "ok") return null
  return <Badge tone={state === "exhausted" ? "danger" : "warning"}>{BUDGET_LABEL[state]}</Badge>
}

const RUN_DOT: Record<DeploymentRunStatus, StatusTone> = {
  pending: "idle",
  queued: "idle",
  running: "running",
  paused: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "idle",
  dead: "danger",
}

const TASK_STATUS_LABEL: Record<AgentTask["status"], string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
}

function taskDot(task: AgentTask): StatusTone {
  if (task.status === "running") return "running"
  if (task.status === "paused") return "warning"
  return "idle"
}

/** Spend against the effective cost budget, as text plus a 3px bar. No bar when no cost budget applies. */
function CostMeter({ task }: { task: AgentTask }) {
  const spend = taskBudgetSpend(task)
  const limit = task.budget?.active ? task.budget.costUsd : null
  const fraction = Math.min(1, budgetFraction(spend, task.budget))
  const tone = task.budgetState === "exhausted" ? "bg-danger" : task.budgetState === "ok" ? "bg-accent" : "bg-warning"
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <span className="font-mono text-xs tabular-nums text-fg">
        {formatUsd(spend.spentUsd)}
        {limit ? <span className="text-faint"> / {formatUsd(limit)}</span> : null}
      </span>
      {limit ? (
        <span
          role="meter"
          aria-label="Budget used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          className="block h-[3px] w-full overflow-hidden rounded-full bg-surface-3"
        >
          <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 4 : 0)}%` }} />
        </span>
      ) : null}
    </div>
  )
}

interface ApprovalItem {
  id: string
  title: string
  detail: string
  at: string
  kind: "run" | "task"
  href: string
}

export function HomeLiveWork({ deployments, agentTasks }: HomeLiveWorkProps) {
  const [busy, setBusy] = useState("")
  const [actionError, setActionError] = useState("")
  const titleOf = new Map(deployments.deployments.map((deployment) => [deployment.id, deployment.title]))
  const taskIds = new Set(agentTasks.tasks.map((task) => task.id))
  // /runs focuses deployment runs; a task launched by a deployment links to its run, a bare task to the list.
  const runOfTask = new Map(deployments.runs.filter((run) => run.agentTaskId).map((run) => [run.agentTaskId as string, run.id]))
  const taskHref = (taskId: string) => {
    const runId = runOfTask.get(taskId)
    return runId ? runHref(runId) : "/runs"
  }

  const approvals: ApprovalItem[] = [
    ...deployments.runs.filter(runNeedsReview).map((run) => ({
      id: run.id,
      title: titleOf.get(run.deploymentId) ?? "Deployment",
      detail: "Plan needs review before it runs",
      at: run.createdAt,
      kind: "run" as const,
      href: runHref(run.id),
    })),
    ...agentTasks.tasks.filter(isTaskAwaitingApproval).map((task) => ({
      id: task.id,
      title: task.name || task.prompt.slice(0, 80),
      detail: task.pendingApproval ? `Wants to use ${task.pendingApproval.toolName}: ${task.pendingApproval.reason}` : "Waiting for approval",
      at: task.pausedAt ?? task.updatedAt,
      kind: "task" as const,
      href: taskHref(task.id),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const activeTasks = agentTasks.tasks.filter(
    (task) => (task.status === "running" || task.status === "queued" || task.status === "paused") && !isTaskAwaitingApproval(task),
  )
  // Deployment runs backed by an agent task show as that task; the rest are automation (job ledger) runs.
  const automationRuns = deployments.runs.filter(
    (run) => isRunActive(run) && !runNeedsReview(run) && !(run.agentTaskId && taskIds.has(run.agentTaskId)),
  )
  const runningCount = activeTasks.length + automationRuns.length
  const now = useNow(runningCount > 0)

  const decide = async (item: ApprovalItem, approve: boolean) => {
    setBusy(`${item.id}:${approve ? "approve" : "deny"}`)
    setActionError("")
    try {
      if (item.kind === "run") {
        const result = await deployments.decide(item.id, approve ? "approve" : "deny")
        if (!result.ok) setActionError(result.error)
      } else {
        const action: AgentTaskUiAction = approve ? "play" : "stop"
        const result = await agentTasks.runAction(item.id, action)
        if (!result.ok) setActionError(result.error)
      }
    } finally {
      setBusy("")
    }
  }

  const loading = (deployments.loading || agentTasks.loading) && runningCount === 0 && approvals.length === 0
  const loadError = deployments.error || agentTasks.error
  const retry = () => {
    void deployments.refresh()
    void agentTasks.refresh()
  }

  const viewRuns = (
    <Button asChild size="sm" variant="ghost">
      <Link href="/runs">View runs</Link>
    </Button>
  )

  return (
    <>
      {approvals.length > 0 ? (
        <Panel
          title="Needs your approval"
          icon={<ShieldAlert className="text-warning" />}
          actions={<Badge tone="warning">{approvals.length}</Badge>}
          flush
          className="border-warning-muted"
        >
          {actionError ? (
            <p role="alert" className="border-b border-border-subtle px-4 py-2 text-sm text-danger">
              {actionError}
            </p>
          ) : null}
          <ul className="divide-y divide-border-subtle">
            {approvals.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={item.href} className="block truncate text-sm font-medium text-fg hover:underline">
                    {item.title}
                  </Link>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{item.detail}</p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{formatRelative(item.at, now)}</span>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(busy)}
                    loading={busy === `${item.id}:deny`}
                    onClick={() => void decide(item, false)}
                    aria-label={item.kind === "task" ? `Deny and stop ${item.title}` : `Deny ${item.title}`}
                  >
                    Deny
                  </Button>
                  <Button
                    size="sm"
                    disabled={Boolean(busy)}
                    loading={busy === `${item.id}:approve`}
                    onClick={() => void decide(item, true)}
                    aria-label={`Approve ${item.title}`}
                  >
                    Approve
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel
        title="Running now"
        icon={<Activity />}
        actions={
          <>
            {runningCount > 0 ? <Badge tone="accent" dot="pulse">{runningCount}</Badge> : null}
            {viewRuns}
          </>
        }
        flush
      >
        {loadError && runningCount === 0 ? (
          <EmptyState
            size="compact"
            tone="danger"
            title="Could not load runs"
            description={loadError}
            action={
              <Button size="sm" variant="outline" onClick={retry}>
                Retry
              </Button>
            }
          />
        ) : loading ? (
          <SkeletonRows rows={3} className="px-1 py-1" />
        ) : runningCount === 0 ? (
          <EmptyState
            size="compact"
            title="Nothing running"
            description={approvals.length > 0 ? "Approve a run above to start it." : "Start something above."}
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {activeTasks.map((task) => (
              <li key={task.id} className="grid grid-cols-[auto_minmax(0,1fr)_4.5rem_8.5rem] items-center gap-x-3 px-4 py-2.5">
                <StatusDot tone={taskDot(task)} label={TASK_STATUS_LABEL[task.status]} />
                <div className="min-w-0">
                  <Link href={taskHref(task.id)} className="block truncate text-sm text-fg hover:underline">
                    {task.name || task.prompt.slice(0, 80)}
                  </Link>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted">
                    <span>{TASK_STATUS_LABEL[task.status]}</span>
                    <span className="truncate font-mono text-faint">{task.budgetLive?.model || task.model}</span>
                    <BudgetBadge state={task.budgetState} />
                  </div>
                </div>
                <span className="text-right font-mono text-xs tabular-nums text-muted">
                  {task.status === "running" ? formatElapsed(task.startedAt, now) : ""}
                </span>
                <CostMeter task={task} />
              </li>
            ))}
            {automationRuns.map((run: DeploymentRun) => (
              <li key={run.id} className="grid grid-cols-[auto_minmax(0,1fr)_4.5rem_8.5rem] items-center gap-x-3 px-4 py-2.5">
                <StatusDot tone={RUN_DOT[run.status]} label={run.status} />
                <div className="min-w-0">
                  <Link href={runHref(run.id)} className="block truncate text-sm text-fg hover:underline">
                    {titleOf.get(run.deploymentId) ?? "Automation"}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span>{run.status === "running" ? "Running" : run.status === "paused" ? "Paused" : "Queued"}</span>
                    <span className="text-faint">Automation</span>
                    <BudgetBadge state={run.budgetState} />
                  </div>
                </div>
                <span className="text-right font-mono text-xs tabular-nums text-muted">
                  {run.status === "running" ? formatElapsed(run.startedAt, now) : ""}
                </span>
                <span className="text-right font-mono text-xs tabular-nums text-faint">
                  {run.costBudgetUsd ? `Budget ${formatUsd(run.costBudgetUsd)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
