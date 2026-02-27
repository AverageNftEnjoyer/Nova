import test from "node:test"
import assert from "node:assert/strict"

import { defaultMissionSettings, type Mission } from "../../../types.ts"
import { applyMissionDiff } from "../engine.ts"
import { deriveDiffOperationsFromMissionSnapshot } from "../migration.ts"

function baseMission(): Mission {
  const now = new Date().toISOString()
  return {
    id: "mission-1",
    userId: "tenant-alpha",
    label: "Mission One",
    description: "Base mission",
    category: "research",
    tags: ["phase2"],
    status: "active",
    version: 2,
    nodes: [
      {
        id: "node-1",
        type: "manual-trigger",
        label: "Start",
        position: { x: 100, y: 120 },
      },
      {
        id: "node-2",
        type: "telegram-output",
        label: "Send",
        position: { x: 340, y: 120 },
      },
    ],
    connections: [
      {
        id: "conn-1",
        sourceNodeId: "node-1",
        sourcePort: "main",
        targetNodeId: "node-2",
        targetPort: "main",
      },
    ],
    variables: [],
    settings: {
      ...defaultMissionSettings(),
      timezone: "America/New_York",
      retryOnFail: true,
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

test("unit: applies addNode/addConnection/updateMetadata transaction and increments version", () => {
  const mission = baseMission()
  const result = applyMissionDiff({
    mission,
    expectedVersion: 2,
    operations: [
      {
        type: "addNode",
        node: {
          id: "node-3",
          type: "ai-summarize",
          label: "Summarize",
          position: { x: 220, y: 260 },
          prompt: "Summarize key points",
          integration: "claude",
        },
      },
      {
        type: "addConnection",
        connection: {
          id: "conn-2",
          sourceNodeId: "node-2",
          sourcePort: "main",
          targetNodeId: "node-3",
          targetPort: "main",
        },
      },
      {
        type: "updateMissionMetadata",
        patch: {
          label: "Mission One v2",
        },
      },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.mission?.version, 3)
  assert.equal(result.mission?.label, "Mission One v2")
  assert.equal(result.mission?.nodes.some((node) => node.id === "node-3"), true)
  assert.equal(result.mission?.connections.some((connection) => connection.id === "conn-2"), true)
})

test("unit: version mismatch blocks apply", () => {
  const result = applyMissionDiff({
    mission: baseMission(),
    expectedVersion: 999,
    operations: [],
  })
  assert.equal(result.ok, false)
  assert.equal(result.issues[0]?.code, "diff.version_conflict")
})

test("unit: invalid operation blocks apply", () => {
  const result = applyMissionDiff({
    mission: baseMission(),
    operations: [
      {
        type: "addConnection",
        connection: {
          id: "conn-invalid",
          sourceNodeId: "node-404",
          sourcePort: "main",
          targetNodeId: "node-2",
          targetPort: "main",
        },
      },
    ],
  })
  assert.equal(result.ok, false)
  assert.equal(result.issues.some((row) => row.code === "diff.connection_source_invalid"), true)
})

test("integration: snapshot migration derives deterministic operations", () => {
  const current = baseMission()
  const original = baseMission()
  const next: Mission = {
    ...original,
    label: "Updated label",
    nodes: original.nodes.map((node) => {
      if (node.id === "node-1") return { ...node, position: { x: 100, y: 140 } }
      if (node.id === "node-2") return { ...node, label: "Send now", position: { x: 360, y: 120 } }
      return node
    }),
  }
  const operations = deriveDiffOperationsFromMissionSnapshot(current, next)
  assert.equal(operations.some((row) => row.type === "moveNode"), true)
  assert.equal(operations.some((row) => row.type === "updateNode"), true)
  assert.equal(operations.some((row) => row.type === "updateMissionMetadata"), true)
})
