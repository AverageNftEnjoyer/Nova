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

const storeSource = read("hud/lib/missions/job-ledger/store.ts");
const guardSource = read("hud/lib/missions/workflow/execution-guard.ts");
const executionTickSource = read("hud/lib/missions/workflow/execution-tick.ts");
const claimMigrationSource = read("hud/supabase/migrations/20260307_claim_job_run_lease_with_limits.sql");

await run("P1-CLAIM-1 store claimRun delegates the hot path to a single lean RPC", async () => {
  const claimRunStart = storeSource.indexOf("async claimRun(input: { jobRunId: string; leaseDurationMs: number })");
  const claimRunEnd = storeSource.indexOf("async heartbeat(input: { jobRunId: string; leaseToken: string; leaseDurationMs: number })");
  assert.equal(claimRunStart >= 0, true, "claimRun implementation not found");
  assert.equal(claimRunEnd > claimRunStart, true, "claimRun end boundary not found");
  const claimRunBody = storeSource.slice(claimRunStart, claimRunEnd);

  assert.equal(claimRunBody.includes('db.rpc("claim_job_run_lease_with_limits"'), true);
  assert.equal(claimRunBody.includes("p_job_run_id"), true);
  assert.equal(claimRunBody.includes("p_global_inflight_limit"), true);
  assert.equal(claimRunBody.includes("p_per_user_inflight_limit"), true);
  assert.equal(claimRunBody.includes(".from(\"job_runs\")"), false, "claimRun should not issue extra client-side row queries");
  assert.equal(claimRunBody.includes("rpcResult.job_run"), false, "claimRun should not depend on a full claimed row payload");
});

await run("P1-CLAIM-2 claim RPC enforces lock, global cap, per-user cap, and single-row transition", async () => {
  assert.equal(claimMigrationSource.includes("FOR UPDATE"), true);
  assert.equal(claimMigrationSource.includes("v_global_inflight"), true);
  assert.equal(claimMigrationSource.includes("v_user_inflight"), true);
  assert.equal(claimMigrationSource.includes("status IN ('claimed', 'running')"), true);
  assert.equal(claimMigrationSource.includes("SET status = 'claimed'"), true);
  assert.equal(claimMigrationSource.includes("WHERE id = p_job_run_id"), true);
  assert.equal(claimMigrationSource.includes("AND status = 'pending'"), true);
  assert.equal(claimMigrationSource.includes("job_run JSONB"), false);
  assert.equal(claimMigrationSource.includes("lease_token TEXT"), true);
});

await run("P1-CLAIM-3 worker call sites rely on claimRun rather than client-side concurrency counting", async () => {
  const guardBody = guardSource.slice(
    guardSource.indexOf("export async function acquireMissionExecutionSlot("),
    guardSource.indexOf("function makeNoopSlot()"),
  );
  const executionTickBody = executionTickSource.slice(
    executionTickSource.indexOf("async function executeRun("),
    executionTickSource.indexOf("export type ExecutionTickResult ="),
  );

  assert.equal(guardBody.includes("jobLedger.claimRun("), true);
  assert.equal(executionTickBody.includes("jobLedger.claimRun("), true);
  assert.equal(guardBody.includes("COUNT("), false);
  assert.equal(executionTickBody.includes("COUNT("), false);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
