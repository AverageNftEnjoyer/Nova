import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

const latencyPolicyModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/telemetry/latency-policy.js")).href,
);
const latencyTelemetryModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/telemetry/latency-telemetry.js")).href,
);
const promptBudgetModule = await import(
  pathToFileURL(path.join(process.cwd(), "src/runtime/modules/chat/prompt/prompt-budget.js")).href,
);

const chatHandlerSource = read("src/runtime/modules/chat/core/chat-handler.js");
const devConversationLogSource = read("src/runtime/modules/chat/telemetry/dev-conversation-log.js");

const {
  buildLatencyTurnPolicy,
  resolveToolExecutionPolicy,
} = latencyPolicyModule;
const { createChatLatencyTelemetry } = latencyTelemetryModule;
const { resolveDynamicPromptBudget } = promptBudgetModule;

await run("WSD1 fast-lane greeting avoids tool runtime bootstrap", async () => {
  const policy = buildLatencyTurnPolicy("hello");
  assert.equal(policy.fastLaneSimpleChat, true);
  assert.equal(policy.likelyNeedsToolRuntime, false);
  assert.equal(policy.toolLoopCandidate, false);
});

await run("WSD2 web-intent request enables tool runtime candidate", async () => {
  const policy = buildLatencyTurnPolicy("search latest nba standings");
  assert.equal(policy.fastLaneSimpleChat, false);
  assert.equal(policy.toolLoopCandidate, true);
  assert.equal(policy.likelyNeedsToolRuntime, true);
});

await run("WSD3 runtime tool policy resolves loop and preload eligibility", async () => {
  const turnPolicy = buildLatencyTurnPolicy("search latest pacers news");
  const execution = resolveToolExecutionPolicy(turnPolicy, {
    text: "search latest pacers news",
    availableTools: [{ name: "web_search" }, { name: "web_fetch" }],
    toolLoopEnabled: true,
    executeToolUse: () => ({ content: "ok" }),
  });
  assert.equal(execution.canRunToolLoop, true);
  assert.equal(execution.canRunWebSearch, true);
  assert.equal(execution.canRunWebFetch, true);
  assert.equal(execution.shouldPreloadWebSearch, true);
  assert.equal(execution.shouldPreloadWebFetch, true);
});

await run("WSD4 telemetry captures stage breakdown and correction-pass counter", async () => {
  const tracker = createChatLatencyTelemetry(Date.now() - 120);
  tracker.addStage("prompt_assembly", 18);
  tracker.addStage("llm_generation", 84);
  tracker.incrementCounter("output_constraint_correction_passes", 2);
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.totalMs > 0, true);
  assert.equal(Number(snapshot.stageMs.llm_generation || 0) >= 84, true);
  assert.equal(Number(snapshot.counters.output_constraint_correction_passes || 0), 2);
  assert.equal(String(snapshot.hotStage || "").length > 0, true);
});

await run("WSD5 fast-lane prompt budget profile reduces context budget deterministically", async () => {
  const profile = resolveDynamicPromptBudget({
    maxPromptTokens: 6000,
    responseReserveTokens: 1400,
    historyTargetTokens: 1400,
    sectionMaxTokens: 1000,
    fastLaneSimpleChat: true,
  });
  assert.equal(profile.profile, "fast_lane");
  assert.equal(profile.historyTargetTokens <= 1400, true);
  assert.equal(profile.sectionMaxTokens <= 1000, true);
  assert.equal(profile.responseReserveTokens <= 1400, true);
});

await run("WSD6 chat handler + dev log are wired for latency staging", async () => {
  const requiredChatTokens = [
    'import { createChatLatencyTelemetry } from "./latency-telemetry.js";',
    "const turnPolicy = buildLatencyTurnPolicy(text, {",
    "const executionPolicy = resolveToolExecutionPolicy(turnPolicy, {",
    "latencyTelemetry.addStage(\"runtime_tool_init\"",
    "runSummary.latencyStages = latencySnapshot.stageMs || {};",
    "runSummary.correctionPassCount = Number.isFinite(Number(latencySnapshot.counters?.output_constraint_correction_passes))",
  ];
  for (const token of requiredChatTokens) {
    assert.equal(chatHandlerSource.includes(token), true, `missing chat-handler token: ${token}`);
  }

  const requiredLogTokens = [
    "function normalizeLatencyStages(value)",
    "timing: {",
    "stages: latencyStages,",
    "hotPath: latencyHotPath,",
    "correctionPassCount,",
    "latencyStages: payload.timing.stages,",
  ];
  for (const token of requiredLogTokens) {
    assert.equal(devConversationLogSource.includes(token), true, `missing dev-log token: ${token}`);
  }
});

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) summarize(result);
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
