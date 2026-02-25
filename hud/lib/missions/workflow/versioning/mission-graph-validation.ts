import type { Mission, MissionConnection, MissionNode } from "../../types"

export interface MissionGraphValidationIssue {
  code: string
  path: string
  message: string
}

export function validateMissionGraphForVersioning(mission: Mission): MissionGraphValidationIssue[] {
  const issues: MissionGraphValidationIssue[] = []
  const nodes = Array.isArray(mission.nodes) ? mission.nodes : []
  const connections = Array.isArray(mission.connections) ? mission.connections : []
  const nodeIdSet = new Set<string>()
  const connectionIdSet = new Set<string>()
  const validConnections: MissionConnection[] = []

  nodes.forEach((node: MissionNode, index) => {
    const nodePath = `mission.nodes[${index}]`
    const nodeId = String(node?.id || "").trim()
    if (!nodeId) {
      issues.push({
        code: "mission.node_id_missing",
        path: `${nodePath}.id`,
        message: "Node id is required.",
      })
      return
    }
    if (nodeIdSet.has(nodeId)) {
      issues.push({
        code: "mission.node_id_duplicate",
        path: `${nodePath}.id`,
        message: `Duplicate node id "${nodeId}".`,
      })
      return
    }
    nodeIdSet.add(nodeId)
  })

  connections.forEach((connection: MissionConnection, index) => {
    const connectionPath = `mission.connections[${index}]`
    const connectionId = String(connection?.id || "").trim()
    const sourceNodeId = String(connection?.sourceNodeId || "").trim()
    const targetNodeId = String(connection?.targetNodeId || "").trim()

    if (!connectionId) {
      issues.push({
        code: "mission.connection_id_missing",
        path: `${connectionPath}.id`,
        message: "Connection id is required.",
      })
    } else if (connectionIdSet.has(connectionId)) {
      issues.push({
        code: "mission.connection_id_duplicate",
        path: `${connectionPath}.id`,
        message: `Duplicate connection id "${connectionId}".`,
      })
    } else {
      connectionIdSet.add(connectionId)
    }

    if (!sourceNodeId || !nodeIdSet.has(sourceNodeId)) {
      issues.push({
        code: "mission.connection_source_invalid",
        path: `${connectionPath}.sourceNodeId`,
        message: `Connection source "${sourceNodeId || "unknown"}" does not reference a valid node id.`,
      })
    }
    if (!targetNodeId || !nodeIdSet.has(targetNodeId)) {
      issues.push({
        code: "mission.connection_target_invalid",
        path: `${connectionPath}.targetNodeId`,
        message: `Connection target "${targetNodeId || "unknown"}" does not reference a valid node id.`,
      })
    }
    if (sourceNodeId && targetNodeId && sourceNodeId === targetNodeId) {
      issues.push({
        code: "mission.connection_self_loop",
        path: connectionPath,
        message: `Connection "${connectionId || "unknown"}" is a self-loop on node "${sourceNodeId}".`,
      })
    }
    if (
      sourceNodeId &&
      targetNodeId &&
      sourceNodeId !== targetNodeId &&
      nodeIdSet.has(sourceNodeId) &&
      nodeIdSet.has(targetNodeId)
    ) {
      validConnections.push(connection)
    }
  })

  if (nodeIdSet.size > 0 && validConnections.length > 0) {
    const adjacency = new Map<string, string[]>()
    for (const nodeId of nodeIdSet) adjacency.set(nodeId, [])
    for (const connection of validConnections) {
      const source = String(connection.sourceNodeId || "").trim()
      const target = String(connection.targetNodeId || "").trim()
      if (!source || !target) continue
      adjacency.get(source)?.push(target)
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const hasCycleFrom = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true
      if (visited.has(nodeId)) return false
      visiting.add(nodeId)
      const nextNodes = adjacency.get(nodeId) || []
      for (const nextNodeId of nextNodes) {
        if (hasCycleFrom(nextNodeId)) return true
      }
      visiting.delete(nodeId)
      visited.add(nodeId)
      return false
    }

    let cycleDetected = false
    for (const nodeId of nodeIdSet) {
      if (hasCycleFrom(nodeId)) {
        cycleDetected = true
        break
      }
    }
    if (cycleDetected) {
      issues.push({
        code: "mission.graph_cycle_detected",
        path: "mission.connections",
        message: "Mission graph contains at least one directed cycle. DAG execution requires acyclic connections.",
      })
    }
  }

  return issues
}
