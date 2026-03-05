import "server-only"

import type { Mission, MissionNode } from "../types"

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase()
  if (!raw) return fallback
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  return fallback
}

export function isMissionAgentGraphEnabled(): boolean {
  return readBooleanEnv("NOVA_MISSIONS_AGENT_GRAPH_ENABLED", true)
}

export function isMissionAgentExecutorEnabled(): boolean {
  return readBooleanEnv("NOVA_MISSIONS_AGENT_EXECUTOR_ENABLED", true)
}

export function nodeUsesAgentGraph(node: Pick<MissionNode, "type">): boolean {
  return node.type.startsWith("agent-") || node.type === "provider-selector"
}

export function missionUsesAgentGraph(mission: Pick<Mission, "nodes">): boolean {
  return Array.isArray(mission.nodes) && mission.nodes.some((node) => nodeUsesAgentGraph(node))
}
