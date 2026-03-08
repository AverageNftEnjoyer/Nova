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
const migrationSource = read("hud/supabase/migrations/20260307_heartbeat_job_run_lease.sql");

const heartbeatBody = sliceBetween(
  storeSource,
  "async heartbeat(input: { jobRunId: string; leaseToken: string; leaseDurationMs: number }) {",
  "async startRun(input: { jobRunId: string; leaseToken: string }) {",
);

await run("P8-JL-1 heartbeat delegates lease renewal to a server-side RPC", async () => {
  assert.equal(heartbeatBody.includes('db.rpc("heartbeat_job_run_lease"'), true);
  assert.equal(heartbeatBody.includes("p_job_run_id"), true);
  assert.equal(heartbeatBody.includes("p_lease_token"), true);
  assert.equal(heartbeatBody.includes("p_lease_duration_ms"), true);
  assert.equal(heartbeatBody.includes(".from(\"job_runs\")"), false);
  assert.equal(heartbeatBody.includes("Date()"), false);
});

await run("P8-JL-2 heartbeat RPC renews lease and heartbeat timestamp with database time", async () => {
  assert.equal(migrationSource.includes("CREATE OR REPLACE FUNCTION heartbeat_job_run_lease("), true);
  assert.equal(migrationSource.includes("heartbeat_at = now()"), true);
  assert.equal(migrationSource.includes("lease_expires_at = now() + (p_lease_duration_ms || ' milliseconds')::interval"), true);
  assert.equal(migrationSource.includes("status IN ('claimed', 'running')"), true);
  assert.equal(migrationSource.includes("RETURN v_updated > 0;"), true);
  assert.equal(migrationSource.includes("GRANT EXECUTE ON FUNCTION heartbeat_job_run_lease"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
