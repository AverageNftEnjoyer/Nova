import assert from "node:assert/strict"

import { buildMission } from "../../../store/index.ts"
import { appendMissionVersionEntry, listMissionVersions, restoreMissionVersion, validateMissionGraphForVersioning } from "../server.ts"

function runCheck(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    console.log(`PASS ${name}`)
  })
}

const userContextId = `phase4-versioning-${Date.now()}`

await runCheck("versioning stores immutable snapshots", async () => {
  const mission = buildMission({
    userId: userContextId,
    label: "Versioning Test",
    nodes: [],
    connections: [],
  })
  const snapshot = await appendMissionVersionEntry({
    userContextId,
    mission,
    actorId: userContextId,
    eventType: "snapshot",
    reason: "initial snapshot",
  })
  assert.equal(Boolean(snapshot?.versionId), true)
  const versions = await listMissionVersions({ userContextId, missionId: mission.id })
  assert.equal(versions.length > 0, true)
})

await runCheck("restore creates mandatory pre-restore backup and validates graph", async () => {
  const baseMission = buildMission({
    userId: userContextId,
    label: "Restore Test",
    nodes: [],
    connections: [],
  })
  const snapshot = await appendMissionVersionEntry({
    userContextId,
    mission: baseMission,
    actorId: userContextId,
    eventType: "snapshot",
    reason: "seed",
  })
  assert.equal(Boolean(snapshot?.versionId), true)

  const currentMission = {
    ...baseMission,
    version: baseMission.version + 1,
    updatedAt: new Date().toISOString(),
  }
  const restored = await restoreMissionVersion({
    userContextId,
    actorId: userContextId,
    missionId: baseMission.id,
    versionId: snapshot!.versionId,
    currentMission,
    reason: "rollback test",
    validateMission: (mission) => {
      const issues = validateMissionGraphForVersioning(mission)
      return { ok: issues.length === 0, issues }
    },
  })
  assert.equal(restored.ok, true)
  assert.equal(Boolean(restored.backupVersionId), true)
  assert.equal(Boolean(restored.restoredVersionId), true)
})

await runCheck("graph validation blocks self loops and directed cycles", async () => {
  const cyclicMission = buildMission({
    userId: userContextId,
    label: "Cycle Test",
    nodes: [
      { id: "node-a", type: "manual-trigger", label: "Start", position: { x: 0, y: 0 } },
      { id: "node-b", type: "telegram-output", label: "Output", position: { x: 220, y: 0 } },
    ],
    connections: [
      { id: "conn-1", sourceNodeId: "node-a", sourcePort: "main", targetNodeId: "node-b", targetPort: "main" },
      { id: "conn-2", sourceNodeId: "node-b", sourcePort: "main", targetNodeId: "node-a", targetPort: "main" },
      { id: "conn-3", sourceNodeId: "node-a", sourcePort: "main", targetNodeId: "node-a", targetPort: "main" },
    ],
  })
  const issues = validateMissionGraphForVersioning(cyclicMission)
  assert.equal(issues.some((issue) => issue.code === "mission.graph_cycle_detected"), true)
  assert.equal(issues.some((issue) => issue.code === "mission.connection_self_loop"), true)
})

await runCheck("graph validation blocks legacy sub-workflow node type", async () => {
  const mission = buildMission({
    userId: userContextId,
    label: "Legacy Node Block Test",
    nodes: [],
    connections: [],
  })
  const legacyMission = mission as unknown as {
    nodes: Array<Record<string, unknown>>
    connections: Array<Record<string, unknown>>
  }
  legacyMission.nodes = [
      { id: "n1", type: "manual-trigger", label: "Start", position: { x: 0, y: 0 } },
      { id: "n2", type: "sub-workflow", label: "Legacy Sub-Workflow", position: { x: 220, y: 0 }, missionId: "child", waitForCompletion: true },
    ]
  legacyMission.connections = [
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
    ]
  const issues = validateMissionGraphForVersioning(mission)
  assert.equal(issues.some((issue) => issue.code === "mission.node_type_legacy_blocked"), true)
})

