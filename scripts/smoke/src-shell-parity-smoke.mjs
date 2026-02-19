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

const srcEntrypointPath = "src/runtime/entrypoint.js";
const srcHudGatewayPath = "src/runtime/hud-gateway.js";
const srcVoiceLoopPath = "src/runtime/voice-loop.js";
const novaLauncherPath = "nova.js";

await run("src runtime shell files exist", async () => {
  assert.equal(fs.existsSync(path.join(process.cwd(), srcEntrypointPath)), true);
  assert.equal(fs.existsSync(path.join(process.cwd(), srcHudGatewayPath)), true);
  assert.equal(fs.existsSync(path.join(process.cwd(), srcVoiceLoopPath)), true);
});

await run("src runtime entrypoint owns startup lifecycle", async () => {
  const srcEntrypoint = read(srcEntrypointPath);
  assert.equal(srcEntrypoint.includes("export async function startNovaRuntime()"), true);
  assert.equal(srcEntrypoint.includes("startGateway();"), true);
  assert.equal(srcEntrypoint.includes("startMetricsBroadcast(broadcast, 2000);"), true);
  assert.equal(srcEntrypoint.includes("await startVoiceLoop({"), true);
});

await run("launcher defaults to src runtime entrypoint", async () => {
  const launcher = read(novaLauncherPath);
  assert.equal(launcher.includes('["src/runtime/entrypoint.js"]'), true);
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
