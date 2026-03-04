import type {
  Mission,
  MissionConnection,
  MissionNode,
  CouncilAgentRole,
  DomainManagerRole,
  OrgChartAgentRole,
} from "../../types/index"

export interface MissionGraphValidationIssue {
  code: string
  path: string
  message: string
}

const COUNCIL_ROLES = new Set<CouncilAgentRole>([
  "routing-council",
  "policy-council",
  "memory-council",
  "planning-council",
])

const DOMAIN_MANAGER_ROLES = new Set<DomainManagerRole>([
  "media-manager",
  "finance-manager",
  "productivity-manager",
  "comms-manager",
  "system-manager",
])

const OUTPUT_NODE_TYPES = new Set([
  "telegram-output",
  "discord-output",
  "email-output",
  "webhook-output",
  "slack-output",
])

const LEGACY_BLOCKED_NODE_TYPES = new Set([
  "sub-workflow",
])

function roleStage(role: OrgChartAgentRole): "operator" | "council" | "domain-manager" | "worker" | "audit" {
  if (role === "operator") return "operator"
  if (role === "audit-council") return "audit"
  if (COUNCIL_ROLES.has(role as CouncilAgentRole)) return "council"
  if (DOMAIN_MANAGER_ROLES.has(role as DomainManagerRole)) return "domain-manager"
  return "worker"
}

