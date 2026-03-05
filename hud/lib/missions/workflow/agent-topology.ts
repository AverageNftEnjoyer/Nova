import type { MissionNode, Provider } from "../types/index"

type AgentIdentityNode = Extract<MissionNode, { type: "agent-supervisor" | "agent-worker" | "agent-audit" }>
type AgentHandoffNode = Extract<MissionNode, { type: "agent-handoff" }>

export const ALL_MISSION_PROVIDERS: Provider[] = ["claude", "openai", "gemini", "grok"]

function isAgentIdentityNode(node: MissionNode): node is AgentIdentityNode {
  return node.type === "agent-supervisor" || node.type === "agent-worker" || node.type === "agent-audit"
}

function isAgentHandoffNode(node: MissionNode): node is AgentHandoffNode {
  return node.type === "agent-handoff"
}

function slugSegment(value: string, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || fallback
}

export function buildScopedAgentId(agentId: string, scope: string): string {
  return `${slugSegment(agentId, "agent")}-${slugSegment(scope, "graph")}`
}

export function buildCommandSpineAgentIds(scope: string): {
  operator: string
  council: string
  manager: string
  worker: string
  audit: string
} {
  return {
    operator: buildScopedAgentId("operator", scope),
    council: buildScopedAgentId("routing-council", scope),
    manager: buildScopedAgentId("system-manager", scope),
    worker: buildScopedAgentId("worker-agent", scope),
    audit: buildScopedAgentId("audit-council", scope),
  }
}

export function buildProviderSelectorDefaults(preferredProvider?: Provider): {
  allowedProviders: Provider[]
  defaultProvider: Provider
} {
  if (preferredProvider && ALL_MISSION_PROVIDERS.includes(preferredProvider)) {
    return {
      allowedProviders: [preferredProvider],
      defaultProvider: preferredProvider,
    }
  }
  return {
    allowedProviders: [...ALL_MISSION_PROVIDERS],
    defaultProvider: ALL_MISSION_PROVIDERS[0],
  }
}

export function namespaceMissionAgentGraph(nodes: MissionNode[], scope: string): MissionNode[] {
  const agentIdMap = new Map<string, string>()

  for (const node of nodes) {
    if (!isAgentIdentityNode(node)) continue
    const sourceAgentId = String(node.agentId || "").trim()
    if (!sourceAgentId || agentIdMap.has(sourceAgentId)) continue
    agentIdMap.set(sourceAgentId, buildScopedAgentId(sourceAgentId, scope))
  }

  return nodes.map((node) => {
    if (isAgentIdentityNode(node)) {
      const sourceAgentId = String(node.agentId || "").trim()
      return sourceAgentId
        ? { ...node, agentId: agentIdMap.get(sourceAgentId) || sourceAgentId }
        : { ...node }
    }
    if (isAgentHandoffNode(node)) {
      const fromAgentId = String(node.fromAgentId || "").trim()
      const toAgentId = String(node.toAgentId || "").trim()
      return {
        ...node,
        fromAgentId: agentIdMap.get(fromAgentId) || fromAgentId,
        toAgentId: agentIdMap.get(toAgentId) || toAgentId,
      }
    }
    return { ...node }
  })
}
