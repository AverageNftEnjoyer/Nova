"use client"

import { useCallback, useState } from "react"

import type { CreateAgentTaskInput } from "@/lib/agents/types"
import type { Deployment, DeploymentRun } from "@/lib/deployments/types"
import { defaultMissionSettings, type Mission } from "@/lib/missions/types"

type CreateResult = { ok: true } | { ok: false; error: string }

/** A run that now exists, for the host to navigate to. */
export interface DeploymentLaunch {
  deploymentId: string
  runId: string
}

export interface DeploymentFlowCallbacks {
  /** Status line ("Saved as a draft", errors). */
  onStatus: (message: string) => void
  /** A task or automation was launched. */
  onLaunched: (message: string, launch: DeploymentLaunch) => void
}

async function postJson<T>(url: string, body: unknown): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as T
  return { response, data }
}

async function launchRun(deploymentId: string, fallbackError: string): Promise<DeploymentLaunch> {
  const { response, data } = await postJson<{ ok?: boolean; run?: DeploymentRun; error?: string }>("/api/deployment-runs", {
    deploymentId,
    idempotencyKey: crypto.randomUUID(),
  })
  if (!response.ok || !data.ok || !data.run) throw new Error(data.error || fallbackError)
  return { deploymentId, runId: data.run.id }
}

async function saveMission(draft: Mission): Promise<Mission> {
  const { response, data } = await postJson<{ ok?: boolean; mission?: Mission; error?: string }>("/api/missions", {
    mission: draft,
  })
  if (!response.ok || !data.ok || !data.mission) throw new Error(data.error || "Failed to save automation.")
  return data.mission
}

async function createAutomationDeployment(saved: Mission, status: "draft" | "ready"): Promise<Deployment> {
  const { response, data } = await postJson<{ ok?: boolean; deployment?: Deployment; error?: string }>(
    "/api/deployments",
    {
      kind: "automation",
      status,
      title: saved.label,
      outcome: saved.description || saved.label,
      missionId: saved.id,
    },
  )
  if (!response.ok || !data.ok || !data.deployment) {
    throw new Error(data.error || "Failed to create automation deployment.")
  }
  return data.deployment
}

function createMissionDraft(): Mission {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    userId: "",
    label: "New automation",
    description: "",
    category: "personal",
    tags: [],
    status: "draft",
    version: 1,
    nodes: [],
    connections: [],
    variables: [],
    settings: defaultMissionSettings(),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: [],
  }
}

/**
 * Advanced creation: a one-off task or a canvas automation becomes a canonical Deployment, and launching it
 * creates its first DeploymentRun (the server links the Agent Task or the Mission job run).
 */
export function useDeploymentActions({ onStatus, onLaunched }: DeploymentFlowCallbacks) {
  const [mission, setMission] = useState<Mission | null>(null)
  const [missionBusy, setMissionBusy] = useState(false)

  const createTask = useCallback(
    async (input: CreateAgentTaskInput): Promise<CreateResult> => {
      try {
        const { response, data } = await postJson<{ ok?: boolean; deployment?: Deployment; error?: string }>(
          "/api/deployments",
          {
            kind: "task",
            status: "ready",
            title: input.name,
            outcome: input.prompt,
            config: {
              provider: input.agent,
              model: input.model,
              priority: input.priority,
              permissionMode: input.permissionMode,
              useWorktree: input.useWorktree,
              attachedFiles: input.attachedFiles,
              contextId: input.contextId,
              costBudgetUsd: input.costBudgetUsd,
              tokenBudget: input.tokenBudget,
            },
          },
        )
        if (!response.ok || !data.ok || !data.deployment) throw new Error(data.error || "Failed to create deployment.")
        const launch = await launchRun(data.deployment.id, "Failed to queue deployment.")
        onLaunched("Task queued", launch)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Failed to queue deployment." }
      }
    },
    [onLaunched],
  )

  const saveMissionDraft = async (draft: Mission): Promise<boolean> => {
    setMissionBusy(true)
    onStatus("")
    try {
      const saved = await saveMission(draft)
      await createAutomationDeployment(saved, "draft")
      setMission(saved)
      onStatus(`Automation "${saved.label}" saved as a draft. It is listed under Deployments.`)
      return true
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Failed to save automation.")
      return false
    } finally {
      setMissionBusy(false)
    }
  }

  const runMission = async (draft: Mission) => {
    setMissionBusy(true)
    onStatus("")
    try {
      const saved = await saveMission(draft)
      setMission(saved)
      const deployment = await createAutomationDeployment(saved, "ready")
      const launch = await launchRun(deployment.id, "Automation run failed.")
      setMission(null)
      onLaunched("Automation queued", launch)
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Failed to run automation.")
    } finally {
      setMissionBusy(false)
    }
  }

  return {
    mission,
    missionBusy,
    openCanvas: () => setMission(createMissionDraft()),
    closeCanvas: () => setMission(null),
    createTask,
    saveMissionDraft,
    runMission,
  }
}
