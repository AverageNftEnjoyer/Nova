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

const storeSource = read("hud/lib/missions/job-ledger/store.ts");
const typesSource = read("hud/lib/missions/job-ledger/types.ts");
const guardSource = read("hud/lib/missions/workflow/execution-guard.ts");
const tickSource = read("hud/lib/missions/workflow/execution-tick.ts");

const startRunBody = sliceBetween(
  storeSource,
  "async startRun(input: { jobRunId: string; leaseToken: string }) {",
  "async completeRun(input: CompleteJobInput) {",
);

const completeRunBody = sliceBetween(
  storeSource,
  "async completeRun(input: CompleteJobInput) {",
  "async failRun(input: FailJobInput) {",
);

const failRunBody = sliceBetween(
  storeSource,
  "async failRun(input: FailJobInput) {",
  "async cancelRun(input: { jobRunId: string; userId: string }) {",
);

await run("P3-JL-1 finish input and startRun contract carry startedAt through the hot path", async () => {
  assert.equal(typesSource.includes("startedAt?: string | null"), true);
  assert.equal(typesSource.includes("Promise<{ ok: boolean; startedAt: string | null }>"), true);
  assert.equal(startRunBody.includes("const startedAt = new Date().toISOString()"), true);
  assert.equal(startRunBody.includes('.update({ status: "running", started_at: startedAt })'), true);
  assert.equal(startRunBody.includes("return { ok: !error, startedAt: error ? null : startedAt }"), true);
});

await run("P3-JL-2 completeRun now uses the singular completion RPC path", async () => {
  assert.equal(typesSource.includes("export type CompleteJobInput = {"), true);
  assert.equal(completeRunBody.includes('db.rpc("complete_job_run"'), true);
  assert.equal(completeRunBody.includes("p_output_summary: input.outputSummary ?? null"), true);
  assert.equal(completeRunBody.includes(".from(\"job_runs\")"), false);
  assert.equal(storeSource.includes("loadStartedAtForFinish"), false);
  assert.equal(storeSource.includes("computeFinishedDurationMs"), false);
});

await run("P3-JL-3 failRun still threads startedAt into the terminal DB path", async () => {
  assert.equal(failRunBody.includes("p_started_at: input.startedAt ?? null"), true);
  assert.equal(failRunBody.includes('db.rpc("fail_job_run_with_retry"'), true);
  assert.equal(failRunBody.includes("result.final_status === \"dead\""), true);
  assert.equal(failRunBody.includes("result.final_status === \"retry_enqueue_failed\""), true);
});

await run("P3-JL-4 execution paths thread startedAt into release and direct failure calls", async () => {
  assert.equal(guardSource.includes("startedAt: startResult.startedAt"), true);
  assert.equal(guardSource.includes("startedAt?: string | null"), true);
  assert.equal(guardSource.includes("startedAt: options?.startedAt"), true);
  assert.equal(guardSource.includes("jobLedger.completeRun({\n            jobRunId: missionRunId,\n            leaseToken: claimResult.leaseToken,\n          })"), true);
  assert.equal(guardSource.includes("jobLedger.completeRun({ jobRunId, leaseToken }).catch(() => {})"), true);
  assert.equal(tickSource.includes("startedAt: startResult.startedAt"), true);
  assert.equal(tickSource.includes("heartbeatConfig:"), true);
  assert.equal(tickSource.includes("startedAt: startResult.startedAt,\n        heartbeatConfig:"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
