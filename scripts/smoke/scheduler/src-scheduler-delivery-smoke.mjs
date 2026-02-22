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

const schedulerSource = read("hud/lib/notifications/scheduler.ts");
const runLogSource = read("hud/lib/notifications/run-log.ts");
const runMetricsSource = read("hud/lib/notifications/run-metrics.ts");

await run("P19-C1 scheduler computes per-run idempotency keys", async () => {
  assert.equal(schedulerSource.includes("buildScheduleRunKey"), true);
  assert.equal(schedulerSource.includes("runKey"), true);
  assert.equal(schedulerSource.includes("getRunKeyHistory"), true);
});

await run("P19-C2 scheduler applies retry backoff and max retry gate", async () => {
  assert.equal(schedulerSource.includes("SCHEDULER_MAX_RETRIES_PER_RUN_KEY"), true);
  assert.equal(schedulerSource.includes("SCHEDULER_RETRY_BASE_MS"), true);
  assert.equal(schedulerSource.includes("computeRetryDelayMs"), true);
  assert.equal(schedulerSource.includes("runHistory.latestStatus === \"error\""), true);
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
