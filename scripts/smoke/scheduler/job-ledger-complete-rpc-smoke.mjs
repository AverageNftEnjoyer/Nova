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
const guardSource = read("hud/lib/missions/workflow/execution-guard.ts");
const migrationSource = read("hud/supabase/migrations/20260307_complete_job_run.sql");

const completeRunBody = sliceBetween(
  storeSource,
  "async completeRun(input: CompleteJobInput) {",
  "async failRun(input: FailJobInput) {",
);

await run("P9-JL-1 completeRun delegates completion to a single RPC with no JS-side timestamp math", async () => {
  assert.equal(typesSource.includes("export type CompleteJobInput = {"), true);
  assert.equal(typesSource.includes("completeRun(input: CompleteJobInput): Promise<{ ok: boolean }>"), true);
  assert.equal(completeRunBody.includes('db.rpc("complete_job_run"'), true);
  assert.equal(completeRunBody.includes("p_job_run_id"), true);
  assert.equal(completeRunBody.includes("p_lease_token"), true);
  assert.equal(completeRunBody.includes("p_output_summary"), true);
  assert.equal(completeRunBody.includes(".from(\"job_runs\")"), false);
  assert.equal(completeRunBody.includes("Date()"), false);
  assert.equal(storeSource.includes("loadStartedAtForFinish"), false);
  assert.equal(storeSource.includes("computeFinishedDurationMs"), false);
});

await run("P9-JL-2 complete RPC uses database time and running-state lease guards", async () => {
  assert.equal(migrationSource.includes("CREATE OR REPLACE FUNCTION complete_job_run("), true);
  assert.equal(migrationSource.includes("status = 'running'"), true);
  assert.equal(migrationSource.includes("FOR UPDATE"), true);
  assert.equal(migrationSource.includes("v_finished_at := now();"), true);
  assert.equal(migrationSource.includes("duration_ms = GREATEST("), true);
  assert.equal(migrationSource.includes("lease_token = NULL"), true);
  assert.equal(migrationSource.includes("lease_expires_at = NULL"), true);
  assert.equal(migrationSource.includes("GRANT EXECUTE ON FUNCTION complete_job_run"), true);
});

await run("P9-JL-3 all completion callers use the singular RPC-backed contract with no startedAt completion override", async () => {
  assert.equal(guardSource.includes("jobLedger.completeRun({\n            jobRunId: missionRunId,\n            leaseToken: claimResult.leaseToken,\n          })"), true);
  assert.equal(guardSource.includes("jobLedger.completeRun({ jobRunId, leaseToken }).catch(() => {})"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
