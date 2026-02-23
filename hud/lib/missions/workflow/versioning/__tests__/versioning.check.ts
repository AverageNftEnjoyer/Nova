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
