import assert from "node:assert/strict"

import type { Mission } from "../../types/index.ts"
import { getTemplate, instantiateTemplate } from "../../templates/index.ts"
import { isMissionAgentExecutorEnabled, isMissionAgentGraphEnabled } from "../agent-flags.ts"
import { executeMission } from "../execute-mission.ts"
import { EXECUTOR_REGISTRY } from "../executors/index.ts"
import { validateMissionGraphForVersioning } from "../versioning/index.ts"

function runCheck(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    console.log(`PASS ${name}`)
  })
}

function buildRetryMission(): Mission {
  const now = new Date("2026-03-05T12:00:00.000Z").toISOString()
  return {
    id: "agent-retry-mission",
    userId: "agent-roadmap-user",
    label: "Agent Retry Mission",
    description: "Validates worker retry handling.",
    category: "research",
    tags: ["agents"],
    status: "draft",
    version: 1,
    nodes: [
      { id: "n1", type: "manual-trigger", label: "Start", position: { x: 0, y: 0 } },
      { id: "n2", type: "agent-supervisor", label: "Operator", position: { x: 220, y: 0 }, agentId: "operator", role: "operator", goal: "Command", timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
      { id: "n3", type: "agent-worker", label: "Routing Council", position: { x: 440, y: 0 }, agentId: "routing-council", role: "routing-council", goal: "Route", timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
      { id: "n4", type: "agent-worker", label: "System Manager", position: { x: 660, y: 0 }, agentId: "system-manager", role: "system-manager", goal: "Assign", timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
      { id: "n5", type: "agent-worker", label: "Worker", position: { x: 880, y: 0 }, agentId: "worker-1", role: "worker-agent", goal: "Execute", timeoutMs: 120000, retryPolicy: { maxAttempts: 2, backoffMs: 0 } },
      { id: "n6", type: "provider-selector", label: "Provider", position: { x: 1100, y: 0 }, allowedProviders: ["claude", "openai"], defaultProvider: "claude", strategy: "policy" },
      { id: "n7", type: "agent-audit", label: "Audit", position: { x: 1320, y: 0 }, agentId: "audit-council", role: "audit-council", goal: "Audit", requiredChecks: ["user-context-isolation", "policy-guardrails"], timeoutMs: 120000, retryPolicy: { maxAttempts: 1, backoffMs: 0 } },
      { id: "n8", type: "agent-handoff", label: "Operator->Council", position: { x: 1540, y: 0 }, fromAgentId: "operator", toAgentId: "routing-council", reason: "route intent" },
      { id: "n9", type: "agent-handoff", label: "Council->Manager", position: { x: 1760, y: 0 }, fromAgentId: "routing-council", toAgentId: "system-manager", reason: "pick manager" },
      { id: "n10", type: "agent-handoff", label: "Manager->Worker", position: { x: 1980, y: 0 }, fromAgentId: "system-manager", toAgentId: "worker-1", reason: "delegate" },
      { id: "n11", type: "agent-handoff", label: "Worker->Audit", position: { x: 2200, y: 0 }, fromAgentId: "worker-1", toAgentId: "audit-council", reason: "review" },
      { id: "n12", type: "agent-handoff", label: "Audit->Operator", position: { x: 2420, y: 0 }, fromAgentId: "audit-council", toAgentId: "operator", reason: "finalize" },
    ],
    connections: [
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
      { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
      { id: "c3", sourceNodeId: "n3", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
      { id: "c4", sourceNodeId: "n4", sourcePort: "main", targetNodeId: "n5", targetPort: "main" },
      { id: "c5", sourceNodeId: "n5", sourcePort: "main", targetNodeId: "n6", targetPort: "main" },
      { id: "c6", sourceNodeId: "n6", sourcePort: "main", targetNodeId: "n7", targetPort: "main" },
      { id: "c7", sourceNodeId: "n7", sourcePort: "main", targetNodeId: "n8", targetPort: "main" },
      { id: "c8", sourceNodeId: "n8", sourcePort: "main", targetNodeId: "n9", targetPort: "main" },
      { id: "c9", sourceNodeId: "n9", sourcePort: "main", targetNodeId: "n10", targetPort: "main" },
      { id: "c10", sourceNodeId: "n10", sourcePort: "main", targetNodeId: "n11", targetPort: "main" },
      { id: "c11", sourceNodeId: "n11", sourcePort: "main", targetNodeId: "n12", targetPort: "main" },
    ],
    variables: [],
    settings: {
      timezone: "America/New_York",
      retryOnFail: false,
      retryCount: 0,
      retryIntervalMs: 1000,
      saveExecutionProgress: true,
    },
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: [],
  }
}

await runCheck("agent feature flags default to enabled", async () => {
  const originalGraph = process.env.NOVA_MISSIONS_AGENT_GRAPH_ENABLED
  const originalExecutor = process.env.NOVA_MISSIONS_AGENT_EXECUTOR_ENABLED
  delete process.env.NOVA_MISSIONS_AGENT_GRAPH_ENABLED
  delete process.env.NOVA_MISSIONS_AGENT_EXECUTOR_ENABLED
  assert.equal(isMissionAgentGraphEnabled(), true)
  assert.equal(isMissionAgentExecutorEnabled(), true)
  process.env.NOVA_MISSIONS_AGENT_GRAPH_ENABLED = "0"
  process.env.NOVA_MISSIONS_AGENT_EXECUTOR_ENABLED = "0"
  assert.equal(isMissionAgentGraphEnabled(), false)
  assert.equal(isMissionAgentExecutorEnabled(), false)
  if (originalGraph === undefined) delete process.env.NOVA_MISSIONS_AGENT_GRAPH_ENABLED
  else process.env.NOVA_MISSIONS_AGENT_GRAPH_ENABLED = originalGraph
  if (originalExecutor === undefined) delete process.env.NOVA_MISSIONS_AGENT_EXECUTOR_ENABLED
  else process.env.NOVA_MISSIONS_AGENT_EXECUTOR_ENABLED = originalExecutor
})

await runCheck("agent templates instantiate as valid mission graphs", async () => {
  const researchTemplate = getTemplate("agent-research-desk")
  const incidentTemplate = getTemplate("agent-incident-command")
  assert.equal(Boolean(researchTemplate), true)
  assert.equal(Boolean(incidentTemplate), true)
  const researchMission = instantiateTemplate(researchTemplate!, "template-user")
  const incidentMission = instantiateTemplate(incidentTemplate!, "template-user")
  assert.deepEqual(validateMissionGraphForVersioning(researchMission), [])
  assert.deepEqual(validateMissionGraphForVersioning(incidentMission), [])
})

await runCheck("agent worker retry policy retries failed execution once", async () => {
  const mission = buildRetryMission()
  const originalWorkerExecutor = EXECUTOR_REGISTRY["agent-worker"]
  let workerFailures = 0
  EXECUTOR_REGISTRY["agent-worker"] = async (node, ctx) => {
    const typedNode = node as Extract<Mission["nodes"][number], { type: "agent-worker" }>
    if (typedNode.agentId === "worker-1" && workerFailures === 0) {
      workerFailures += 1
      return { ok: false, error: "Transient worker failure.", errorCode: "TRANSIENT_WORKER_FAILURE" }
    }
    return originalWorkerExecutor(node, ctx)
  }

  try {
    const result = await executeMission({
      mission,
      source: "trigger",
      userContextId: "agent-roadmap-user",
      conversationId: "agent-roadmap-conversation",
      sessionKey: "agent:nova:hud:user:agent-roadmap-user:dm:agent-roadmap-conversation",
      runKey: "agent-roadmap-run",
      attempt: 1,
    })
    assert.equal(result.ok, true)
    const workerTrace = result.nodeTraces.find((trace) => trace.nodeId === "n5" && trace.status === "completed")
    assert.equal(Boolean(workerTrace), true)
    assert.equal(workerTrace?.retryCount, 1)
  } finally {
    EXECUTOR_REGISTRY["agent-worker"] = originalWorkerExecutor
  }
})
