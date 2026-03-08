import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const helperModule = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/missions/workflow/execution-tick-helpers.mjs")).href,
);

const { createTickMissionSnapshotCache, planExecutionTickCandidates } = helperModule;

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

function makeRun(id, userId, priority = 5) {
  return {
    id,
    user_id: userId,
    mission_id: `mission-${id}`,
    priority,
    scheduled_for: "2026-03-07T00:00:00.000Z",
    status: "pending",
    lease_token: null,
    lease_expires_at: null,
    heartbeat_at: null,
    attempt: 0,
    max_attempts: 1,
    backoff_ms: 0,
    source: "scheduler",
    run_key: null,
    input_snapshot: null,
    output_summary: null,
    error_code: null,
    error_detail: null,
    created_at: "2026-03-07T00:00:00.000Z",
    started_at: null,
    finished_at: null,
    duration_ms: null,
    idempotency_key: null,
  };
}

await run("P2-ET-1 execution-tick selects a fair round-robin batch across users", async () => {
  const pendingRuns = [
    makeRun("a1", "user-a"),
    makeRun("a2", "user-a"),
    makeRun("a3", "user-a"),
    makeRun("a4", "user-a"),
    makeRun("b1", "user-b"),
    makeRun("b2", "user-b"),
    makeRun("c1", "user-c"),
    makeRun("c2", "user-c"),
  ];

  const selected = planExecutionTickCandidates(pendingRuns, {
    batchSize: 5,
    perUserLimit: 2,
  });

  assert.deepEqual(
    selected.map((run) => run.id),
    ["a1", "b1", "c1", "a2", "b2"],
  );
});

await run("P2-ET-2 execution-tick mission snapshot cache loads each user once per tick", async () => {
  const loadCalls = [];
  const cache = createTickMissionSnapshotCache(async ({ userId }) => {
    loadCalls.push(String(userId || ""));
    return [
      { id: "m-a-1", userId: String(userId || "") },
      { id: "m-a-2", userId: String(userId || "") },
    ];
  });

  const mission1 = await cache.getMission("user-a", "m-a-1");
  const mission2 = await cache.getMission("user-a", "m-a-2");
  const mission3 = await cache.getMission("user-b", "m-a-1");

  assert.equal(String(mission1?.id || ""), "m-a-1");
  assert.equal(String(mission2?.id || ""), "m-a-2");
  assert.equal(String(mission3?.userId || ""), "user-b");
  assert.deepEqual(loadCalls, ["user-a", "user-b"]);
});

await run("P2-ET-3 execution-tick source uses scan-limit fairness and shared mission cache helpers", async () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "hud/lib/missions/workflow/execution-tick.ts"),
    "utf8",
  );

  assert.equal(source.includes("EXECUTION_TICK_SCAN_LIMIT"), true);
  assert.equal(source.includes("EXECUTION_TICK_MAX_RUNS_PER_USER"), true);
  assert.equal(source.includes("planExecutionTickCandidates(pendingRuns"), true);
  assert.equal(source.includes("createTickMissionSnapshotCache()"), true);
  assert.equal(source.includes("cache.getMission(run.user_id, run.mission_id)"), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}

console.log(`\nSummary: pass=${passCount} fail=${failCount}`);

if (failCount > 0) process.exit(1);
