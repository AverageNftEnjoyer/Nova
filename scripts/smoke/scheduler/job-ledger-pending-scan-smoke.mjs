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

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.equal(start >= 0, true, `Missing start marker: ${startMarker}`);
  assert.equal(end > start, true, `Missing end marker after ${startMarker}`);
  return source.slice(start, end);
}

const typesSource = read("hud/lib/missions/job-ledger/types.ts");
const storeSource = read("hud/lib/missions/job-ledger/store.ts");
const tickSource = read("hud/lib/missions/workflow/execution-tick.ts");

const getPendingRunsBody = sliceBetween(
  storeSource,
  "async getPendingRuns(input: GetPendingRunsInput): Promise<PendingJobRun[]> {",
  "},\n}",
);

await run("P5-JL-1 pending scan uses a narrow PendingJobRun type", async () => {
  assert.equal(typesSource.includes("export type PendingJobRun = Pick<"), true);
  assert.equal(typesSource.includes('"id" | "user_id" | "mission_id" | "priority" | "scheduled_for" | "attempt" | "source" | "input_snapshot"'), true);
  assert.equal(typesSource.includes("getPendingRuns(input: GetPendingRunsInput): Promise<PendingJobRun[]>"), true);
  assert.equal(tickSource.includes("import type { PendingJobRun }"), true);
  assert.equal(tickSource.includes("run: PendingJobRun"), true);
});

await run("P5-JL-2 getPendingRuns no longer fetches full job_runs rows for tick scans", async () => {
  assert.equal(getPendingRunsBody.includes('.select("id, user_id, mission_id, priority, scheduled_for, attempt, source, input_snapshot")'), true);
  assert.equal(getPendingRunsBody.includes('.select("*")'), false);
  assert.equal(getPendingRunsBody.includes(".order(\"priority\", { ascending: false })"), true);
  assert.equal(getPendingRunsBody.includes(".order(\"scheduled_for\", { ascending: true })"), true);
  assert.equal(getPendingRunsBody.includes("return data as PendingJobRun[]"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
