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

const telemetryTypesSource = read("hud/lib/missions/telemetry/types.ts");
const telemetryConfigSource = read("hud/lib/missions/telemetry/config.ts");
const telemetrySanitizerSource = read("hud/lib/missions/telemetry/sanitizer.ts");
const telemetryStoreSource = read("hud/lib/missions/telemetry/store.ts");
const telemetrySloSource = read("hud/lib/missions/telemetry/slo.ts");
const telemetryEmitterSource = read("hud/lib/missions/telemetry/emitter.ts");
const buildRouteSource = read("hud/app/api/missions/build/route.ts");
const executeMissionSource = read("hud/lib/missions/workflow/execute-mission.ts");
const autofixRouteSource = read("hud/app/api/missions/autofix/route.ts");
const versionsRouteSource = read("hud/app/api/missions/versions/route.ts");
const reliabilityRouteSource = read("hud/app/api/missions/reliability/route.ts");
const missionsRouteSource = read("hud/app/api/missions/route.ts");
const rateLimitSource = read("hud/lib/security/rate-limit.ts");
const runbookSource = read("tasks/runbooks/mission-reliability-runbook.md");

await run("P6-C1 telemetry module defines lifecycle event model", async () => {
  const requiredTokens = [
    "MissionLifecycleEventType",
    "mission.build.started",
    "mission.validation.completed",
    "mission.run.completed",
    "mission.rollback.completed",
  ];
  for (const token of requiredTokens) {
    assert.equal(telemetryTypesSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P6-C2 telemetry config defines retention and SLO thresholds", async () => {
  const requiredTokens = [
    "MISSION_TELEMETRY_POLICY",
    "NOVA_MISSION_TELEMETRY_RETENTION_DAYS",
    "MISSION_SLO_POLICY",
    "NOVA_MISSION_SLO_RUN_SUCCESS_RATE_MIN",
  ];
  for (const token of requiredTokens) {
    assert.equal(telemetryConfigSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P6-C3 telemetry sanitizer redacts sensitive values", async () => {
  const requiredTokens = [
    "sanitizeMissionTelemetryMetadata",
    "redacted:email",
    "redacted:token",
    "redacted:url-credentials",
    "redacted:jwt",
    "redacted:private-key",
    "redacted:sensitive-key",
  ];
  for (const token of requiredTokens) {
    assert.equal(telemetrySanitizerSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P6-C4 telemetry store persists user-scoped events with retention", async () => {
  const requiredTokens = [
    "mission-telemetry.jsonl",
    "appendMissionTelemetryEvent",
    "listMissionTelemetryEvents",
    "applyRetention",
  ];
  for (const token of requiredTokens) {
    assert.equal(telemetryStoreSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P6-C5 SLO evaluator computes validation/run/retry/p95 metrics", async () => {
  const requiredTokens = [
    "summarizeMissionTelemetry",
    "evaluateMissionSlos",
    "validationPassRate",
    "runSuccessRate",
    "retryRate",
    "runP95Ms",
  ];
  for (const token of requiredTokens) {
    assert.equal(telemetrySloSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P6-C6 lifecycle routes emit telemetry events", async () => {
  assert.equal(telemetryEmitterSource.includes("emitMissionTelemetryEvent"), true, "emitter missing function");
  assert.equal(buildRouteSource.includes("mission.build.started"), true, "build route missing build started event");
  assert.equal(buildRouteSource.includes("mission.validation.completed"), true, "build route missing validation event");
  assert.equal(executeMissionSource.includes("mission.run.started"), true, "execute mission missing run started event");
  assert.equal(executeMissionSource.includes("mission.run.completed"), true, "execute mission missing run completed event");
  assert.equal(autofixRouteSource.includes("mission.autofix.completed"), true, "autofix route missing autofix event");
  assert.equal(versionsRouteSource.includes("mission.rollback.completed"), true, "versions route missing rollback event");
  assert.equal(missionsRouteSource.includes("mission.validation.completed"), true, "missions route missing validation event");
  assert.equal(missionsRouteSource.includes("save_graph"), true, "missions route missing save_graph validation stage");
});

await run("P6-C7 reliability API and rate limit policy exist", async () => {
  const requiredRateLimitTokens = ["missionReliabilityRead", "NOVA_RATE_LIMIT_MISSION_RELIABILITY_READ_PER_MIN"];
  for (const token of requiredRateLimitTokens) {
    assert.equal(rateLimitSource.includes(token), true, `rate-limit missing token: ${token}`);
  }
  const requiredRouteTokens = ["evaluateMissionSlos", "listMissionTelemetryEvents", "RATE_LIMIT_POLICIES.missionReliabilityRead"];
  for (const token of requiredRouteTokens) {
    assert.equal(reliabilityRouteSource.includes(token), true, `reliability route missing token: ${token}`);
  }
});

await run("P6-C8 runbook includes SLO and triage guidance", async () => {
  const requiredTokens = ["Mission Reliability Runbook", "SLO Targets", "Triage Steps", "Immediate Mitigations", "Escalation"];
  for (const token of requiredTokens) {
    assert.equal(runbookSource.includes(token), true, `runbook missing token: ${token}`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
