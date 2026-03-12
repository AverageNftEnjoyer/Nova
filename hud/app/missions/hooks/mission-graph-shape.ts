import type { Mission as NativeMission } from "@/lib/missions/types"

const AGENT_PHASE0_NODE_TYPES = new Set([
  "agent-supervisor",
  "agent-worker",
  "agent-handoff",
  "agent-state-read",
  "agent-state-write",
  "provider-selector",
  "agent-audit",
  "agent-subworkflow",
])

const CANVAS_ONLY_NODE_TYPES = new Set([
  "polymarket-price-trigger",
  "polymarket-monitor",
  "polymarket-data-fetch",
])

function hasNonMainPorts(mission: Pick<NativeMission, "connections">): boolean {
  for (const connection of mission.connections) {
    if (String(connection.sourcePort || "main").trim() !== "main") return true
    if (connection.targetPort && String(connection.targetPort).trim() !== "main") return true
  }
  return false
}

function hasFanOutOrFanIn(mission: Pick<NativeMission, "connections">): boolean {
  const outgoing = new Map<string, number>()
  const incoming = new Map<string, number>()
  for (const connection of mission.connections) {
    outgoing.set(connection.sourceNodeId, (outgoing.get(connection.sourceNodeId) || 0) + 1)
    incoming.set(connection.targetNodeId, (incoming.get(connection.targetNodeId) || 0) + 1)
    if ((outgoing.get(connection.sourceNodeId) || 0) > 1) return true
    if ((incoming.get(connection.targetNodeId) || 0) > 1) return true
  }
  return false
}

function hasSingleLinearPath(mission: Pick<NativeMission, "nodes" | "connections">): boolean {
  if (mission.nodes.length <= 1) return true
  if (mission.connections.length !== mission.nodes.length - 1) return false

  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  for (const node of mission.nodes) {
    incoming.set(node.id, 0)
    outgoing.set(node.id, 0)
  }
  for (const connection of mission.connections) {
    incoming.set(connection.targetNodeId, (incoming.get(connection.targetNodeId) || 0) + 1)
    outgoing.set(connection.sourceNodeId, (outgoing.get(connection.sourceNodeId) || 0) + 1)
  }

  const rootCount = mission.nodes.filter((node) => (incoming.get(node.id) || 0) === 0).length
  const sinkCount = mission.nodes.filter((node) => (outgoing.get(node.id) || 0) === 0).length
  return rootCount === 1 && sinkCount === 1
}

export function missionHasAgentPhase0Nodes(mission: Pick<NativeMission, "nodes">): boolean {
  return mission.nodes.some((node) => AGENT_PHASE0_NODE_TYPES.has(String(node.type || "")))
}

export function missionHasCanvasOnlyNodes(mission: Pick<NativeMission, "nodes">): boolean {
  return mission.nodes.some((node) => CANVAS_ONLY_NODE_TYPES.has(String(node.type || "")))
}

export function missionHasNonLinearGraph(mission: Pick<NativeMission, "nodes" | "connections">): boolean {
  if (hasNonMainPorts(mission)) return true
  if (hasFanOutOrFanIn(mission)) return true
  return !hasSingleLinearPath(mission)
}

export function missionRequiresCanvasEditor(mission: Pick<NativeMission, "nodes" | "connections">): boolean {
  return missionHasAgentPhase0Nodes(mission) || missionHasCanvasOnlyNodes(mission) || missionHasNonLinearGraph(mission)
}
