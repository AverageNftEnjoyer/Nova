import "server-only"

import { createTask } from "@/lib/agents/task-store"
import {
  attachAgentTaskToDeploymentRun,
  getDeployment,
  getDeploymentRun,
  updateDeploymentRun,
} from "@/lib/deployments/store"
import { resolveConfiguredLlmProvider, validateConfiguredLlmSelection } from "@/lib/integrations/llm/provider-selection"
import { loadIntegrationsConfig } from "@/lib/integrations/store/server-store"
import { loadMissions } from "@/lib/missions/store"
import { enqueueMissionRunForQueue } from "@/lib/missions/workflow/queue-mode"
import type { DeploymentRun } from "./types"

export async function launchDeploymentRun(input: {
  userId: string
  deploymentId: string
  runId: string
  idempotencyKey?: string
}): Promise<{ run: DeploymentRun; outcome: "task_queued" | "automation_deployed" }> {
  const deployment = getDeployment(input.userId, input.deploymentId)
  if (!deployment) throw new Error("Deployment not found.")
  const run = getDeploymentRun(input.userId, input.runId)
  if (!run || run.deploymentId !== deployment.id) throw new Error("Deployment run not found.")
  if (run.agentTaskId || run.jobRunId) throw new Error("Deployment run has already been launched.")

  if (deployment.kind === "task") {
    const integrations = await loadIntegrationsConfig({ userId: input.userId })
    const selected = deployment.config.provider && deployment.config.model
      ? validateConfiguredLlmSelection(integrations, deployment.config.provider, deployment.config.model)
      : resolveConfiguredLlmProvider(integrations)
    const prompt = [
      deployment.outcome,
      deployment.acceptanceCriteria.length > 0
        ? `\nAcceptance criteria:\n${deployment.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`
        : "",
      deployment.plan?.specialists.length
        ? `\nManager routing: ${deployment.plan.specialists.join(", ")}.`
        : "",
      deployment.plan?.tools.length
        ? `\nPreferred tools (subject to runtime policy): ${deployment.plan.tools.join(", ")}.`
        : "",
    ].join("")
    const task = await createTask(input.userId, {
      name: deployment.title,
      prompt,
      agent: selected.provider,
      model: selected.model,
      priority: deployment.config.priority ?? "normal",
      permissionMode: deployment.config.permissionMode ?? "default",
      useWorktree: deployment.config.useWorktree,
      attachedFiles: deployment.config.attachedFiles,
      contextId: deployment.config.contextId,
      costBudgetUsd: deployment.config.costBudgetUsd,
      tokenBudget: deployment.config.tokenBudget,
    })
    return {
      run: attachAgentTaskToDeploymentRun(input.userId, run.id, task.id),
      outcome: "task_queued",
    }
  }

  const mission = (await loadMissions({ userId: input.userId }))
    .find((candidate) => candidate.id === deployment.missionId)
  if (!mission) throw new Error("Automation definition not found.")
  const queued = await enqueueMissionRunForQueue({
    mission,
    userId: input.userId,
    missionRunId: run.id,
    runKey: `deployment:${deployment.id}:revision:${deployment.revision}`,
    requestIdempotencyKey: input.idempotencyKey || run.id,
  })
  if (!queued.ok) throw new Error(queued.error)
  return {
    run: updateDeploymentRun(input.userId, run.id, {
      status: "queued",
      jobRunId: run.id,
      eventType: "deployment.run.automation_queued",
      eventData: { jobRunId: run.id, missionId: mission.id },
    }),
    outcome: "automation_deployed",
  }
}
