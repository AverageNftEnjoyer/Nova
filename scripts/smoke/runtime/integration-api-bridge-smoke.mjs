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

await run("IAB-1 bridge enforces timeout + retry controls", async () => {
  const source = read("src/runtime/modules/chat/workers/shared/integration-api-bridge/index.js");
  assert.equal(source.includes("fetchWithTimeoutAndRetry"), true);
  assert.equal(source.includes("AbortController"), true);
  assert.equal(source.includes("NOVA_INTEGRATION_BRIDGE_TIMEOUT_MS"), true);
  assert.equal(source.includes("NOVA_INTEGRATION_BRIDGE_RETRY_COUNT"), true);
});

await run("IAB-2 spotify bridge maps aborts to timeout code", async () => {
  const source = read("src/runtime/modules/chat/workers/shared/integration-api-bridge/index.js");
  assert.equal(source.includes('code: errorCode'), true);
  assert.equal(source.includes('"spotify.timeout"'), true);
});

await run("IAB-3 youtube bridge maps aborts to timeout code", async () => {
  const source = read("src/runtime/modules/chat/workers/shared/integration-api-bridge/index.js");
  assert.equal(source.includes('"youtube.timeout"'), true);
  assert.equal(source.includes('code: errorCode'), true);
});

await run("IAB-4 mission bridge posts with idempotency support", async () => {
  const source = read("src/runtime/modules/chat/workers/shared/integration-api-bridge/index.js");
  assert.equal(source.includes("runMissionBuildViaHudApi"), true);
  assert.equal(source.includes("/api/missions/build"), true);
  assert.equal(source.includes('headers["X-Idempotency-Key"] = idempotencyKey'), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);

