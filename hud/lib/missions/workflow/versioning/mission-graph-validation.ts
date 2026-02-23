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
  })

  return issues
}