await runCheck("agent org-chart validation enforces audit and declared state writes", async () => {
  const agentMission = buildMission({
    userId: userContextId,
    label: "Agent Contract Test",
    nodes: [
      { id: "n1", type: "manual-trigger", label: "Start", position: { x: 0, y: 0 } },
      { id: "n2", type: "agent-supervisor", label: "Operator", position: { x: 220, y: 0 }, agentId: "operator", role: "operator", goal: "Command", writes: [] },
      { id: "n3", type: "agent-worker", label: "Routing Council", position: { x: 440, y: 0 }, agentId: "routing", role: "routing-council", goal: "Route", writes: ["task.plan"] },
      { id: "n4", type: "agent-worker", label: "System Manager", position: { x: 660, y: 0 }, agentId: "sysmgr", role: "system-manager", goal: "Assign", reads: ["task.plan"], writes: ["task.result"] },
      { id: "n5", type: "agent-worker", label: "Worker", position: { x: 880, y: 0 }, agentId: "worker", role: "worker-agent", goal: "Execute", reads: ["task.plan"] },
      { id: "n6", type: "provider-selector", label: "Provider", position: { x: 1100, y: 0 }, allowedProviders: ["claude", "openai"], defaultProvider: "claude", strategy: "policy" },
      { id: "n7", type: "agent-state-write", label: "Write", position: { x: 1320, y: 0 }, key: "unknown.key", valueExpression: "done", writeMode: "replace" },
      { id: "n8", type: "agent-handoff", label: "Bad Handoff", position: { x: 1540, y: 0 }, fromAgentId: "worker", toAgentId: "operator", reason: "invalid path" },
    ],
    connections: [
      { id: "c1", sourceNodeId: "n1", sourcePort: "main", targetNodeId: "n2", targetPort: "main" },
      { id: "c2", sourceNodeId: "n2", sourcePort: "main", targetNodeId: "n3", targetPort: "main" },
      { id: "c3", sourceNodeId: "n3", sourcePort: "main", targetNodeId: "n4", targetPort: "main" },
      { id: "c4", sourceNodeId: "n4", sourcePort: "main", targetNodeId: "n5", targetPort: "main" },
      { id: "c5", sourceNodeId: "n5", sourcePort: "main", targetNodeId: "n6", targetPort: "main" },
      { id: "c6", sourceNodeId: "n6", sourcePort: "main", targetNodeId: "n7", targetPort: "main" },
      { id: "c7", sourceNodeId: "n7", sourcePort: "main", targetNodeId: "n8", targetPort: "main" },
    ],
  })

  const issues = validateMissionGraphForVersioning(agentMission)
  assert.equal(issues.some((issue) => issue.code === "mission.agent.audit_required"), true)
  assert.equal(issues.some((issue) => issue.code === "mission.agent.state_write_undeclared"), true)
  assert.equal(issues.some((issue) => issue.code === "mission.agent.handoff_stage_violation"), true)
  assert.equal(issues.some((issue) => issue.code === "mission.agent.handoff_operator_to_council_required"), true)
})

await runCheck("agent validation blocks direct worker output routing", async () => {
  const mission = buildMission({
    userId: userContextId,
    label: "Agent Output Contract Test",
    nodes: [
      { id: "n1", type: "manual-trigger", label: "Start", position: { x: 0, y: 0 } },
      { id: "n2", type: "agent-supervisor", label: "Operator", position: { x: 220, y: 0 }, agentId: "operator", role: "operator", goal: "Command" },
      { id: "n3", type: "agent-worker", label: "Routing Council", position: { x: 440, y: 0 }, agentId: "routing-council", role: "routing-council", goal: "Route" },
      { id: "n4", type: "agent-worker", label: "System Manager", position: { x: 660, y: 0 }, agentId: "system-manager", role: "system-manager", goal: "Assign" },
      { id: "n5", type: "agent-worker", label: "Worker", position: { x: 880, y: 0 }, agentId: "worker-1", role: "worker-agent", goal: "Execute" },
      { id: "n6", type: "provider-selector", label: "Provider", position: { x: 1100, y: 0 }, allowedProviders: ["claude", "openai"], defaultProvider: "claude", strategy: "policy" },
      { id: "n7", type: "agent-audit", label: "Audit", position: { x: 1320, y: 0 }, agentId: "audit-council", role: "audit-council", goal: "Audit", requiredChecks: ["user-context-isolation", "policy-guardrails"] },
      { id: "n8", type: "agent-handoff", label: "Operator->Council", position: { x: 1540, y: 0 }, fromAgentId: "operator", toAgentId: "routing-council", reason: "route intent" },
      { id: "n9", type: "agent-handoff", label: "Council->Manager", position: { x: 1760, y: 0 }, fromAgentId: "routing-council", toAgentId: "system-manager", reason: "pick manager" },
      { id: "n10", type: "agent-handoff", label: "Manager->Worker", position: { x: 1980, y: 0 }, fromAgentId: "system-manager", toAgentId: "worker-1", reason: "delegate" },
      { id: "n11", type: "agent-handoff", label: "Worker->Audit", position: { x: 2200, y: 0 }, fromAgentId: "worker-1", toAgentId: "audit-council", reason: "review" },
      { id: "n12", type: "agent-handoff", label: "Audit->Operator", position: { x: 2420, y: 0 }, fromAgentId: "audit-council", toAgentId: "operator", reason: "finalize" },
      { id: "n13", type: "email-output", label: "Send", position: { x: 2640, y: 0 }, recipients: ["ops@example.com"], subject: "Result", messageTemplate: "ok", format: "text" },
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
      { id: "c12", sourceNodeId: "n5", sourcePort: "main", targetNodeId: "n13", targetPort: "main" },
    ],
  })

  const issues = validateMissionGraphForVersioning(mission)
  assert.equal(issues.some((issue) => issue.code === "mission.agent.output_source_invalid"), true)
})
