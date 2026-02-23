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
} from "../../../src/runtime/core/constants.js";
import {
  createToolLoopBudget,
  capToolCallsPerStep,
  isLikelyTimeoutError,
} from "../../../src/runtime/modules/chat/core/tool-loop-guardrails.js";

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
  const chatHandler = fs.readFileSync(
    path.join(process.cwd(), "src", "runtime", "modules", "chat", "core", "chat-handler.js"),
    "utf8",
  );
  assert.equal(chatHandler.includes("toolLoopGuardrails"), true);
  assert.equal(chatHandler.includes("tool_loop_budget_exhausted"), true);
  assert.equal(chatHandler.includes("tool_loop_tool_exec_timeouts"), true);

  const agentRunner = fs.readFileSync(
    path.join(process.cwd(), "src", "agent", "runner.ts"),
    "utf8",
  );
  assert.equal(agentRunner.includes("NOVA_AGENT_TOOL_LOOP_MAX_STEPS"), true);
  assert.equal(agentRunner.includes("NOVA_AGENT_TOOL_LOOP_MAX_DURATION_MS"), true);
  assert.equal(agentRunner.includes("NOVA_AGENT_TOOL_EXEC_TIMEOUT_MS"), true);
});

const pass = results.filter((entry) => entry.status === "PASS").length;
const fail = results.filter((entry) => entry.status === "FAIL").length;
for (const row of results) {
  const suffix = row.detail ? ` :: ${row.detail}` : "";
  console.log(`[${row.status}] ${row.name}${suffix}`);
}
console.log(`\nSummary: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
