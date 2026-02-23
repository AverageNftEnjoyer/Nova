import type { Mission, MissionConnection, MissionNode } from "../../types"
import type {
  MissionDiffApplyInput,
  MissionDiffApplyResult,
  MissionDiffIssue,
  MissionDiffOperation,
} from "./types"

function cloneMission(mission: Mission): Mission {
  return JSON.parse(JSON.stringify(mission)) as Mission
}

function graphIssues(mission: Mission): MissionDiffIssue[] {
  const issues: MissionDiffIssue[] = []
  const nodeIds = new Set<string>()
  const connectionIds = new Set<string>()

  mission.nodes.forEach((node, index) => {
    const id = String(node.id || "").trim()
    if (!id) {
      issues.push({
        code: "mission.node_id_missing",
        operationIndex: -1,
        path: `mission.nodes[${index}].id`,
        message: "Node id is required.",
      })
      return
    }
    if (nodeIds.has(id)) {
      issues.push({
        code: "mission.node_id_duplicate",
        operationIndex: -1,
        path: `mission.nodes[${index}].id`,
        message: `Duplicate node id "${id}".`,
      })
      return
    }
    nodeIds.add(id)
  })

  mission.connections.forEach((connection, index) => {
    const connectionId = String(connection.id || "").trim()
    if (!connectionId) {
      issues.push({
        code: "mission.connection_id_missing",
        operationIndex: -1,
        path: `mission.connections[${index}].id`,
        message: "Connection id is required.",
      })
    } else if (connectionIds.has(connectionId)) {
      issues.push({
        code: "mission.connection_id_duplicate",
        operationIndex: -1,
        path: `mission.connections[${index}].id`,
        message: `Duplicate connection id "${connectionId}".`,
      })
    } else {
      connectionIds.add(connectionId)
    }

    const source = String(connection.sourceNodeId || "").trim()
    const target = String(connection.targetNodeId || "").trim()
    if (!source || !nodeIds.has(source)) {
      issues.push({
        code: "mission.connection_source_invalid",
        operationIndex: -1,
        path: `mission.connections[${index}].sourceNodeId`,
        message: `Connection source "${source || "unknown"}" is not a valid node id.`,
      })
    }
    if (!target || !nodeIds.has(target)) {
      issues.push({
        code: "mission.connection_target_invalid",
        operationIndex: -1,
        path: `mission.connections[${index}].targetNodeId`,
        message: `Connection target "${target || "unknown"}" is not a valid node id.`,
      })
    }
  })

  return issues
}

function issue(operationIndex: number, path: string, code: string, message: string): MissionDiffIssue {
  return { operationIndex, path, code, message }
}

function findNodeIndex(nodes: MissionNode[], nodeId: string): number {
  return nodes.findIndex((node) => String(node.id || "").trim() === nodeId)
}

function findConnectionIndex(connections: MissionConnection[], connectionId: string): number {
  return connections.findIndex((connection) => String(connection.id || "").trim() === connectionId)
}

