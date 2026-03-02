import type { Mission } from "../../types/index"
import type { MissionDiffOperation } from "./types"

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function deriveDiffOperationsFromMissionSnapshot(current: Mission, next: Mission): MissionDiffOperation[] {
  const operations: MissionDiffOperation[] = []

  const currentNodesById = new Map(current.nodes.map((node) => [node.id, node]))
  const nextNodesById = new Map(next.nodes.map((node) => [node.id, node]))

  for (const node of current.nodes) {
    if (!nextNodesById.has(node.id)) {
      operations.push({ type: "removeNode", nodeId: node.id })
    }
  }

  for (const node of next.nodes) {
    const existing = currentNodesById.get(node.id)
    if (!existing) {
      operations.push({ type: "addNode", node })
      continue
    }
    if (existing.position.x !== node.position.x || existing.position.y !== node.position.y) {
      operations.push({
        type: "moveNode",
        nodeId: node.id,
        position: node.position,
      })
    }
    const comparableExisting = { ...existing, position: undefined }
    const comparableNext = { ...node, position: undefined }
    if (!equalJson(comparableExisting, comparableNext)) {
      operations.push({
        type: "updateNode",
        nodeId: node.id,
        patch: node,
      })
    }
  }

  const currentConnectionsById = new Map(current.connections.map((connection) => [connection.id, connection]))
  const nextConnectionsById = new Map(next.connections.map((connection) => [connection.id, connection]))
  for (const connection of current.connections) {
    if (!nextConnectionsById.has(connection.id)) {
      operations.push({ type: "removeConnection", connectionId: connection.id })
    }
  }
  for (const connection of next.connections) {
    const existing = currentConnectionsById.get(connection.id)
    if (!existing) {
      operations.push({ type: "addConnection", connection })
      continue
    }
    if (!equalJson(existing, connection)) {
      operations.push({ type: "removeConnection", connectionId: connection.id })
      operations.push({ type: "addConnection", connection })
    }
  }

  const metadataChanged =
    current.label !== next.label ||
    current.description !== next.description ||
    current.status !== next.status ||
    !equalJson(current.tags, next.tags) ||
    !equalJson(current.settings, next.settings) ||
    current.integration !== next.integration ||
    !equalJson(current.chatIds, next.chatIds)
  if (metadataChanged) {
    operations.push({
      type: "updateMissionMetadata",
      patch: {
        label: next.label,
        description: next.description,
        status: next.status,
        tags: next.tags,
        settings: next.settings,
        integration: next.integration,
        chatIds: next.chatIds,
      },
    })
  }

  return operations
}
