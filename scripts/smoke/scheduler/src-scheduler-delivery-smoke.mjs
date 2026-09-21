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

const schedulerSource = read("hud/lib/notifications/scheduler/index.ts");
// The tick gates (day-lock, retry backoff) live in the shared scheduler core; the HUD scheduler delegates to it.
const schedulerCoreSource = read("src/runtime/modules/services/missions/scheduler-core/index.js");
const runLogSource = read("hud/lib/notifications/run-log/index.ts");
const runMetricsSource = read("hud/lib/notifications/run-metrics/index.ts");

await run("P19-C1 scheduler enforces day-lock guard for daily-like triggers", async () => {
  assert.equal(schedulerSource.includes("runMissionScheduleTick"), true);
  assert.equal(schedulerSource.includes("getLocalParts"), true);
  assert.equal(schedulerCoreSource.includes("getLocalParts"), true);
  assert.equal(schedulerCoreSource.includes("nativeDayStamp"), true);
  // Gate checks use missionForGate (reschedule override applied) not raw liveMission
  assert.equal(schedulerCoreSource.includes("missionForGate.lastSentLocalDate === nativeDayStamp"), true);
});

await run("P19-C2 scheduler applies mission-level retry backoff and max retry gate", async () => {
  assert.equal(schedulerCoreSource.includes("SCHEDULER_MAX_RETRIES_PER_RUN_KEY"), true);
  assert.equal(schedulerCoreSource.includes("SCHEDULER_RETRY_BASE_MS"), true);
  assert.equal(schedulerCoreSource.includes("computeRetryDelayMs"), true);
  // Gate checks use missionForGate (reschedule override applied) not raw liveMission
  assert.equal(schedulerCoreSource.includes("missionForGate.lastRunStatus === \"error\""), true);
  assert.equal(schedulerCoreSource.includes("consecutiveFailures >= SCHEDULER_MAX_RETRIES_PER_RUN_KEY"), true);
});

await run("P19-C3 run log stores and summarizes runKey attempts", async () => {
  assert.equal(runLogSource.includes("runKey?: string"), true);
  assert.equal(runLogSource.includes("attempt?: number"), true);
  assert.equal(runLogSource.includes("export async function getRunKeyHistory"), true);
});

await run("P19-C4 metrics include runKey and attempt in persisted entries", async () => {
  assert.equal(runMetricsSource.includes("runKey?: string"), true);
  assert.equal(runMetricsSource.includes("attempt?: number"), true);
  assert.equal(runMetricsSource.includes("runKey: String(params.runKey || \"\").trim() || undefined"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
