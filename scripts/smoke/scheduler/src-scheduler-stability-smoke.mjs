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
const schedulerRouteSource = read("hud/app/api/missions/scheduler/route.ts");
const triggerRouteSource = read("hud/app/api/missions/trigger/route.ts");
const triggerStreamRouteSource = read("hud/app/api/missions/trigger/stream/route.ts");
const runMetricsSource = read("hud/lib/notifications/run-metrics/index.ts");

await run("P16-C1 scheduler prevents overlapping ticks and exposes tick state", async () => {
  assert.equal(schedulerSource.includes("tickInFlight"), true);
  assert.equal(schedulerSource.includes("overlapSkipCount"), true);
  assert.equal(schedulerSource.includes("if (state.tickInFlight)"), true);
  assert.equal(schedulerSource.includes("export function getMissionSchedulerState()"), true);
  assert.equal(schedulerSource.includes("NOVA_SCHEDULER_TICK_MS"), true);
});

await run("P16-C2 scheduler API provides observability endpoint", async () => {
  assert.equal(schedulerRouteSource.includes("export async function GET(req: Request)"), true);
  assert.equal(schedulerRouteSource.includes('url.searchParams.get("ensure") === "1"'), true);
  assert.equal(schedulerRouteSource.includes("getMissionSchedulerState()"), true);
});

await run("P16-C3 trigger routes log runs and apply unified run outcome accounting", async () => {
  const requiredTokens = [
    "appendRunLogForExecution",
    "manual-trigger",
  ];
  for (const token of requiredTokens) {
    assert.equal(triggerRouteSource.includes(token), true, `missing trigger token: ${token}`);
  }

  const streamTokens = [
    "appendRunLogForExecution",
    "manual-trigger-stream",
  ];
  for (const token of streamTokens) {
    assert.equal(triggerStreamRouteSource.includes(token), true, `missing stream trigger token: ${token}`);
  }
});

await run("P16-C4 run metrics classify skipped runs and preserve counter semantics", async () => {
  assert.equal(runMetricsSource.includes('export function resolveRunStatus'), true);
  assert.equal(runMetricsSource.includes('status: "skipped"'), true);
  assert.equal(runMetricsSource.includes("failureCount"), true);
  assert.equal(runMetricsSource.includes('status === "error" ? 1 : 0'), true);
});

await run("P16-C5 scheduler state exposes leader election fields (Phase 2)", async () => {
  // getMissionSchedulerState() must return holderId, isLeader, leaseSkipCount
  assert.equal(schedulerSource.includes("isLeader: state.isLeader"), true);
  assert.equal(schedulerSource.includes("leaseSkipCount: state.leaseSkipCount"), true);
  assert.equal(schedulerSource.includes("holderId: SCHEDULER_HOLDER_ID"), true);
  // SCHEDULER_HOLDER_ID must persist across hot-reloads via globalThis
  assert.equal(schedulerSource.includes("__novaMissionSchedulerHolderId"), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
