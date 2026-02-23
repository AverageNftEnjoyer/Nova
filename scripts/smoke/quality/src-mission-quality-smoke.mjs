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

const qualitySource = read("hud/lib/missions/output/quality.ts");
const outputExecutorSource = read("hud/lib/missions/workflow/executors/output-executors.ts");
const executeMissionSource = read("hud/lib/missions/workflow/execute-mission.ts");

await run("P17-C1 quality module exposes scoring + guardrail APIs", async () => {
  const requiredTokens = [
    "export function evaluateMissionOutputQuality",
    "export function applyMissionOutputQualityGuardrails",
    "buildFallbackFromContext",
    "lowSignal",
  ];
  for (const token of requiredTokens) {
    assert.equal(qualitySource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P17-C2 quality module supports runtime guardrail tunables", async () => {
  const requiredTokens = [
    "NOVA_MISSION_QUALITY_MIN_SCORE",
    "NOVA_MISSION_QUALITY_MIN_WORDS",
    "NOVA_MISSION_QUALITY_DEBUG",
    "missing_sources",
  ];
  for (const token of requiredTokens) {
    assert.equal(qualitySource.includes(token), true, `missing token: ${token}`);
  }
});

await run("P17-C3 workflow output path applies quality guardrails before dispatch", async () => {
  const requiredTokens = [
    'import { applyMissionOutputQualityGuardrails } from "../../output/quality"',
    "const { text: guarded } = applyMissionOutputQualityGuardrails(humanized)",
    "dispatchOutput(",
  ];
  for (const token of requiredTokens) {
    assert.equal(outputExecutorSource.includes(token), true, `missing execution token: ${token}`);
  }
});

await run("P17-C4 fallback-output path also applies quality guardrails", async () => {
  const requiredTokens = [
    'const { applyMissionOutputQualityGuardrails } = await import("../output/quality")',
    "const { text: guarded } = applyMissionOutputQualityGuardrails(humanized)",
    "fallback.output.dispatched",
  ];
  for (const token of requiredTokens) {
    assert.equal(executeMissionSource.includes(token), true, `missing fallback token: ${token}`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
const skipCount = results.filter((r) => r.status === "SKIP").length;

for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount} skip=${skipCount}`);

if (failCount > 0) process.exit(1);
