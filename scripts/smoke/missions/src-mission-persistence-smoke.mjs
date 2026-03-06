import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const persistenceModule = await import(
  pathToFileURL(path.join(process.cwd(), "src", "runtime", "modules", "services", "missions", "persistence", "index.js")).href,
);

const { loadMissions, upsertMission, deleteMission } = persistenceModule;

const userContextId = `smoke-user-${randomUUID().slice(0, 8)}`;
const missionId = `mission-${randomUUID().slice(0, 8)}`;
const now = new Date().toISOString();

const mission = {
  id: missionId,
  userId: userContextId,
  label: "Persistence Smoke",
  description: "Validate src mission persistence service.",
  category: "research",
  tags: [],
  status: "draft",
  version: 1,
  nodes: [{ id: "n1", type: "manual-trigger", label: "Trigger" }],
  connections: [],
  variables: [],
  settings: {},
  createdAt: now,
  updatedAt: now,
  runCount: 0,
  successCount: 0,
  failureCount: 0,
  integration: "telegram",
  chatIds: [],
};

await upsertMission(mission, userContextId);
const loaded = await loadMissions({ userId: userContextId });
assert.equal(Array.isArray(loaded), true);
assert.equal(loaded.some((entry) => entry.id === missionId), true);

await upsertMission({ ...mission, label: "Persistence Smoke Updated" }, userContextId);
const updated = await loadMissions({ userId: userContextId });
const loadedMission = updated.find((entry) => entry.id === missionId);
assert.equal(loadedMission?.label, "Persistence Smoke Updated");

const deleteResult = await deleteMission(missionId, userContextId);
assert.equal(deleteResult?.ok, true);
assert.equal(deleteResult?.deleted, true);
const afterDelete = await loadMissions({ userId: userContextId });
assert.equal(afterDelete.some((entry) => entry.id === missionId), false);

console.log("[mission-persistence:smoke] shared mission persistence service is stable.");
