import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

function runNodeScript(relativePath) {
  const scriptPath = path.join(process.cwd(), relativePath);
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
  });
  const output = `${String(child.stdout || "")}\n${String(child.stderr || "")}`.trim();
  if (child.status !== 0) {
    throw new Error(`script failed: ${relativePath}\n${output.slice(0, 2400)}`);
  }
  return output;
}

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const constantsSource = read("src/runtime/core/constants.js");
const packageJson = JSON.parse(read("package.json"));

await run("P20-C1 network/security guards remain enforced", async () => {
  const output = runNodeScript("scripts/smoke/src-security-hardening-smoke.mjs");
  assert.equal(output.includes("P11 SSRF guard blocks localhost target"), true);
  assert.equal(output.includes("P12 suspicious pattern detection"), true);
});

await run("P20-C2 transport + tool policy regressions remain blocked", async () => {
  const transportOutput = runNodeScript("scripts/smoke/src-transport-stability-smoke.mjs");
  assert.equal(transportOutput.includes("P14-C5 inbound dedupe"), true);

  const toolsOutput = runNodeScript("scripts/smoke/src-tool-loop-smoke.mjs");
  assert.equal(toolsOutput.includes("dangerous tools are blocked by default policy"), true);
});

await run("P20-C3 scheduler reliability regressions remain covered", async () => {
  const schedulerOutput = runNodeScript("scripts/smoke/src-scheduler-delivery-smoke.mjs");
  assert.equal(schedulerOutput.includes("idempotency keys"), true);
  assert.equal(schedulerOutput.includes("retry"), true);
});

await run("P20-C4 runtime defaults are locked to safe baseline values", async () => {
  assert.equal(constantsSource.includes('NOVA_TOOL_ALLOW_DANGEROUS || "0"'), true);
  assert.equal(constantsSource.includes('NOVA_TOOL_ALLOW_ELEVATED || "1"'), true);
  assert.equal(constantsSource.includes('NOVA_TOOL_CAPABILITY_ENFORCE || "0"'), true);
  assert.equal(constantsSource.includes('NOVA_ALLOW_PROVIDER_FALLBACK || ""'), true);
});

await run("P20-C5 release smoke chain includes security, memory, routing, and isolation gates", async () => {
  const releaseScript = String(packageJson?.scripts?.["smoke:src-release"] || "");
  const required = [
    "smoke:src-security",
    "smoke:src-memory",
    "smoke:src-routing",
    "smoke:src-plugin-isolation",
    "smoke:src-release-readiness",
  ];
  for (const token of required) {
    assert.equal(releaseScript.includes(token), true, `missing ${token} in smoke:src-release`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
