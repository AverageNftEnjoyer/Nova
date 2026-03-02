import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  OPENAI_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_REQUEST_TIMEOUT_MS,
  TOOL_LOOP_MAX_DURATION_MS,
  TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS,
  TOOL_LOOP_RECOVERY_TIMEOUT_MS,
  TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP,
} from "../../../src/runtime/core/constants/index.js";
import {
  createToolLoopBudget,
  capToolCallsPerStep,
  isLikelyTimeoutError,
} from "../../../src/runtime/modules/chat/core/tool-loop-guardrails/index.js";

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

function resolveExistingPath(candidates, label) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing ${label}. Checked: ${candidates.join(", ")}`);
}

await run("Guardrail constants remain within provider timeout bounds", () => {
  assert.ok(Number.isFinite(OPENAI_REQUEST_TIMEOUT_MS) && OPENAI_REQUEST_TIMEOUT_MS > 0);
  assert.ok(TOOL_LOOP_REQUEST_TIMEOUT_MS > 0 && TOOL_LOOP_REQUEST_TIMEOUT_MS <= OPENAI_REQUEST_TIMEOUT_MS);
  assert.ok(TOOL_LOOP_MAX_DURATION_MS > 0 && TOOL_LOOP_MAX_DURATION_MS <= OPENAI_REQUEST_TIMEOUT_MS);
  assert.ok(TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS > 0 && TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS <= TOOL_LOOP_MAX_DURATION_MS);
  assert.ok(TOOL_LOOP_RECOVERY_TIMEOUT_MS > 0 && TOOL_LOOP_RECOVERY_TIMEOUT_MS <= TOOL_LOOP_MAX_DURATION_MS);
  assert.ok(TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP >= 1 && TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP <= 20);
});

await run("Budget clamps per-step timeout to remaining loop budget", () => {
  let nowMs = 0;
  const budget = createToolLoopBudget({
    maxDurationMs: 5000,
    minTimeoutMs: 1000,
    now: () => nowMs,
  });
  assert.equal(budget.resolveTimeoutMs(3000), 3000);
  nowMs = 4200;
  assert.equal(budget.resolveTimeoutMs(3000), 1000);
  nowMs = 4999;
  assert.equal(budget.resolveTimeoutMs(3000), 1000);
  nowMs = 5001;
  assert.equal(budget.resolveTimeoutMs(3000), 0);
  assert.equal(budget.isExhausted(), true);
});

await run("Tool-call cap applies deterministic per-step bound", () => {
  const calls = Array.from({ length: 12 }, (_, i) => ({ id: `call-${i}` }));
  const capped = capToolCallsPerStep(calls, 5);
  assert.equal(capped.wasCapped, true);
  assert.equal(capped.requestedCount, 12);
  assert.equal(capped.cappedCount, 5);
  assert.equal(capped.capped.length, 5);
});

await run("Timeout classifier recognizes timeout/abort errors", () => {
  assert.equal(isLikelyTimeoutError(new Error("Tool timed out after 8000ms")), true);
  assert.equal(isLikelyTimeoutError(new Error("request aborted")), true);
  assert.equal(isLikelyTimeoutError(new Error("validation failed")), false);
});

await run("Runtime files contain configured tool-loop guardrail hooks", () => {
  const toolLoopRunnerPath = resolveExistingPath(
    [
      path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "tool-loop-runner", "index.js"),
      path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "tool-loop-runner.js"),
    ],
    "tool-loop runner source",
  );
  const toolLoopRunner = fs.readFileSync(toolLoopRunnerPath, "utf8");
  assert.equal(toolLoopRunner.includes("tool_loop_budget_exhausted"), true);
  assert.equal(toolLoopRunner.includes("tool_loop_step_timeouts"), true);
  assert.equal(toolLoopRunner.includes("tool_loop_tool_exec_timeouts"), true);
  assert.equal(toolLoopRunner.includes("tool_loop_recovery_budget_exhausted"), true);
  assert.equal(toolLoopRunner.includes("tool_loop_tool_call_caps"), true);

  const chatHandlerPath = resolveExistingPath(
    [
      path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler", "index.js"),
      path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler.js"),
    ],
    "chat handler source",
  );
  const chatHandler = fs.readFileSync(
    chatHandlerPath,
    "utf8",
  );
  assert.equal(chatHandler.includes("toolLoopGuardrails"), true);

  const agentRunnerPath = resolveExistingPath(
    [
      path.join(process.cwd(), "src", "agent", "runner", "index.ts"),
      path.join(process.cwd(), "src", "agent", "runner.ts"),
    ],
    "agent runner source",
  );
  const agentRunner = fs.readFileSync(agentRunnerPath, "utf8");
  assert.equal(agentRunner.includes("NOVA_AGENT_TOOL_LOOP_MAX_STEPS"), true);
  assert.equal(agentRunner.includes("NOVA_AGENT_TOOL_LOOP_MAX_DURATION_MS"), true);
  assert.equal(agentRunner.includes("NOVA_AGENT_TOOL_EXEC_TIMEOUT_MS"), true);
  assert.equal(agentRunner.includes("NOVA_AGENT_TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP"), true);
});

await run("Runbook production defaults are encoded in source", () => {
  const constantsSource = fs.readFileSync(
    path.join(process.cwd(), "src", "runtime", "core", "constants", "index.js"),
    "utf8",
  );
  assert.equal(constantsSource.includes('readIntEnv("NOVA_TOOL_LOOP_MAX_DURATION_MS", 32000'), true);
  assert.equal(constantsSource.includes('readIntEnv("NOVA_TOOL_LOOP_REQUEST_TIMEOUT_MS", 12000'), true);
  assert.equal(constantsSource.includes('readIntEnv("NOVA_TOOL_LOOP_TOOL_EXEC_TIMEOUT_MS", 7000'), true);
  assert.equal(constantsSource.includes('readIntEnv("NOVA_TOOL_LOOP_RECOVERY_TIMEOUT_MS", 5000'), true);
  assert.equal(constantsSource.includes('"NOVA_TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP",\n  4,'), true);

  const agentRunnerSource = fs.readFileSync(
    path.join(process.cwd(), "src", "agent", "runner", "index.ts"),
    "utf8",
  );
  assert.equal(agentRunnerSource.includes('envPositiveInt("NOVA_AGENT_TOOL_LOOP_MAX_STEPS", 8, 1)'), true);
  assert.equal(agentRunnerSource.includes('envPositiveInt("NOVA_AGENT_TOOL_LOOP_MAX_DURATION_MS", 32000, 1000)'), true);
  assert.equal(agentRunnerSource.includes('envPositiveInt("NOVA_AGENT_TOOL_EXEC_TIMEOUT_MS", 7000, 1000)'), true);
  assert.equal(agentRunnerSource.includes('envPositiveInt("NOVA_AGENT_TOOL_LOOP_MAX_TOOL_CALLS_PER_STEP", 4, 1)'), true);
});

const pass = results.filter((entry) => entry.status === "PASS").length;
const fail = results.filter((entry) => entry.status === "FAIL").length;
for (const row of results) {
  const suffix = row.detail ? ` :: ${row.detail}` : "";
  console.log(`[${row.status}] ${row.name}${suffix}`);
}
console.log(`\nSummary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
