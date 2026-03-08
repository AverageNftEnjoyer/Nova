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
const migrationSource = read("hud/supabase/migrations/20260307_fail_job_run_with_retry.sql");

const failRunBody = sliceBetween(
  storeSource,
  "async failRun(input: FailJobInput) {",
  "async cancelRun(input: { jobRunId: string; userId: string }) {",
);

await run("P4-JL-1 failRun delegates terminal failure + retry scheduling to a single RPC", async () => {
  assert.equal(failRunBody.includes('db.rpc("fail_job_run_with_retry"'), true);
  assert.equal(failRunBody.includes("p_job_run_id"), true);
  assert.equal(failRunBody.includes("p_lease_token"), true);
  assert.equal(failRunBody.includes("p_started_at"), true);
  assert.equal(failRunBody.includes("p_retry_id"), true);
  assert.equal(failRunBody.includes("p_backoff_base_ms"), true);
  assert.equal(failRunBody.includes("p_backoff_max_ms"), true);
  assert.equal(failRunBody.includes('.from("job_runs").select('), false, "failRun should not re-read job_runs client-side");
  assert.equal(failRunBody.includes('.from("job_runs").update('), false, "failRun should not update job_runs client-side");
  assert.equal(failRunBody.includes('.from("job_runs").insert('), false, "failRun should not insert retry rows client-side");
});

await run("P4-JL-2 fail RPC locks the live row, computes retry backoff, and inserts retry rows server-side", async () => {
  assert.equal(migrationSource.includes("CREATE OR REPLACE FUNCTION fail_job_run_with_retry("), true);
  assert.equal(migrationSource.includes("FOR UPDATE"), true);
  assert.equal(migrationSource.includes("status IN ('claimed', 'running')"), true);
  assert.equal(migrationSource.includes("v_next_attempt"), true);
  assert.equal(migrationSource.includes("POWER(2::NUMERIC"), true);
  assert.equal(migrationSource.includes("random() * 0.2"), true);
  assert.equal(migrationSource.includes("INSERT INTO job_runs"), true);
  assert.equal(migrationSource.includes("'retry'"), true);
  assert.equal(migrationSource.includes("v_finished_at + (v_retry_backoff_ms || ' milliseconds')::interval"), true);
});

await run("P4-JL-3 fail RPC marks retry enqueue failures dead inside the same procedure and returns dead-letter metadata", async () => {
  assert.equal(migrationSource.includes("EXCEPTION WHEN OTHERS THEN"), true);
  assert.equal(migrationSource.includes("RETRY_ENQUEUE_FAILED"), true);
  assert.equal(migrationSource.includes("'retry_enqueue_failed'::TEXT"), true);
  assert.equal(migrationSource.includes("error_detail"), true);
  assert.equal(migrationSource.includes("retry_backoff_ms"), true);
  assert.equal(migrationSource.includes("GRANT EXECUTE ON FUNCTION fail_job_run_with_retry"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
