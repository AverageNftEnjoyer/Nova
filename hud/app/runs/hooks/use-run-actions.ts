"use client"

import { useCallback, useState } from "react"

import type { AgentTasksState } from "@/app/home/hooks/use-agent-tasks"
import type { ActionResult, DeploymentsData } from "@/app/deployments/hooks/use-deployments-data"
import { hasBudgetHeadroom, taskBudgetSpend } from "@/lib/agents/task-budget"
import type { RaiseAgentTaskBudgetInput } from "@/lib/agents/types"
import type { RunRow } from "../lib/run-rows"

export type RunActionKind =
  | "approve" // approve a deployment plan that needs review, then launch it
  | "deny"
  | "approve-tool" // allow the tool call an agent task is waiting on
  | "deny-tool"
  | "pause"
  | "resume"
  | "cancel"
  | "retry" // re-run a failed or cancelled task that has no deployment
  | "rerun" // start a new run of the same deployment
  | "delete" // delete a finished task that has no deployment

export const RUN_ACTION_LABEL: Record<RunActionKind, string> = {
  approve: "Approve",
  deny: "Deny",
  "approve-tool": "Approve",
  "deny-tool": "Deny",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel run",
  retry: "Retry",
  rerun: "Run again",
  delete: "Delete",
}

const DONE_MESSAGE: Record<RunActionKind, string> = {
  approve: "Approved. The run is starting.",
  deny: "Run denied",
  "approve-tool": "Tool approved. The run continues.",
  "deny-tool": "Tool denied. The run was stopped.",
  pause: "Run paused",
  resume: "Run resumed",
  cancel: "Run cancelled",
  retry: "Task queued again",
  rerun: "New run started",
  delete: "Task deleted",
}

/** Actions the row offers, most important first. Raise budget is separate (it needs a form). */
export function availableActions(row: RunRow): RunActionKind[] {
  const { phase, run, task, deployment } = row
  switch (phase) {
    case "review":
      return ["approve", "deny"]
    case "approval":
      return ["approve-tool", "deny-tool"]
    case "budget":
      return task && hasBudgetHeadroom(taskBudgetSpend(task), task.budget) ? ["resume", "cancel"] : ["cancel"]
    case "running":
    case "queued":
      return task ? ["pause", "cancel"] : ["cancel"]
    case "paused":
      return task ? ["resume", "cancel"] : ["cancel"]
    default: {
      const actions: RunActionKind[] = []
      if (run && deployment && deployment.status !== "archived") actions.push("rerun")
      if (!run && task && (phase === "failed" || phase === "cancelled")) actions.push("retry")
      if (!run && task) actions.push("delete")
      return actions
    }
  }
}

/** A task-backed run that has not finished can get a new budget. */
export function canRaiseBudget(row: RunRow): boolean {
  if (!row.task) return false
  return row.task.status !== "completed" && row.task.status !== "failed" && row.task.status !== "cancelled"
}

export interface RunActions {
  busyId: string
  perform: (row: RunRow, action: RunActionKind) => Promise<ActionResult & { message?: string; runId?: string }>
  raiseBudget: (row: RunRow, input: RaiseAgentTaskBudgetInput) => Promise<ActionResult>
}

/** One place that turns a row action into the right API call (deployment run vs. bare agent task). */
export function useRunActions(data: DeploymentsData, agentTasks: AgentTasksState): RunActions {
  const [busyId, setBusyId] = useState("")
  const { decide, act, runDeployment } = data
  const { runAction } = agentTasks

  const perform = useCallback(
    async (row: RunRow, action: RunActionKind) => {
      setBusyId(row.id)
      try {
        const run = row.run
        const taskId = row.task?.id ?? ""
        let result: ActionResult
        let runId: string | undefined
        switch (action) {
          case "approve":
          case "deny":
            result = run ? await decide(run.id, action) : { ok: false, error: "This run has no deployment to approve." }
            break
          case "approve-tool":
          case "resume":
            result = run ? await act(run.id, "resume") : await runAction(taskId, "play")
            break
          case "deny-tool":
          case "cancel":
            result = run ? await act(run.id, "cancel") : await runAction(taskId, "stop")
            break
          case "pause":
            result = run ? await act(run.id, "pause") : await runAction(taskId, "pause")
            break
          case "retry":
            result = await runAction(taskId, "play")
            break
          case "delete":
            result = await runAction(taskId, "delete")
            break
          case "rerun": {
            const launched = row.deployment
              ? await runDeployment(row.deployment.id)
              : ({ ok: false, error: "This run has no deployment to start again." } as const)
            result = launched.ok ? { ok: true } : launched
            if (launched.ok) runId = launched.run.id
            break
          }
        }
        return result.ok ? { ...result, message: DONE_MESSAGE[action], runId } : result
      } finally {
        setBusyId("")
      }
    },
    [act, decide, runAction, runDeployment],
  )

  const raiseBudget = useCallback(
    async (row: RunRow, input: RaiseAgentTaskBudgetInput): Promise<ActionResult> => {
      setBusyId(row.id)
      try {
        if (row.run?.agentTaskId) return await data.raiseBudget(row.run.id, input)
        if (row.task) return await agentTasks.raiseBudget(row.task.id, input)
        return { ok: false, error: "Only agent task runs have a budget that can be raised." }
      } finally {
        setBusyId("")
      }
    },
    [agentTasks, data],
  )

  return { busyId, perform, raiseBudget }
}
