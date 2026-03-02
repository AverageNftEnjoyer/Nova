import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

const checks = [];

function record(status, name, detail = "") {
  checks.push({ status, name, detail });
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
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

await run("Runtime launcher avoids blocking execSync for netstat/PowerShell paths", () => {
  const content = read("nova.js");
  assert.equal(/\bexecSync\s*\(/.test(content), false);
  assert.equal(/execFileSync\("netstat"/.test(content), true);
  assert.equal(/execFileSync\("powershell"/.test(content), true);
});

await run("Voice capture uses argument-array spawnSync and explicit failure handling", () => {
  const content = read("src/runtime/modules/audio/voice/index.js");
  assert.equal(/\bexecSync\s*\(/.test(content), false);
  assert.equal(/spawnSync\("sox",\s*\[/.test(content), true);
  assert.equal(/if \(result\.status !== 0\)/.test(content), true);
});

await run("Tool runtime build bootstrap avoids shell-string execSync", () => {
  const content = read("src/tools/runtime/runtime-compat/index.js");
  assert.equal(/\bexecSync\s*\(/.test(content), false);
  assert.equal(/spawnSync\(NPM_BIN,\s*\["run",\s*"build:agent-core"\]/.test(content), true);
  assert.equal(/timeout:\s*180000/.test(content), true);
});

await run("Metrics broadcast supports explicit userContextId semantics", () => {
  const content = read("src/runtime/modules/infrastructure/metrics/index.js");
  assert.equal(/startMetricsBroadcast\(broadcast,\s*intervalMs\s*=\s*DEFAULT_INTERVAL_MS,\s*options\s*=\s*\{\}\)/.test(content), true);
  assert.equal(/userContextId/.test(content), true);
});

await run("Runtime entrypoint pins metrics routing through explicit userContextId behavior", () => {
  const content = read("src/runtime/core/entrypoint/index.js");
  assert.equal(/const userContextId = ""/.test(content), true);
  assert.equal(/startMetricsBroadcast\(/.test(content), true);
  assert.equal(/broadcast\(payload,\s*\{\s*userContextId:\s*payload\?\.userContextId\s*\?\?\s*userContextId\s*\}\)/.test(content), true);
});

for (const check of checks) {
  const suffix = check.detail ? ` :: ${check.detail}` : "";
  console.log(`[${check.status}] ${check.name}${suffix}`);
}

const passCount = checks.filter((entry) => entry.status === "PASS").length;
const failCount = checks.filter((entry) => entry.status === "FAIL").length;
const skipCount = checks.filter((entry) => entry.status === "SKIP").length;
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) {
  process.exit(1);
}