function applyOperation(
  mission: Mission,
  operation: MissionDiffOperation,
  operationIndex: number,
): MissionDiffIssue | null {
  if (operation.type === "addNode") {
    const nodeId = String(operation.node?.id || "").trim()
    if (!nodeId) return issue(operationIndex, "operations.node.id", "diff.node_id_missing", "addNode requires node.id.")
    if (findNodeIndex(mission.nodes, nodeId) >= 0) {
      return issue(operationIndex, "operations.node.id", "diff.node_id_duplicate", `Node "${nodeId}" already exists.`)
    }
    mission.nodes.push(operation.node)
    return null
  }

  if (operation.type === "removeNode") {
    const nodeId = String(operation.nodeId || "").trim()
    const idx = findNodeIndex(mission.nodes, nodeId)
    if (idx < 0) return issue(operationIndex, "operations.nodeId", "diff.node_not_found", `Node "${nodeId}" was not found.`)
    mission.nodes.splice(idx, 1)
    mission.connections = mission.connections.filter((connection) => connection.sourceNodeId !== nodeId && connection.targetNodeId !== nodeId)
    return null
  }

  if (operation.type === "updateNode") {
    const nodeId = String(operation.nodeId || "").trim()
    const idx = findNodeIndex(mission.nodes, nodeId)
    if (idx < 0) return issue(operationIndex, "operations.nodeId", "diff.node_not_found", `Node "${nodeId}" was not found.`)
    const prev = mission.nodes[idx]
    const next = {
      ...prev,
      ...operation.patch,
      id: prev.id,
      type: prev.type,
    }
    mission.nodes[idx] = next as MissionNode
    return null
  }

  if (operation.type === "moveNode") {
    const nodeId = String(operation.nodeId || "").trim()
    const idx = findNodeIndex(mission.nodes, nodeId)
    if (idx < 0) return issue(operationIndex, "operations.nodeId", "diff.node_not_found", `Node "${nodeId}" was not found.`)
    mission.nodes[idx] = {
      ...mission.nodes[idx],
      position: {
        x: Number(operation.position?.x || 0),
        y: Number(operation.position?.y || 0),
      },
    } as MissionNode
    return null
  }

  if (operation.type === "addConnection") {
    const connectionId = String(operation.connection?.id || "").trim()
    if (!connectionId) {
      return issue(operationIndex, "operations.connection.id", "diff.connection_id_missing", "addConnection requires connection.id.")
    }
    if (findConnectionIndex(mission.connections, connectionId) >= 0) {
      return issue(operationIndex, "operations.connection.id", "diff.connection_id_duplicate", `Connection "${connectionId}" already exists.`)
    }
    const source = String(operation.connection?.sourceNodeId || "").trim()
    const target = String(operation.connection?.targetNodeId || "").trim()
    if (findNodeIndex(mission.nodes, source) < 0) {
      return issue(operationIndex, "operations.connection.sourceNodeId", "diff.connection_source_invalid", `Source node "${source}" not found.`)
    }
    if (findNodeIndex(mission.nodes, target) < 0) {
      return issue(operationIndex, "operations.connection.targetNodeId", "diff.connection_target_invalid", `Target node "${target}" not found.`)
    }
    mission.connections.push(operation.connection)
    return null
  }

  if (operation.type === "removeConnection") {
    const connectionId = String(operation.connectionId || "").trim()
    const idx = findConnectionIndex(mission.connections, connectionId)
    if (idx < 0) {
      return issue(operationIndex, "operations.connectionId", "diff.connection_not_found", `Connection "${connectionId}" was not found.`)
    }
    mission.connections.splice(idx, 1)
    return null
  }

  if (operation.type === "updateMissionMetadata") {
    mission.label = String(operation.patch.label ?? mission.label).trim() || mission.label
    mission.description = String(operation.patch.description ?? mission.description)
    mission.status = (operation.patch.status ?? mission.status) as Mission["status"]
    mission.tags = Array.isArray(operation.patch.tags) ? operation.patch.tags.map((tag) => String(tag)).filter(Boolean) : mission.tags
    mission.settings = operation.patch.settings ? { ...mission.settings, ...operation.patch.settings } : mission.settings
    mission.integration = String(operation.patch.integration ?? mission.integration).trim() || mission.integration
    mission.chatIds = Array.isArray(operation.patch.chatIds) ? operation.patch.chatIds.map((row) => String(row)).filter(Boolean) : mission.chatIds
    return null
  }

  return issue(operationIndex, "operations.type", "diff.operation_unsupported", `Unsupported operation type "${String((operation as { type?: unknown }).type || "")}".`)
}

export function applyMissionDiff(input: MissionDiffApplyInput): MissionDiffApplyResult {
  const issues: MissionDiffIssue[] = []
  const expectedVersion = Number.isFinite(input.expectedVersion) ? Number(input.expectedVersion) : undefined
  if (typeof expectedVersion === "number" && expectedVersion !== input.mission.version) {
    return {
      ok: false,
      appliedCount: 0,
      issues: [
        issue(
          -1,
          "mission.version",
          "diff.version_conflict",
          `Expected mission version ${expectedVersion}, received ${input.mission.version}.`,
        ),
      ],
    }
  }

  const working = cloneMission(input.mission)
  let appliedCount = 0
  for (let index = 0; index < input.operations.length; index += 1) {
    const maybeIssue = applyOperation(working, input.operations[index], index)
    if (maybeIssue) {
      issues.push(maybeIssue)
      continue
    }
    appliedCount += 1
  }

  if (issues.length > 0) {
    return {
      ok: false,
      appliedCount,
      issues,
    }
  }

  const finalGraphIssues = graphIssues(working)
  if (finalGraphIssues.length > 0) {
    return {
      ok: false,
      appliedCount,
      issues: finalGraphIssues,
    }
  }

  const nowIso = String(input.nowIso || new Date().toISOString())
  const nextVersion = Math.max(1, Number(working.version || 0) + 1)
  return {
    ok: true,
    appliedCount,
    issues: [],
    mission: {
      ...working,
      version: nextVersion,
      updatedAt: nowIso,
    },
  }
}
