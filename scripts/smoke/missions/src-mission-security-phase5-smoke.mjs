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

const runtimeAuthSource = read("hud/lib/security/runtime-auth.ts");
const buildRouteSource = read("hud/app/api/missions/build/route.ts");
const triggerRouteSource = read("hud/app/api/notifications/trigger/route.ts");
const triggerStreamRouteSource = read("hud/app/api/notifications/trigger/stream/route.ts");
const dataExecutorsSource = read("hud/lib/missions/workflow/executors/data-executors.ts");
const dispatchSource = read("hud/lib/missions/output/dispatch.ts");
const executionGuardSource = read("hud/lib/missions/workflow/execution-guard.ts");
const executeMissionSource = read("hud/lib/missions/workflow/execute-mission.ts");
const rateLimitSource = read("hud/lib/security/rate-limit.ts");
const missionsRouteSource = read("hud/app/api/missions/route.ts");
const versionsRouteSource = read("hud/app/api/missions/versions/route.ts");
const chatSpecialHandlersSource = read("src/runtime/modules/chat/core/chat-special-handlers.js");

await run("P5-C1 runtime shared-token helper uses timing-safe compare", async () => {
  const requiredTokens = [
    "verifyRuntimeSharedToken",
    "resolveRuntimeSharedTokenConfig",
    "timingSafeStringEqual",
    "NOVA_RUNTIME_SHARED_TOKEN",
    "NOVA_RUNTIME_REQUIRE_SHARED_TOKEN",
  ];
  for (const token of requiredTokens) {
    assert.equal(runtimeAuthSource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P5-C2 mission APIs gate runtime token before auth/logic", async () => {
  const requiredBuildTokens = ["verifyRuntimeSharedToken", "runtimeSharedTokenErrorResponse"];
  for (const token of requiredBuildTokens) {
    assert.equal(buildRouteSource.includes(token), true, `build route missing token: ${token}`);
  }
  assert.equal(triggerRouteSource.includes("verifyRuntimeSharedToken"), true, "trigger route missing verifyRuntimeSharedToken");
  assert.equal(triggerStreamRouteSource.includes("verifyRuntimeSharedToken"), true, "trigger stream route missing verifyRuntimeSharedToken");
});

await run("P5-C3 workflow outbound HTTP paths use SSRF-guarded fetch", async () => {
  const requiredDataTokens = ["fetchWithSsrfGuard", "readResponseTextWithLimit", "NOVA_WORKFLOW_HTTP_TIMEOUT_MS"];
  for (const token of requiredDataTokens) {
    assert.equal(dataExecutorsSource.includes(token), true, `data executors missing token: ${token}`);
  }
  const requiredDispatchTokens = ["fetchWithSsrfGuard", "NOVA_WORKFLOW_WEBHOOK_TIMEOUT_MS"];
  for (const token of requiredDispatchTokens) {
    assert.equal(dispatchSource.includes(token), true, `dispatch missing token: ${token}`);
  }
});

await run("P5-C4 mission execution enforces per-user/global in-flight caps", async () => {
  const requiredGuardTokens = [
    "MISSION_EXECUTION_GUARD_POLICY",
    "NOVA_MISSION_EXECUTION_MAX_INFLIGHT_PER_USER",
    "NOVA_MISSION_EXECUTION_MAX_INFLIGHT_GLOBAL",
    "acquireMissionExecutionSlot",
  ];
  for (const token of requiredGuardTokens) {
    assert.equal(executionGuardSource.includes(token), true, `execution guard missing token: ${token}`);
  }
  assert.equal(executeMissionSource.includes("acquireMissionExecutionSlot"), true, "execute mission missing slot acquire");
  assert.equal(executeMissionSource.includes("executionSlot.slot?.release()"), true, "execute mission missing slot release");
});

await run("P5-C5 mission mutation/version routes are rate limited", async () => {
  const requiredPolicyTokens = ["missionSave", "missionVersionsRead", "missionVersionRestore"];
  for (const token of requiredPolicyTokens) {
    assert.equal(rateLimitSource.includes(token), true, `rate limit policy missing: ${token}`);
  }
  assert.equal(missionsRouteSource.includes("RATE_LIMIT_POLICIES.missionSave"), true, "missions route missing missionSave policy");
  assert.equal(versionsRouteSource.includes("RATE_LIMIT_POLICIES.missionVersionsRead"), true, "versions route missing read policy");
  assert.equal(versionsRouteSource.includes("RATE_LIMIT_POLICIES.missionVersionRestore"), true, "versions route missing restore policy");
});

await run("P5-C6 runtime workflow caller sends shared token header when configured", async () => {
  const requiredTokens = [
    "NOVA_RUNTIME_SHARED_TOKEN",
    "NOVA_RUNTIME_SHARED_TOKEN_HEADER",
    "headers[RUNTIME_SHARED_TOKEN_HEADER] = RUNTIME_SHARED_TOKEN",
  ];
  for (const token of requiredTokens) {
    assert.equal(chatSpecialHandlersSource.includes(token), true, `chat special handlers missing token: ${token}`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
