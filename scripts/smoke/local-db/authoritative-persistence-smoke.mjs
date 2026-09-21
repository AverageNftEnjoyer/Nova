import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-authoritative-persistence-"));
const previousDataDir = process.env.NOVA_DATA_DIR;
process.env.NOVA_DATA_DIR = tempRoot;

const db = await import("../../../src/db/index.js");
const missions = await import("../../../src/runtime/modules/services/missions/persistence/index.js");
const missionSql = await import("../../../src/runtime/modules/services/missions/persistence/sqlite-store.js");
const { jobLedger, readJobRun } = await import("../../../src/runtime/modules/services/missions/job-ledger/index.js");
const sessions = await import("../../../src/session/sqlite-store/index.js");

const uid = "phase2-smoke";
const now = new Date().toISOString();
const mission = {
  id: "mission-1",
  userId: uid,
  label: "SQLite mission",
  description: "",
  status: "active",
  nodes: [],
  connections: [],
  variables: [],
  createdAt: now,
  updatedAt: now,
};

await missions.upsertMission(mission, uid);
assert.equal((await missions.loadMissions({ userId: uid })).length, 1);
assert.equal(db.getDb().prepare("SELECT count(*) AS n FROM missions WHERE user_id = ?").get(uid).n, 1);

missionSql.insertTelemetryEvent({
  eventId: "event-1",
  eventType: "mission.started",
  userContextId: uid,
  missionId: mission.id,
  ts: now,
}, { retentionDays: 30, maxEventsPerUser: 100 });
missionSql.insertVersionRecord({
  versionId: "version-1",
  missionId: mission.id,
  userContextId: uid,
  ts: now,
  mission,
}, { maxAgeDays: 30, maxVersionsPerMission: 10 });
missionSql.appendRunLogRecord(mission.id, uid, { ts: Date.now(), scheduleId: mission.id, source: "trigger", status: "success" });
missionSql.appendDeadLetterRecord("notification", uid, {
  id: "dead-1",
  ts: Date.now(),
  scheduleId: mission.id,
  reason: "smoke",
});
missionSql.appendJournalRecord({ userContextId: uid, missionId: mission.id, actorId: "smoke", ts: now });
missionSql.insertArtifactRecord({
  userContextId: uid,
  artifactRef: "artifact-1",
  missionId: mission.id,
  createdAtMs: Date.now(),
  ttlMs: 60_000,
  summary: "smoke",
  output: { ok: true },
});
for (const table of [
  "mission_telemetry",
  "mission_versions",
  "mission_run_logs",
  "dead_letters",
  "mission_journal",
  "mission_artifacts",
]) {
  assert.equal(db.getDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(uid).n, 1, table);
}

assert.deepEqual(await jobLedger.enqueue({
  id: "job-1",
  user_id: uid,
  mission_id: mission.id,
  scheduled_for: now,
}), { ok: true });
const claim = await jobLedger.claimRun({ jobRunId: "job-1", leaseDurationMs: 60_000 });
assert.equal(claim.ok, true);
assert.equal((await jobLedger.startRun({ jobRunId: "job-1", leaseToken: claim.leaseToken })).ok, true);
assert.equal((await jobLedger.completeRun({ jobRunId: "job-1", leaseToken: claim.leaseToken })).ok, true);
assert.equal(readJobRun("job-1").status, "succeeded");

const thread = sessions.createThread(uid, "Smoke");
assert.equal(sessions.upsertThreadMessages(uid, thread.id, [{
  id: "message-1",
  role: "user",
  content: "hello",
  createdAt: now,
  metadata: { sessionKey: "smoke-key" },
}]), 1);
sessions.putSessionEntry(uid, "smoke-key", { sessionId: "session-1", createdAt: 1, updatedAt: 1 });
sessions.appendSessionTurn(uid, "session-1", { role: "user", content: "hello", timestamp: 1 });
assert.equal(sessions.listThreadMessages(uid).length, 1);

const deleted = db.purgeLocalUserData(uid);
assert.ok(Object.values(deleted).some((count) => count > 0));
for (const table of ["missions", "job_runs", "threads", "messages", "sessions", "session_turns", "kv_state"]) {
  assert.equal(db.getDb().prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(uid).n, 0, table);
}
const jsonFiles = fs.readdirSync(tempRoot, { recursive: true }).filter((name) => /\.jsonl?$/i.test(String(name)));
assert.deepEqual(jsonFiles, []);

db.closeDb();
if (previousDataDir === undefined) delete process.env.NOVA_DATA_DIR;
else process.env.NOVA_DATA_DIR = previousDataDir;
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("PASS authoritative SQLite persistence");