function validateAgentContracts(
  nodes: MissionNode[],
  connections: MissionConnection[],
  issues: MissionGraphValidationIssue[],
): void {
  const supervisorNodes = nodes.filter((node): node is Extract<MissionNode, { type: "agent-supervisor" }> => node.type === "agent-supervisor")
  const workerNodes = nodes.filter((node): node is Extract<MissionNode, { type: "agent-worker" }> => node.type === "agent-worker")
  const handoffNodes = nodes.filter((node): node is Extract<MissionNode, { type: "agent-handoff" }> => node.type === "agent-handoff")
  const readNodes = nodes.filter((node): node is Extract<MissionNode, { type: "agent-state-read" }> => node.type === "agent-state-read")
  const writeNodes = nodes.filter((node): node is Extract<MissionNode, { type: "agent-state-write" }> => node.type === "agent-state-write")
  const providerNodes = nodes.filter((node): node is Extract<MissionNode, { type: "provider-selector" }> => node.type === "provider-selector")
  const auditNodes = nodes.filter((node): node is Extract<MissionNode, { type: "agent-audit" }> => node.type === "agent-audit")

  if (supervisorNodes.length !== 1) {
    issues.push({
      code: "mission.agent.operator_required",
      path: "mission.nodes",
      message: "Agent missions require exactly one agent-supervisor with role operator.",
    })
  }
  const invalidSupervisorRole = supervisorNodes.find((node) => node.role !== "operator")
  if (invalidSupervisorRole) {
    issues.push({
      code: "mission.agent.operator_role_invalid",
      path: `mission.nodes.${invalidSupervisorRole.id}.role`,
      message: `Supervisor ${invalidSupervisorRole.id} must use role "operator".`,
    })
  }

  const hasCouncil = workerNodes.some((node) => COUNCIL_ROLES.has(node.role as CouncilAgentRole))
  const hasDomainManager = workerNodes.some((node) => DOMAIN_MANAGER_ROLES.has(node.role as DomainManagerRole))
  const hasWorker = workerNodes.some((node) => node.role === "worker-agent")
  if (!hasCouncil) {
    issues.push({
      code: "mission.agent.council_required",
      path: "mission.nodes",
      message: "Agent missions require at least one council role node.",
    })
  }
  if (!hasDomainManager) {
    issues.push({
      code: "mission.agent.domain_manager_required",
      path: "mission.nodes",
      message: "Agent missions require at least one domain manager node.",
    })
  }
  if (!hasWorker) {
    issues.push({
      code: "mission.agent.worker_required",
      path: "mission.nodes",
      message: "Agent missions require at least one worker-agent node.",
    })
  }
  if (auditNodes.length !== 1) {
    issues.push({
      code: "mission.agent.audit_required",
      path: "mission.nodes",
      message: "Agent missions require exactly one dedicated agent-audit node.",
    })
  }
  if (providerNodes.length !== 1) {
    issues.push({
      code: "mission.agent.provider_selector_required",
      path: "mission.nodes",
      message: "Agent missions require exactly one provider-selector node.",
    })
  }

  const roleByAgentId = new Map<string, OrgChartAgentRole>()
  const agentNodes = [...supervisorNodes, ...workerNodes, ...auditNodes]
  for (const node of agentNodes) {
    const agentId = String(node.agentId || "").trim()
    if (!agentId) {
      issues.push({
        code: "mission.agent.agent_id_missing",
        path: `mission.nodes.${node.id}.agentId`,
        message: "Agent node is missing agentId.",
      })
      continue
    }
    if (roleByAgentId.has(agentId)) {
      issues.push({
        code: "mission.agent.agent_id_duplicate",
        path: `mission.nodes.${node.id}.agentId`,
        message: `Duplicate agentId "${agentId}" is not allowed.`,
      })
      continue
    }
    if (node.type === "agent-supervisor") {
      roleByAgentId.set(agentId, "operator")
      continue
    }
    if (node.type === "agent-audit") {
      roleByAgentId.set(agentId, "audit-council")
      continue
    }
    roleByAgentId.set(agentId, node.role)
  }

  const declaredReads = new Set<string>()
  const declaredWrites = new Set<string>()
  for (const node of [...supervisorNodes, ...workerNodes, ...auditNodes]) {
    for (const key of node.reads || []) {
      const normalized = String(key || "").trim()
      if (normalized) declaredReads.add(normalized)
    }
    for (const key of node.writes || []) {
      const normalized = String(key || "").trim()
      if (normalized) declaredWrites.add(normalized)
    }
  }

  for (const node of readNodes) {
    if (!declaredReads.has(node.key)) {
      issues.push({
        code: "mission.agent.state_read_undeclared",
        path: `mission.nodes.${node.id}.key`,
        message: `State read key "${node.key}" is not declared in any agent reads list.`,
      })
    }
  }
  for (const node of writeNodes) {
    if (!declaredWrites.has(node.key)) {
      issues.push({
        code: "mission.agent.state_write_undeclared",
        path: `mission.nodes.${node.id}.key`,
        message: `State write key "${node.key}" is not declared in any agent writes list.`,
      })
    }
  }

  const handoffEdges = new Map<string, Set<string>>()
  const addHandoffEdge = (from: string, to: string) => {
    if (!handoffEdges.has(from)) handoffEdges.set(from, new Set<string>())
    handoffEdges.get(from)!.add(to)
  }

  let hasOperatorToCouncil = false
  let hasCouncilToDomainManager = false
  let hasDomainManagerToWorker = false
  let hasWorkerToAudit = false
  let hasAuditToOperator = false

  for (const node of handoffNodes) {
    const fromRole = roleByAgentId.get(node.fromAgentId)
    const toRole = roleByAgentId.get(node.toAgentId)
    if (!fromRole) {
      issues.push({
        code: "mission.agent.handoff_unknown_source",
        path: `mission.nodes.${node.id}.fromAgentId`,
        message: `Handoff source agentId "${node.fromAgentId}" is not declared by any agent node.`,
      })
      continue
    }
    if (!toRole) {
      issues.push({
        code: "mission.agent.handoff_unknown_target",
        path: `mission.nodes.${node.id}.toAgentId`,
        message: `Handoff target agentId "${node.toAgentId}" is not declared by any agent node.`,
      })
      continue
    }
    if (!String(node.reason || "").trim()) {
      issues.push({
        code: "mission.agent.handoff_reason_missing",
        path: `mission.nodes.${node.id}.reason`,
        message: "Agent handoff reason is required.",
      })
    }
    const fromStage = roleStage(fromRole)
    const toStage = roleStage(toRole)
    const allowed =
      (fromStage === "operator" && toStage === "council")
      || (fromStage === "council" && (toStage === "council" || toStage === "domain-manager"))
      || (fromStage === "domain-manager" && (toStage === "worker" || toStage === "council"))
      || (fromStage === "worker" && (toStage === "domain-manager" || toStage === "council" || toStage === "audit"))
      || (fromStage === "audit" && toStage === "operator")
    if (!allowed) {
      issues.push({
        code: "mission.agent.handoff_stage_violation",
        path: `mission.nodes.${node.id}`,
        message: `Invalid handoff stage transition ${fromRole} -> ${toRole}.`,
      })
    }
    if (fromStage === "operator" && toStage === "council") hasOperatorToCouncil = true
    if (fromStage === "council" && toStage === "domain-manager") hasCouncilToDomainManager = true
    if (fromStage === "domain-manager" && toStage === "worker") hasDomainManagerToWorker = true
    if (fromStage === "worker" && toStage === "audit") hasWorkerToAudit = true
    if (fromStage === "audit" && toStage === "operator") hasAuditToOperator = true
    addHandoffEdge(node.fromAgentId, node.toAgentId)
  }

  if (handoffNodes.length === 0) {
    issues.push({
      code: "mission.agent.handoff_required",
      path: "mission.nodes",
      message: "Agent missions require explicit agent-handoff nodes for command-spine transitions.",
    })
  } else {
    if (!hasOperatorToCouncil) {
      issues.push({
        code: "mission.agent.handoff_operator_to_council_required",
        path: "mission.nodes",
        message: "Agent handoffs must include operator -> council.",
      })
    }
    if (!hasCouncilToDomainManager) {
      issues.push({
        code: "mission.agent.handoff_council_to_domain_required",
        path: "mission.nodes",
        message: "Agent handoffs must include council -> domain-manager.",
      })
    }
    if (!hasDomainManagerToWorker) {
      issues.push({
        code: "mission.agent.handoff_domain_to_worker_required",
        path: "mission.nodes",
        message: "Agent handoffs must include domain-manager -> worker.",
      })
    }
    if (!hasWorkerToAudit) {
      issues.push({
        code: "mission.agent.handoff_worker_to_audit_required",
        path: "mission.nodes",
        message: "Agent handoffs must include worker -> audit.",
      })
    }
    if (!hasAuditToOperator) {
      issues.push({
        code: "mission.agent.handoff_audit_to_operator_required",
        path: "mission.nodes",
        message: "Agent handoffs must include audit -> operator.",
      })
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  for (const connection of connections) {
    const targetNodeType = nodeById.get(connection.targetNodeId)?.type
    if (!targetNodeType || !OUTPUT_NODE_TYPES.has(targetNodeType)) continue
    const sourceNode = nodeById.get(connection.sourceNodeId)
    if (!sourceNode) continue
    if (
      sourceNode.type === "agent-worker"
      || sourceNode.type === "agent-audit"
      || sourceNode.type === "provider-selector"
    ) {
      issues.push({
        code: "mission.agent.output_source_invalid",
        path: `mission.connections.${connection.id}`,
        message: `Output node cannot receive direct input from ${sourceNode.type}. Route through operator composition.`,
      })
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const hasHandoffCycleFrom = (agentId: string): boolean => {
    if (visiting.has(agentId)) return true
    if (visited.has(agentId)) return false
    visiting.add(agentId)
    const next = handoffEdges.get(agentId) || new Set<string>()
    for (const target of next) {
      if (hasHandoffCycleFrom(target)) return true
    }
    visiting.delete(agentId)
    visited.add(agentId)
    return false
  }
  for (const agentId of handoffEdges.keys()) {
    if (hasHandoffCycleFrom(agentId)) {
      issues.push({
        code: "mission.agent.handoff_cycle_detected",
        path: "mission.nodes",
        message: "Agent handoff graph contains a cycle.",
      })
      break
    }
  }
}

export function validateMissionGraphForVersioning(mission: Mission): MissionGraphValidationIssue[] {
  const issues: MissionGraphValidationIssue[] = []
  const nodes = Array.isArray(mission.nodes) ? mission.nodes : []
  const connections = Array.isArray(mission.connections) ? mission.connections : []
  const nodeIdSet = new Set<string>()
  const nodeLabelSet = new Set<string>()
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

    const nodeLabel = String(node?.label || "").trim()
    if (nodeLabel) {
      if (nodeLabelSet.has(nodeLabel)) {
        issues.push({
          code: "mission.node_label_duplicate",
          path: `${nodePath}.label`,
          message: `Duplicate node label "${nodeLabel}". Labels must be unique for expression resolution.`,
        })
      } else {
        nodeLabelSet.add(nodeLabel)
      }
    }

    if (LEGACY_BLOCKED_NODE_TYPES.has(String(node?.type || "").trim())) {
      issues.push({
        code: "mission.node_type_legacy_blocked",
        path: `${nodePath}.type`,
        message: `Node type "${String(node?.type || "")}" is legacy and no longer supported. Use "agent-subworkflow" under command-spine orchestration.`,
      })
    }
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
      sourceNodeId
      && targetNodeId
      && sourceNodeId !== targetNodeId
      && nodeIdSet.has(sourceNodeId)
      && nodeIdSet.has(targetNodeId)
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

  const hasAgentNodes = nodes.some((node) => node.type.startsWith("agent-") || node.type === "provider-selector")
  if (hasAgentNodes) {
    validateAgentContracts(nodes, connections, issues)
  }

  return issues
}
