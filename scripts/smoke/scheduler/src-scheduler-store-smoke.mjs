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

await run("P18-C1 mission store uses schema versioned payloads", async () => {
  assert.equal(storeSource.includes("MISSIONS_SCHEMA_VERSION"), true);
  assert.equal(storeSource.includes("interface MissionsStoreFile"), true);
  assert.equal(storeSource.includes("normalizeMission"), true);
  assert.equal(storeSource.includes("defaultStorePayload"), true);
});

await run("P18-C2 mission store writes atomically with backup fallback", async () => {
  assert.equal(storeSource.includes("atomicWriteJson"), true);
  assert.equal(storeSource.includes("randomBytes"), true);
  assert.equal(storeSource.includes("rename(tmpPath, resolved)"), true);
  assert.equal(storeSource.includes('`${resolved}.bak`'), true);
  assert.equal(storeSource.includes("writesByPath"), true);
});

await run("P18-C3 mission store recovers from primary-file corruption", async () => {
  assert.equal(storeSource.includes("readFile(`${file}.bak`, \"utf8\")"), true);
  assert.equal(storeSource.includes("defaultStorePayload()"), true);
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
