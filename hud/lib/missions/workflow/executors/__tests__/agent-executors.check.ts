import assert from "node:assert/strict"

import type { AgentSupervisorNode, AgentSubworkflowNode, AgentWorkerNode, ExecutionContext, Mission } from "../../../types/index"
import { executeAgentSubworkflow, executeAgentSupervisor, executeAgentWorker } from "../agent-executors"

function runCheck(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    console.log(`PASS ${name}`)
  })
}

function baseContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    missionId: "mission-parent",
    missionLabel: "Parent Mission",
    runId: "run-parent",
    attempt: 1,
    now: new Date("2026-03-04T12:00:00.000Z"),
    runSource: "trigger",
    nodeOutputs: new Map(),
    variables: {},
    resolveExpr: (template: string) => template,
    agentState: {
      stateVersion: "phase0",
      userContextId: "executor-check-user",
      conversationId: "executor-check-conversation",
      sessionKey: "agent:nova:hud:user:executor-check-user:dm:executor-check-conversation",
      missionId: "mission-parent",
      runId: "run-parent",
      keys: {},
      declaredKeys: [],
      writePolicies: {},
      auditTrail: [],
    },
    ...overrides,
  }
}

await runCheck("supervisor merge is deterministic by source node id", async () => {
  const supervisorNode: AgentSupervisorNode = {
    id: "sup",
    type: "agent-supervisor",
    label: "Operator",
    position: { x: 0, y: 0 },
    agentId: "operator",
    role: "operator",
    goal: "Compose final response",
  }
  const mission = {
    id: "mission-parent",
    userId: "executor-check-user",
    label: "Parent Mission",
    description: "",
    category: "research",
    tags: [],
    status: "draft",
    version: 1,
    nodes: [
      { id: "n2", type: "manual-trigger", label: "Trigger B", position: { x: 0, y: 0 } },
      { id: "n1", type: "manual-trigger", label: "Trigger A", position: { x: 0, y: 0 } },
      supervisorNode,
    ],
    connections: [
      { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "sup", targetPort: "main" },
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "sup", targetPort: "main" },
    ],
    variables: [],
    settings: {
      timezone: "America/New_York",
      retryOnFail: false,
      retryCount: 0,
      retryIntervalMs: 1000,
      saveExecutionProgress: true,
    },
    createdAt: new Date("2026-03-04T12:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-03-04T12:00:00.000Z").toISOString(),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    integration: "telegram",
    chatIds: [],
  } as Mission

  const ctx = baseContext({ mission })
  ctx.nodeOutputs.set("n2", { ok: true, text: "second" })
  ctx.nodeOutputs.set("n1", { ok: true, text: "first" })

  const result = await executeAgentSupervisor(supervisorNode, ctx)
  assert.equal(result.ok, true)
  const merged = ((result.data as Record<string, unknown>)?.mergedInputs || []) as Array<Record<string, unknown>>
  assert.equal(merged.length, 2)
  assert.equal(String(merged[0]?.sourceNodeId || ""), "n1")
  assert.equal(String(merged[1]?.sourceNodeId || ""), "n2")
})

await runCheck("worker execution uses provider-selector output and carries scoped context", async () => {
  const workerNode: AgentWorkerNode = {
    id: "worker-node",
    type: "agent-worker",
    label: "Worker Agent",
    position: { x: 0, y: 0 },
    agentId: "web-research-agent",
    role: "worker-agent",
    domain: "system",
    goal: "Execute delegated work",
  }
  const ctx = baseContext()
  ctx.nodeOutputs.set("provider", {
    ok: true,
    data: {
      provider: "gemini",
      allowedProviders: ["openai", "gemini"],
      strategy: "policy",
      envelope: {
        ok: true,
        agentId: "provider-selector",
        result: {},
        telemetry: { latencyMs: 0, tokens: 0, provider: "gemini", toolCalls: 0 },
      },
    },
  })
  const result = await executeAgentWorker(workerNode, ctx)
  assert.equal(result.ok, true)
  assert.equal(String((result.data as Record<string, unknown>)?.provider || ""), "gemini")
  assert.equal(String((result.data as Record<string, unknown>)?.providerSource || ""), "provider-selector")
  assert.equal(
    String((result.data as Record<string, unknown>)?.userContextId || ""),
    "executor-check-user",
  )
  const envelope = (result.data as Record<string, unknown>)?.envelope as Record<string, unknown>
  const telemetry = (envelope?.telemetry || {}) as Record<string, unknown>
  assert.equal(String(telemetry.provider || ""), "gemini")
})

await runCheck("worker execution falls back to worker profile provider when selector is absent", async () => {
  const workerNode: AgentWorkerNode = {
    id: "worker-node-fallback",
    type: "agent-worker",
    label: "Worker Agent",
    position: { x: 0, y: 0 },
    agentId: "coinbase-agent",
    role: "worker-agent",
    domain: "finance",
    goal: "Execute delegated work",
  }
  const ctx = baseContext()
  const result = await executeAgentWorker(workerNode, ctx)
  assert.equal(result.ok, true)
  assert.equal(String((result.data as Record<string, unknown>)?.provider || ""), "openai")
  assert.equal(String((result.data as Record<string, unknown>)?.providerSource || ""), "worker-profile-default")
})

await runCheck("subworkflow rejects missing user context id", async () => {
  const subworkflowNode: AgentSubworkflowNode = {
    id: "sub-1",
    type: "agent-subworkflow",
    label: "Subworkflow",
    position: { x: 0, y: 0 },
    missionId: "target-mission",
    waitForCompletion: true,
  }
  const ctx = baseContext({
    userContextId: "",
    missionId: "parent-mission",
    agentState: {
      stateVersion: "phase0",
      userContextId: "",
      conversationId: "executor-check-conversation",
      sessionKey: "agent:nova:hud:user:executor-check-user:dm:executor-check-conversation",
      missionId: "parent-mission",
      runId: "run-parent",
      keys: {},
      declaredKeys: [],
      writePolicies: {},
      auditTrail: [],
    },
  })
  const result = await executeAgentSubworkflow(subworkflowNode, ctx)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, "AGENT_SUBWORKFLOW_USER_CONTEXT_REQUIRED")
})

await runCheck("subworkflow rejects self-reference mission id", async () => {
  const subworkflowNode: AgentSubworkflowNode = {
    id: "sub-2",
    type: "agent-subworkflow",
    label: "Subworkflow",
    position: { x: 0, y: 0 },
    missionId: "mission-parent",
    waitForCompletion: true,
  }
  const ctx = baseContext({ missionId: "mission-parent", userContextId: "executor-check-user" })
  const result = await executeAgentSubworkflow(subworkflowNode, ctx)
  assert.equal(result.ok, false)
  assert.equal(result.errorCode, "AGENT_SUBWORKFLOW_SELF_REFERENCE")
})
