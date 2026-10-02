"use client"

import { useMemo } from "react"
import {
  agentResidentId,
  cityWeatherFromCode,
  integrationWorkplace,
  workplaceForTools,
  type CityAgent,
  type CityIntegration,
  type CityPresence,
  type CitySceneState,
  type CityTaskLight,
  type CityWorker,
} from "@/components/pixel-city"
import type { AgentTask, AgentTaskStatus } from "@/lib/agents/types"
import { integrationLabel } from "@/lib/town/quests"
import type { ResidentNames } from "@/lib/town/residents"
import type { NovaState } from "@/lib/chat/hooks/useNovaState"

const TASK_FLOORS = 5
/** The city animates at most this many tasks; live and waiting work comes first, then the newest outcomes. */
const MAX_STREET_AGENTS = 24
/** Which tasks light the tower first: live work, then waiting work, then recent outcomes. */
const TASK_ORDER: Readonly<Record<AgentTaskStatus, number>> = {
  running: 0,
  paused: 1,
  queued: 2,
  failed: 3,
  completed: 4,
  cancelled: 5,
}

export function presenceFor(connected: boolean, novaState: NovaState | undefined): CityPresence {
  if (!connected) return "offline"
  if (novaState === "thinking") return "thinking"
  if (novaState === "speaking") return "speaking"
  if (novaState === "listening") return "listening"
  return "online"
}

function sortTasks(tasks: readonly AgentTask[]): AgentTask[] {
  return tasks
    .filter((task) => task.status !== "cancelled")
    .slice()
    .sort((a, b) => TASK_ORDER[a.status] - TASK_ORDER[b.status] || String(b.createdAt).localeCompare(String(a.createdAt)))
}

export function taskLightsFor(tasks: readonly AgentTask[]): CityTaskLight[] {
  return sortTasks(tasks)
    .slice(0, TASK_FLOORS)
    .map((task) => task.status as CityTaskLight)
}

/** The name a resident has when the user has not chosen one. */
export function defaultAgentName(task: Pick<AgentTask, "name" | "prompt">): string {
  return (task.name || task.prompt || "Agent task").trim().slice(0, 60) || "Agent task"
}

export function defaultWorkerName(integration: CityIntegration): string {
  return `${integrationLabel(integration)} worker`
}

function chosenName(names: Readonly<ResidentNames> | undefined, id: string): string | null {
  const name = names?.[id]?.trim()
  return name ? name : null
}

/** One character per task: name (the user's, else the task's), status and the workplace matching the tools it last used. */
export function agentsFor(tasks: readonly AgentTask[], names?: Readonly<ResidentNames>): CityAgent[] {
  return sortTasks(tasks)
    .slice(0, MAX_STREET_AGENTS)
    .map((task) => ({
      id: task.id,
      name: chosenName(names, agentResidentId(task.id)) ?? defaultAgentName(task),
      status: task.status as CityTaskLight,
      workplace: workplaceForTools(task.toolCalls),
    }))
}

/**
 * One worker per connected integration (and only those): nothing connected means none. Order follows the integration
 * list Home already uses, so the same set always produces the same workers.
 */
export function workersFor(connected: readonly CityIntegration[], names?: Readonly<ResidentNames>): CityWorker[] {
  return Array.from(new Set(connected)).map((integration) => {
    const id = `integration:${integration}` as const
    return { id, integration, name: chosenName(names, id) ?? defaultWorkerName(integration), workplace: integrationWorkplace(integration) }
  })
}

interface CitySceneInput {
  weatherCode: number | null
  connected: boolean
  novaState: NovaState | undefined
  tasks: readonly AgentTask[]
  activeRuns: number
  notesCount: number
  connectedIntegrations: readonly CityIntegration[]
  /** Resident names the user chose (resident id -> name); empty until loaded: everyone keeps the default name. */
  residentNames: Readonly<ResidentNames>
}

/** Home's live data, reduced to what Nova City draws. Memoised on content so the scene only updates on change. */
export function useCitySceneState(input: CitySceneInput): CitySceneState {
  const taskLights = taskLightsFor(input.tasks)
  const agents = agentsFor(input.tasks, input.residentNames)
  const workers = workersFor(input.connectedIntegrations, input.residentNames)
  const taskKey = taskLights.join(",")
  const agentsKey = agents.map((agent) => `${agent.id}:${agent.status}:${agent.workplace}:${agent.name}`).join("|")
  const connectedKey = input.connectedIntegrations.join(",")
  const presence = presenceFor(input.connected, input.novaState)
  const weather = cityWeatherFromCode(input.weatherCode)
  const workersKey = workers.map((worker) => `${worker.id}:${worker.name}`).join("|")

  return useMemo<CitySceneState>(
    () => ({
      weather,
      presence,
      taskLights: taskKey ? (taskKey.split(",") as CityTaskLight[]) : [],
      activeRuns: input.activeRuns,
      notesCount: input.notesCount,
      agents: agentsKey ? agents : [],
      connectedIntegrations: connectedKey ? (connectedKey.split(",") as CityIntegration[]) : [],
      workers: workersKey ? workers : [],
    }),
    // `agents` and `workers` are rebuilt each render; their content is captured by the keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weather, presence, taskKey, agentsKey, input.activeRuns, input.notesCount, connectedKey, workersKey],
  )
}
