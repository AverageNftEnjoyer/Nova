import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function summarize(result) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const storeSource = read("hud/lib/missions/store/index.ts");
const schedulerSource = read("hud/lib/notifications/scheduler/index.ts");

// The mission store moved from a schema-versioned missions.json (atomic tmp+rename, .bak fallback) to the
// SQLite-backed store in src/runtime/modules/services/missions/persistence/sqlite-store.js (table `missions` in
// nova.db). C1-C3 keep the original intents (versioned schema, atomic writes, corruption recovery) but assert
// them against the real store on the isolated temp DB instead of grepping for file-format tokens.
const missionsStore = await import("../../../src/runtime/modules/services/missions/persistence/sqlite-store.js");
const { getDb, LATEST_VERSION } = await import("../../../src/db/index.js");

function mission(id, label, extra = {}) {
  const now = new Date().toISOString();
  return { id, label, status: "active", createdAt: now, updatedAt: now, ...extra };
}

await run("P18-C1 mission store uses schema versioned payloads", async () => {
  // HUD store still normalizes every record it reads and delegates persistence to the SQLite store.
  assert.equal(storeSource.includes("normalizeMission"), true);
  assert.equal(storeSource.includes("readMissionRecords"), true);
  assert.equal(storeSource.includes("replaceMissionRecords"), true);
  // Schema versioning is the DB migration ledger: the missions table exists at the latest applied version.
  const db = getDb();
  assert.equal(db.pragma("user_version", { simple: true }), LATEST_VERSION);
  const columns = db.prepare("PRAGMA table_info(missions)").all().map((c) => c.name);
  for (const column of ["user_id", "id", "data_json", "label", "enabled", "created_at", "updated_at"]) {
    assert.equal(columns.includes(column), true, `missions.${column} column`);
  }
  // Payloads round-trip through data_json, and rows are scoped by user.
  missionsStore.replaceMissionRecords("p18-user-a", [mission("m-1", "One", { nodes: [{ id: "n1" }] })]);
  const [read] = missionsStore.readMissionRecords("p18-user-a");
  assert.equal(read.id, "m-1");
  assert.deepEqual(read.nodes, [{ id: "n1" }]);
  assert.deepEqual(missionsStore.readMissionRecords("p18-user-b"), []);
});

await run("P18-C2 mission store writes atomically with backup fallback", async () => {
  // Atomicity is transactional now: a failing replace must roll back completely (no partial set, no lost rows).
  missionsStore.replaceMissionRecords("p18-atomic", [mission("keep-1", "Keep 1"), mission("keep-2", "Keep 2")]);
  const circular = mission("bad", "Bad");
  circular.self = circular; // JSON.stringify throws after "keep-*" rows were already deleted/rewritten in the tx
  assert.throws(() => missionsStore.replaceMissionRecords("p18-atomic", [mission("new-1", "New 1"), circular]));
  const ids = missionsStore.readMissionRecords("p18-atomic").map((m) => m.id).sort();
  assert.deepEqual(ids, ["keep-1", "keep-2"]);
  // Read-modify-write of one mission is atomic too: a mutate() that throws leaves the row untouched.
  assert.throws(() =>
    missionsStore.upsertMissionRecord("p18-atomic", "keep-1", () => {
      throw new Error("boom");
    }),
  );
  assert.equal(missionsStore.readMissionRecords("p18-atomic").find((m) => m.id === "keep-1").label, "Keep 1");
  // No file-based primary/backup artifacts exist any more: the HUD store must not reintroduce them.
  assert.equal(storeSource.includes("atomicWriteJson"), false);
  assert.equal(storeSource.includes(".bak"), false);
});

await run("P18-C3 mission store recovers from primary-file corruption", async () => {
  // A corrupt row must not take down the healthy rows of that user.
  missionsStore.replaceMissionRecords("p18-corrupt", [mission("good-1", "Good 1"), mission("good-2", "Good 2")]);
  getDb()
    .prepare(
      "INSERT INTO missions (user_id, id, data_json, label, enabled, created_at, updated_at) VALUES (?, ?, ?, NULL, 0, NULL, ?)",
    )
    .run("p18-corrupt", "corrupt-1", "{not json", new Date().toISOString());
  const ids = missionsStore.readMissionRecords("p18-corrupt").map((m) => m.id).sort();
  assert.deepEqual(ids, ["good-1", "good-2"]);
  // A user with no rows (or an invalid id) yields an empty, well-formed list instead of throwing.
  assert.deepEqual(missionsStore.readMissionRecords("p18-nobody"), []);
  assert.deepEqual(missionsStore.readMissionRecords(""), []);
});

await run("P18-C4 scheduler uses enqueue-only mode (Phase 3)", async () => {
  // Scheduler now enqueues job_runs; execution-tick handles actual execution.
  assert.equal(schedulerSource.includes("jobLedger.enqueue"), true);
  assert.equal(schedulerSource.includes("idempotency_key"), true);
  assert.equal(schedulerSource.includes("runScheduleTickInternal"), true);
  // executeMission no longer called directly in the scheduler
  assert.equal(schedulerSource.includes("executeMission("), false);
  // upsertMission no longer called in the scheduler (execution-tick does it)
  assert.equal(schedulerSource.includes("upsertMission"), false);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
