import { runNeedsReview } from "@/app/deployments/hooks/use-deployments-data"
import type { AgentTask, AgentTaskBudgetState } from "@/lib/agents/types"
import type { Deployment, DeploymentKind, DeploymentRun, DeploymentRunStatus } from "@/lib/deployments/types"

/**
 * What a run is doing, from the user's point of view. Deployment runs are canonical; an agent task started outside a
 * deployment (it has no run yet; it is projected as one once it finishes) is listed as its own row.
 */
export type RunPhase =
  | "review" // a deployment plan that requires review, paused before launch
  | "approval" // an agent task paused to ask before a tool call
  | "budget" // an agent task paused before a model call that would go over budget
  | "running"
  | "queued"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"

export type RunTab = "all" | "attention" | "running" | "completed" | "failed"

export const RUN_TABS: Array<{ id: RunTab; label: string }> = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs approval" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
]

export type PhaseTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info"

export const PHASE_META: Record<RunPhase, { label: string; tone: PhaseTone; tab: Exclude<RunTab, "all">; live?: boolean }> = {
  review: { label: "Needs review", tone: "warning", tab: "attention" },
  approval: { label: "Needs approval", tone: "warning", tab: "attention" },
  budget: { label: "Budget paused", tone: "warning", tab: "attention" },
  running: { label: "Running", tone: "accent", tab: "running", live: true },
  queued: { label: "Queued", tone: "neutral", tab: "running" },
  paused: { label: "Paused", tone: "info", tab: "running" },
  succeeded: { label: "Completed", tone: "success", tab: "completed" },
  failed: { label: "Failed", tone: "danger", tab: "failed" },
  cancelled: { label: "Cancelled", tone: "neutral", tab: "failed" },
}

export interface RunRow {
  /** Deployment run id, or the agent task id for a task without a run. */
  id: string
  run: DeploymentRun | null
  task: AgentTask | null
  deployment: Deployment | null
  name: string
  kind: DeploymentKind
  phase: RunPhase
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  model: string | null
  budgetState: AgentTaskBudgetState
}

const RUN_PHASE: Record<DeploymentRunStatus, RunPhase> = {
  pending: "queued",
  queued: "queued",
  running: "running",
  paused: "paused",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  dead: "failed",
}

const TASK_PHASE: Record<AgentTask["status"], RunPhase> = {
  queued: "queued",
  running: "running",
  paused: "paused",
  completed: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
}

function phaseOf(run: DeploymentRun | null, task: AgentTask | null): RunPhase {
  if (run && runNeedsReview(run)) return "review"
  if (task?.status === "paused" && task.pauseReason === "approval" && task.pendingApproval) return "approval"
  if (task?.status === "paused" && task.pauseReason === "budget") return "budget"
  // The task row is fresher than the run (the run is synced from it on each list request).
  if (task) return TASK_PHASE[task.status]
  return run ? RUN_PHASE[run.status] : "queued"
}

export function buildRunRows(runs: DeploymentRun[], tasks: AgentTask[], deployments: Deployment[]): RunRow[] {
  const deploymentById = new Map(deployments.map((deployment) => [deployment.id, deployment]))
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const linkedTaskIds = new Set<string>()
  const rows: RunRow[] = []

  for (const run of runs) {
    const task = run.agentTaskId ? taskById.get(run.agentTaskId) ?? null : null
    if (run.agentTaskId) linkedTaskIds.add(run.agentTaskId)
    const deployment = deploymentById.get(run.deploymentId) ?? null
    rows.push({
      id: run.id,
      run,
      task,
      deployment,
      name: task?.name || deployment?.title || "Untitled run",
      kind: deployment?.kind ?? (run.agentTaskId ? "task" : "automation"),
      phase: phaseOf(run, task),
      createdAt: run.createdAt,
      startedAt: run.startedAt ?? task?.startedAt ?? null,
      finishedAt: run.finishedAt ?? task?.completedAt ?? null,
      model: task?.model || deployment?.config.model || null,
      budgetState: task?.budgetState ?? run.budgetState ?? "ok",
    })
  }

  for (const task of tasks) {
    if (linkedTaskIds.has(task.id)) continue
    rows.push({
      id: task.id,
      run: null,
      task,
      deployment: null,
      name: task.name || task.prompt.slice(0, 80) || "Untitled task",
      kind: "task",
      phase: phaseOf(null, task),
      createdAt: task.createdAt,
      startedAt: task.startedAt ?? null,
      finishedAt: task.completedAt ?? null,
      model: task.model || null,
      budgetState: task.budgetState,
    })
  }

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function rowInTab(row: RunRow, tab: RunTab): boolean {
  return tab === "all" || PHASE_META[row.phase].tab === tab
}

export function needsAttention(row: RunRow): boolean {
  return PHASE_META[row.phase].tab === "attention"
}

/** True for a run that has not reached a terminal state. */
export function isRowActive(row: RunRow): boolean {
  const tab = PHASE_META[row.phase].tab
  return tab === "attention" || tab === "running"
}

/** Matches `/runs?run=<id>`: a run id, or the agent task id behind a run. */
export function findRow(rows: RunRow[], id: string): RunRow | undefined {
  return rows.find((row) => row.id === id || row.run?.agentTaskId === id || row.task?.id === id)
}
