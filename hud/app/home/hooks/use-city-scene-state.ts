"use client"

import { useMemo } from "react"
import {
  agentResidentId,
  cityWeatherFromCode,
  integrationWorkplace,
  workplaceForTools,
  type CityAgent,
  type CityIntegration,
  type CityLook,
  type CityPresence,
  type CitySceneState,
  type CityTaskLight,
  type CityTickerItem,
  type CityWorker,
} from "@/components/pixel-city"
import type { AgentTask, AgentTaskStatus } from "@/lib/agents/types"
import { integrationLabel } from "@/lib/town/quests"
import type { ResidentLook, TownWardrobe } from "@/lib/town/wardrobe-types"
import type { NovaState } from "@/lib/chat/hooks/useNovaState"
import { formatPct, formatUsdCompact, orderCryptoAssets } from "../components/crypto-prices-module"
import type { HomeCryptoAsset } from "./use-home-crypto-market"

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

type ResidentLooks = Readonly<Record<string, ResidentLook>>

function chosenName(looks: ResidentLooks | undefined, id: string): string | null {
  const name = looks?.[id]?.name?.trim()
  return name ? name : null
}

/** One character per task: name (the user's, else the task's), status and the workplace matching the tools it last used. */
export function agentsFor(tasks: readonly AgentTask[], looks?: ResidentLooks): CityAgent[] {
  return sortTasks(tasks)
    .slice(0, MAX_STREET_AGENTS)
    .map((task) => ({
      id: task.id,
      name: chosenName(looks, agentResidentId(task.id)) ?? defaultAgentName(task),
      status: task.status as CityTaskLight,
      workplace: workplaceForTools(task.toolCalls),
    }))
}

/**
 * One worker per connected integration (and only those): nothing connected means none. Order follows the integration
 * list Home already uses, so the same set always produces the same workers.
 */
export function workersFor(connected: readonly CityIntegration[], looks?: ResidentLooks): CityWorker[] {
  return Array.from(new Set(connected)).map((integration) => {
    const id = `integration:${integration}` as const
    return { id, integration, name: chosenName(looks, id) ?? defaultWorkerName(integration), workplace: integrationWorkplace(integration) }
  })
}

/** Equipped cosmetics of the residents that wear any. */
export function looksFor(wardrobe: TownWardrobe | null): Record<string, CityLook> {
  const out: Record<string, CityLook> = {}
  if (!wardrobe) return out
  for (const [id, look] of Object.entries(wardrobe.residents)) {
    const outfit = look.equipped.outfit
    const hat = look.equipped.hat
    if (outfit || hat) out[id] = { ...(outfit ? { outfit } : {}), ...(hat ? { hat } : {}) }
  }
  return out
}

export function tickerFor(assets: readonly HomeCryptoAsset[]): CityTickerItem[] {
  return orderCryptoAssets(assets)
    .filter((asset) => asset.price > 0)
    .map((asset) => ({
      label: asset.symbol,
      value: `${formatUsdCompact(asset.price)} ${formatPct(asset.changePct)}`,
      up: asset.changePct >= 0,
    }))
}

interface CitySceneInput {
  weatherCode: number | null
  connected: boolean
  novaState: NovaState | undefined
  tasks: readonly AgentTask[]
  activeRuns: number
  cryptoAssets: readonly HomeCryptoAsset[]
  notesCount: number
  connectedIntegrations: readonly CityIntegration[]
  /** The wardrobe (resident names and what they wear); null until it has loaded: everyone keeps the default look. */
  wardrobe: TownWardrobe | null
}

/** Home's live data, reduced to what Nova City draws. Memoised on content so the scene only updates on change. */
export function useCitySceneState(input: CitySceneInput): CitySceneState {
  const taskLights = taskLightsFor(input.tasks)
  const residentLooks = input.wardrobe?.residents
  const agents = agentsFor(input.tasks, residentLooks)
  const workers = workersFor(input.connectedIntegrations, residentLooks)
  const looks = looksFor(input.wardrobe)
  const ticker = tickerFor(input.cryptoAssets)
  const taskKey = taskLights.join(",")
  const agentsKey = agents.map((agent) => `${agent.id}:${agent.status}:${agent.workplace}:${agent.name}`).join("|")
  const tickerKey = ticker.map((item) => `${item.label}${item.value}`).join("|")
  const connectedKey = input.connectedIntegrations.join(",")
  const presence = presenceFor(input.connected, input.novaState)
  const weather = cityWeatherFromCode(input.weatherCode)
  const workersKey = workers.map((worker) => `${worker.id}:${worker.name}`).join("|")
  const looksKey = JSON.stringify(looks)

  return useMemo<CitySceneState>(
    () => ({
      weather,
      presence,
      taskLights: taskKey ? (taskKey.split(",") as CityTaskLight[]) : [],
      activeRuns: input.activeRuns,
      ticker: tickerKey ? ticker : [],
      notesCount: input.notesCount,
      agents: agentsKey ? agents : [],
      connectedIntegrations: connectedKey ? (connectedKey.split(",") as CityIntegration[]) : [],
      workers: workersKey ? workers : [],
      looks,
    }),
    // `ticker`, `agents`, `workers` and `looks` are rebuilt each render; their content is captured by the keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weather, presence, taskKey, agentsKey, input.activeRuns, tickerKey, input.notesCount, connectedKey, workersKey, looksKey],
  )
}
