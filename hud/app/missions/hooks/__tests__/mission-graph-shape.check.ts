import assert from "node:assert/strict"

import type { Mission } from "../../../../lib/missions/types"
import { missionHasAgentPhase0Nodes, missionHasCanvasOnlyNodes, missionHasNonLinearGraph, missionRequiresCanvasEditor } from "../mission-graph-shape"

function buildMission(input: {
  nodes: Array<{ id: string; type: string }>
  connections: Array<{ id: string; sourceNodeId: string; sourcePort: string; targetNodeId: string; targetPort?: string }>
}): Mission {
  return {
    id: "mission-test",
    userId: "user-test",
    label: "Mission Test",
    description: "",
    category: "research",
    tags: [],
    status: "draft",
    version: 1,
    nodes: input.nodes.map((node, index) => ({
      ...node,
      label: node.id,
      position: { x: 80 + index * 40, y: 120 },
    })) as Mission["nodes"],
    connections: input.connections,
    variables: [],
    settings: {
      timezone: "UTC",
      retryOnFail: false,
      retryCount: 0,
      retryIntervalMs: 1000,
      saveExecutionProgress: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: [],
  }
}

function runCheck(name: string, fn: () => void): void {
  fn()
  console.log(`PASS ${name}`)
}

runCheck("linear main-port graph is builder-safe", () => {
  const mission = buildMission({
    nodes: [
      { id: "n1", type: "schedule-trigger" },
      { id: "n2", type: "ai-generate" },
      { id: "n3", type: "telegram-output" },
    ],
    connections: [
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
      { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
    ],
  })
  assert.equal(missionHasNonLinearGraph(mission), false)
  assert.equal(missionRequiresCanvasEditor(mission), false)
})

runCheck("fan-out graph requires canvas editor", () => {
  const mission = buildMission({
    nodes: [
      { id: "n1", type: "schedule-trigger" },
      { id: "n2", type: "ai-generate" },
      { id: "n3", type: "telegram-output" },
      { id: "n4", type: "email-output" },
    ],
    connections: [
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
      { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
      { id: "c3", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
    ],
  })
  assert.equal(missionHasNonLinearGraph(mission), true)
  assert.equal(missionRequiresCanvasEditor(mission), true)
})

runCheck("agent node types force canvas editor", () => {
  const mission = buildMission({
    nodes: [
      { id: "n1", type: "agent-supervisor" },
      { id: "n2", type: "agent-worker" },
    ],
    connections: [
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
    ],
  })
  assert.equal(missionHasAgentPhase0Nodes(mission), true)
  assert.equal(missionRequiresCanvasEditor(mission), true)
})

runCheck("non-main ports require canvas editor", () => {
  const mission = buildMission({
    nodes: [
      { id: "n1", type: "condition" },
      { id: "n2", type: "telegram-output" },
      { id: "n3", type: "email-output" },
    ],
    connections: [
      { id: "c1", sourceNodeId: "n1", sourcePort: "true", targetNodeId: "n2", targetPort: "main" },
      { id: "c2", sourceNodeId: "n1", sourcePort: "false", targetNodeId: "n3", targetPort: "main" },
    ],
  })
  assert.equal(missionHasNonLinearGraph(mission), true)
  assert.equal(missionRequiresCanvasEditor(mission), true)
})

runCheck("canvas-only node types force canvas editor", () => {
  const mission = buildMission({
    nodes: [
      { id: "n1", type: "polymarket-price-trigger" },
      { id: "n2", type: "telegram-output" },
    ],
    connections: [
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
    ],
  })
  assert.equal(missionHasCanvasOnlyNodes(mission), true)
  assert.equal(missionRequiresCanvasEditor(mission), true)
})
