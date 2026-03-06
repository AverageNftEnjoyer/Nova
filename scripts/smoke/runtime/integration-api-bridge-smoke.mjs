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

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

await run("IAB-1 shared integration bridge has been deleted after lane extraction", async () => {
  assert.equal(fs.existsSync(path.join(process.cwd(), "src/runtime/modules/chat/workers/shared/integration-api-bridge/index.js")), false);
});

await run("IAB-2 spotify service owns timeout + retry controls inside the lane adapter", async () => {
  const source = read("src/runtime/modules/services/spotify/provider-adapter/hud-http/index.js");
  assert.equal(source.includes("fetchWithTimeoutAndRetry"), true);
  assert.equal(source.includes("AbortController"), true);
  assert.equal(source.includes("NOVA_INTEGRATION_BRIDGE_TIMEOUT_MS"), true);
  assert.equal(source.includes("NOVA_INTEGRATION_BRIDGE_RETRY_COUNT"), true);
  assert.equal(source.includes('"spotify.timeout"'), true);
});

await run("IAB-3 youtube service owns timeout + retry controls inside the lane adapter", async () => {
  const source = read("src/runtime/modules/services/youtube/provider-adapter/index.js");
  assert.equal(source.includes("fetchWithTimeoutAndRetry"), true);
  assert.equal(source.includes("AbortController"), true);
  assert.equal(source.includes("NOVA_INTEGRATION_BRIDGE_TIMEOUT_MS"), true);
  assert.equal(source.includes("NOVA_INTEGRATION_BRIDGE_RETRY_COUNT"), true);
  assert.equal(source.includes('"youtube.timeout"'), true);
});

await run("IAB-4 mission lane uses missions service/provider adapter boundary", async () => {
  const missionWorkerSource = read("src/runtime/modules/chat/workers/productivity/missions-agent/index.js");
  assert.equal(missionWorkerSource.includes("runMissionBuildViaHudApi"), false);
  assert.equal(missionWorkerSource.includes("runMissionsDomainService"), true);
  const missionServiceSource = read("src/runtime/modules/services/missions/index.js");
  assert.equal(missionServiceSource.includes("runMissionBuildViaProviderAdapter"), true);
  const missionProviderAdapterSource = read("src/runtime/modules/services/missions/provider-adapter/index.js");
  assert.equal(missionProviderAdapterSource.includes("/api/missions/build"), true);
  assert.equal(missionProviderAdapterSource.includes('headers["X-Idempotency-Key"] = idempotencyKey'), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);

