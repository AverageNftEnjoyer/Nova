import assert from "node:assert/strict"

import { buildMission } from "../../../store"
import { appendMissionVersionEntry, listMissionVersions, restoreMissionVersion, validateMissionGraphForVersioning } from "../index"

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
