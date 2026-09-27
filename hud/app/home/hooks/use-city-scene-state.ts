"use client"

import { useMemo } from "react"
import {
  cityWeatherFromCode,
  workplaceForTools,
  type CityAgent,
  type CityIntegration,
  type CityPresence,
  type CitySceneState,
  type CityTaskLight,
  type CityTickerItem,
  type CityWorkplace,
} from "@/components/pixel-city"
import type { AgentTask, AgentTaskStatus } from "@/lib/agents/types"
import type { NovaState } from "@/lib/chat/hooks/useNovaState"
import { formatPct, formatUsdCompact, orderCryptoAssets } from "../components/crypto-prices-module"
import type { HomeCryptoAsset } from "./use-home-crypto-market"

const TASK_FLOORS = 5
/** The District animates at most this many tasks; live and waiting work comes first, then the newest outcomes. */
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

/** One character per task: name, status and the workplace matching the tools it last used. */
export function agentsFor(tasks: readonly AgentTask[]): CityAgent[] {
  return sortTasks(tasks)
    .slice(0, MAX_STREET_AGENTS)
    .map((task) => ({
      id: task.id,
      name: (task.name || task.prompt || "Agent task").trim().slice(0, 60) || "Agent task",
      status: task.status as CityTaskLight,
      workplace: workplaceForTools(task.toolCalls),
    }))
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

/** Which integrations keep each District workplace open; civic places (Hub, depot, library, power plant) never close. */
export interface WorkplaceConnections {
  llm: boolean
  comms: boolean
  mail: boolean
  wallet: boolean
  polymarket: boolean
  media: boolean
}

export function openWorkplacesFor(connected: boolean, links: WorkplaceConnections): CityWorkplace[] {
  const open: CityWorkplace[] = ["depot", "library", "power"]
  if (connected) open.push("hq")
  if (links.llm) open.push("lab")
  if (links.comms) open.push("comms")
  if (links.mail) open.push("post")
  if (links.wallet) open.push("bank")
  if (links.polymarket) open.push("parlour")
  if (links.media) open.push("cinema")
  return open
}

interface CitySceneInput {
  isLight: boolean
  weatherCode: number | null
  connected: boolean
  novaState: NovaState | undefined
  tasks: readonly AgentTask[]
  activeRuns: number
  cryptoAssets: readonly HomeCryptoAsset[]
  integrations: readonly boolean[]
  polymarketConnected: boolean
  youtubeConnected: boolean
  workplaces: WorkplaceConnections
  notesCount: number
  costTodayUsd: number | null
  budgetAlert: boolean
  conversationsCount: number
  connectedIntegrations: readonly CityIntegration[]
}

/** Home's live data, reduced to what the pixel city draws. Memoised on content so the scene only re-bakes on change. */
export function useCitySceneState(input: CitySceneInput): CitySceneState {
  const taskLights = taskLightsFor(input.tasks)
  const agents = agentsFor(input.tasks)
  const ticker = tickerFor(input.cryptoAssets)
  const openWorkplaces = openWorkplacesFor(input.connected, input.workplaces)
  const taskKey = taskLights.join(",")
  const agentsKey = agents.map((agent) => `${agent.id}:${agent.status}:${agent.workplace}:${agent.name}`).join("|")
  const tickerKey = ticker.map((item) => `${item.label}${item.value}`).join("|")
  const integrationsKey = input.integrations.map(Number).join("")
  const openKey = openWorkplaces.join(",")
  const connectedKey = input.connectedIntegrations.join(",")
  const presence = presenceFor(input.connected, input.novaState)
  const weather = cityWeatherFromCode(input.weatherCode)

  return useMemo<CitySceneState>(
    () => ({
      timeOfDay: input.isLight ? "day" : "night",
      weather,
      presence,
      taskLights: taskKey ? (taskKey.split(",") as CityTaskLight[]) : [],
      activeRuns: input.activeRuns,
      ticker: tickerKey ? ticker : [],
      integrations: integrationsKey.split("").filter(Boolean).map((flag) => flag === "1"),
      polymarketConnected: input.polymarketConnected,
      youtubeConnected: input.youtubeConnected,
      notesCount: input.notesCount,
      costTodayUsd: input.costTodayUsd,
      budgetAlert: input.budgetAlert,
      conversationsCount: input.conversationsCount,
      agents: agentsKey ? agents : [],
      openWorkplaces: openKey ? (openKey.split(",") as CityWorkplace[]) : [],
      connectedIntegrations: connectedKey ? (connectedKey.split(",") as CityIntegration[]) : [],
    }),
    // `ticker` and `agents` are rebuilt each render; their content is captured by tickerKey / agentsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      input.isLight,
      weather,
      presence,
      taskKey,
      agentsKey,
      input.activeRuns,
      tickerKey,
      integrationsKey,
      openKey,
      connectedKey,
      input.polymarketConnected,
      input.youtubeConnected,
      input.notesCount,
      input.costTodayUsd,
      input.budgetAlert,
      input.conversationsCount,
    ],
  )
}
