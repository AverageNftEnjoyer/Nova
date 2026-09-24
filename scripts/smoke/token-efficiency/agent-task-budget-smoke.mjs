/**
 * Agent-task budget smoke (token-efficiency Stage 4: per-task budgets with graceful degradation).
 *
 *   ATB-1  controller unit: projection, warning at 80%, degrade ONCE to the same provider's economy model (never
 *          another provider's, not when the economy model is not cheaper), exhausted throw, no budget -> null
 *   ATB-2  trim helpers: earlier tool results -> previews, the latest step kept in full, ids / is_error kept,
 *          idempotent, input objects never mutated
 *   ATB-3  OpenAI-compatible loop through the real handleInput (source "agent-task"): warning -> the next request
 *          has trimmed tool results AND the economy model -> exhausted before the next call (no call after it);
 *          the recovery call is budgeted too (degrades, or pauses before it is sent)
 *   ATB-4  the same through the Claude loop (fake Anthropic host)
 *   ATB-5  no budget -> the loops are unchanged: taskBudget undefined, a never-reached budget, and a controller on a
 *          chat ("hud") turn all send byte-identical requests (model, messages, tools) and the same number of calls
 *   ATB-6  the real agent-task service: pause at the budget (row + events), raise budget -> requeue -> re-run from the
 *          start with the earlier spend counted -> completes; stop on a budget-paused task; play without room refused
 *   ATB-7  mutation self-check: with enforcement removed (taskBudget not passed to the loop), ATB-3's expectation fails
 *
 * Offline: temp NOVA_DATA_DIR, fake providers behind a network guard (any real network call fails the run), no API
 * keys. Model usage is scripted per call so the budget fractions are exact. Needs `npm run build:agent-core`.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Read at module load by the runtime: set before any runtime import (all runtime imports below are dynamic).
process.env.NOVA_EMBEDDING_PROVIDER = "local";
process.env.NOVA_TOOL_LOOP_MAX_STEPS = "4";
process.env.NOVA_AGENT_TASK_POLL_MS = "20";
process.env.NOVA_AGENT_TASK_CONTROL_MS = "25";
process.env.NOVA_AGENT_TASK_HEARTBEAT_MS = "50";

const { isolatedDataDir } = await import("../lib/isolated-data-dir.mjs");
const { loadHudTaskStore } = await import("../lib/hud-task-store.mjs");
const {
  FAKE_CLAUDE_BASE_URL,
  FAKE_OPENAI_BASE_URL,
  createCapture,
  createFakeClaudeHandler,
  createFakeOpenAiClient,
  describeRequest,
  installNetworkGuard,
} = await import("./token-harness-lib.mjs");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const srcModule = (relative) => import(pathToFileURL(path.join(repoRoot, relative)).href);

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

// ── Fakes: scripted tool steps + scripted usage per call ─────────────────────────────────────────────────────

const capture = createCapture();
/** The running scenario: tool steps to answer with, usage per call, and a timeline of calls and budget events. */
let scenario = { plan: [], planIndex: 0, usage: [], callIndex: 0, timeline: [] };
function startScenario({ plan = [], usage = [] } = {}) {
  scenario = { plan, planIndex: 0, usage, callIndex: 0, timeline: [] };
  return scenario;
}
async function responder(request) {
  if (describeRequest(request).hasTools && scenario.planIndex < scenario.plan.length) {
    const step = scenario.plan[scenario.planIndex];
    scenario.planIndex += 1;
    return { toolCalls: step };
  }
  return { text: "Done: the workspace holds a small demo service with a README and notes." };
}
function usageFor(request) {
  const usage = scenario.usage[scenario.callIndex] ?? { inputTokens: 1_000, outputTokens: 50 };
  scenario.callIndex += 1;
  scenario.timeline.push({ kind: "call", model: String(request?.model || "") });
  return usage;
}

// A fresh client / handler per run keeps tool-call ids (call_<n>_1, toolu_<n>_1) comparable between runs.
let fakeOpenAiClient = createFakeOpenAiClient({ capture, responder, usageFor });
let claudeHandler = createFakeClaudeHandler({ capture, responder, usageFor });
function resetFakes() {
  fakeOpenAiClient = createFakeOpenAiClient({ capture, responder, usageFor });
  claudeHandler = createFakeClaudeHandler({ capture, responder, usageFor });
}
const guard = installNetworkGuard({ [`${FAKE_CLAUDE_BASE_URL}/v1/messages`]: (url, init) => claudeHandler(url, init) });

const { handleInput } = await srcModule("src/runtime/modules/chat/core/chat-handler/index.js");
const { withLlmUsageObserver } = await srcModule("src/providers/usage/index.js");
const { resolveModelPricing } = await srcModule("src/providers/pricing/index.js");
const budgetModule = await srcModule("src/runtime/modules/agent-tasks/budget/index.js");
const settingsModule = await srcModule("src/runtime/modules/agent-tasks/budget-settings/index.js");
const trimModule = await srcModule("src/runtime/modules/chat/core/chat-handler/loop-context-trim/index.js");
const { startAgentTaskService } = await srcModule("src/runtime/modules/agent-tasks/index.js");
const { getDb } = await srcModule("src/db/index.js");

const { createTaskBudgetController, AGENT_TASK_BUDGET_EXHAUSTED, AgentTaskBudgetExhaustedError } = budgetModule;
const { DEFAULT_ECONOMY_MODELS, resolveEffectiveTaskBudget } = settingsModule;
const { trimOpenAiLoopToolResults, trimClaudeLoopToolResults } = trimModule;

const TRIM_PREFIX = "[Earlier tool result shortened to stay within this task's budget.";
const TERRA = "gpt-5.6-terra";
const LUNA = "gpt-5.6-luna";
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001";
const OUTPUT_TOKENS = 100;
// A chat ("hud") turn with this text runs the tool loop (the review prompt above would be a plain streamed answer).
const CHAT_TOOL_PROMPT = "Run ls in my workspace and tell me what you see.";
const PROMPT = "Review the project in this workspace: look at the layout, go through the README and produce a short report of what it does.";

/** Input tokens that make one call of `model` (with OUTPUT_TOKENS output) cost `usd`. */
function inputTokensForCost(model, usd) {
  const pricing = resolveModelPricing(model);
  assert.ok(pricing, `no pricing for ${model}`);
  return Math.round((usd * 1e6 - OUTPUT_TOKENS * pricing.output) / pricing.input);
}
const callUsage = (inputTokens) => ({ inputTokens, outputTokens: OUTPUT_TOKENS });

function selection(shape) {
  if (shape === "claude") {
    return {
      activeChatRuntime: { provider: "claude", connected: true, apiKey: "fake-claude-key", baseURL: FAKE_CLAUDE_BASE_URL, model: SONNET },
      activeOpenAiCompatibleClient: null,
      selectedChatModel: SONNET,
    };
  }
  return {
    activeChatRuntime: { provider: "openai", connected: true, apiKey: "fake-openai-key", baseURL: FAKE_OPENAI_BASE_URL, model: TERRA },
    activeOpenAiCompatibleClient: fakeOpenAiClient,
    selectedChatModel: TERRA,
  };
}

const workspaceDir = path.join(isolatedDataDir, "agent-task-budget", "workspace");
fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
fs.writeFileSync(path.join(workspaceDir, "README.md"), `# Demo\n\n${"A tiny demo service that answers health checks. ".repeat(60)}\n`, "utf8");
fs.writeFileSync(path.join(workspaceDir, "NOTES.md"), `# Notes\n\n${"Deployment notes and open questions. ".repeat(60)}\n`, "utf8");
fs.writeFileSync(path.join(workspaceDir, "src", "server.js"), "console.log('hi');\n", "utf8");

const STEP_LS = [{ name: "ls", input: { path: "." } }];
const STEP_README = [{ name: "read", input: { path: "README.md" } }];
const STEP_NOTES = [{ name: "read", input: { path: "NOTES.md" } }];

/** A budget controller whose events also land on the running scenario's timeline. */
function timelineController(options) {
  const events = [];
  const controller = createTaskBudgetController({
    userContextId: "atb-user",
    taskId: "atb-task",
    economyModels: DEFAULT_ECONOMY_MODELS,
    ...options,
    onEvent: (event) => {
      events.push(event);
      scenario.timeline.push({ kind: "event", reason: event.reason, event });
    },
  });
  return { controller, events };
}

/**
 * One turn through the real handleInput. `taskBudget` is passed only when the key is present in `extra`
 * (so "no budget plumbing at all" and "taskBudget: undefined" are distinct runs); `observer` wraps the turn in
 * withLlmUsageObserver like the agent-task service does.
 */
async function runTurn({ shape, source = "agent-task", id, observer, extra = {}, prompt = PROMPT }) {
  resetFakes();
  const before = capture.calls.length;
  const agentTask = source === "agent-task";
  const opts = {
    voice: false,
    source,
    sender: agentTask ? "agent-task" : "hud-user",
    userContextId: `atb-${shape}`,
    conversationId: agentTask ? `agent-task-${id}` : `atb-thread-${id}`,
    sessionKeyHint: agentTask ? `agent-task:atb-${shape}:${id}` : `agent:nova:hud:user:atb-${shape}:dm:atb-thread-${id}`,
    preferredProvider: shape,
    ...(agentTask
      ? {
          autonomousTask: true,
          permissionMode: "default",
          approvedTools: [],
          taskId: id,
          workspaceDir,
          worktreePath: "",
          executionFenceCheck: () => {},
          consumeTaskApproval: () => {},
          reserveTaskEffect: () => {},
        }
      : {}),
    runtimeSelectionOverride: selection(shape),
    ...extra,
  };
  const turn = () => handleInput(prompt, opts);
  const result = await (observer ? withLlmUsageObserver(observer, turn) : turn());
  return { result, calls: capture.calls.slice(before) };
}

const toolMessages = (request) => (request.messages || []).filter((m) => m?.role === "tool");
const claudeToolResults = (request) => (request.messages || [])
  .filter((m) => m?.role === "user" && Array.isArray(m.content))
  .flatMap((m) => m.content.filter((block) => block?.type === "tool_result"));
const isTrimmed = (content) => typeof content === "string" && content.startsWith(TRIM_PREFIX);
const timelineShape = (timeline) => timeline.map((entry) => (entry.kind === "call" ? `call:${entry.model}` : `event:${entry.reason}`));

// Silence runtime chatter (restored before the report).
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};

// ── ATB-1: controller unit ───────────────────────────────────────────────────────────────────────────────────

const costBudget = (costUsd) => ({ costUsd, tokens: null, active: true });
const record = (model, inputTokens, outputTokens, costUsd) => ({ model, inputTokens, outputTokens, costUsd });

await run("ATB-1a no budget -> no controller (callers run exactly as before)", async () => {
  assert.equal(createTaskBudgetController({ budget: { costUsd: null, tokens: null, active: false } }), null);
  assert.equal(createTaskBudgetController({}), null);
  const none = resolveEffectiveTaskBudget({}, { defaultCostBudgetUsd: null, defaultTokenBudget: null });
  assert.equal(none.active, false);
  assert.equal(createTaskBudgetController({ budget: none }), null);
  const defaults = resolveEffectiveTaskBudget({}, settingsModule.normalizeAgentTaskBudgetSettings({}));
  assert.deepEqual({ costUsd: defaults.costUsd, tokens: defaults.tokens, active: defaults.active }, { costUsd: 0.25, tokens: 100_000, active: true });
});

await run("ATB-1b projection: max(last input, request estimate) + last output, uncached rate; token budgets too", async () => {
  const { controller, events } = timelineController({ budget: { costUsd: null, tokens: 10_000, active: true } });
  controller.observe(record(TERRA, 3_000, 100, 0.0072));
  // 3,100 spent + max(3,000, 2,000) + 100 = 6,200 < 10,000.
  assert.deepEqual(controller.beforeModelCall({ provider: "openai", model: TERRA, estimateInputTokens: () => 2_000 }), { model: TERRA, trimContext: false });
  // 3,100 + 7,000 + 100 = 10,200 >= 10,000: degrade; the economy model uses as many tokens -> exhausted, no call.
  assert.throws(
    () => controller.beforeModelCall({ provider: "openai", model: TERRA, estimateInputTokens: () => 7_000 }),
    (error) => error instanceof AgentTaskBudgetExhaustedError && error.code === AGENT_TASK_BUDGET_EXHAUSTED && error.snapshot.state === "exhausted",
  );
  assert.deepEqual(events.map((e) => e.reason), ["degraded", "exhausted"], "one big call jumps from <80% straight to degraded");
  assert.equal(events[0].fromModel, TERRA);
  assert.equal(events[0].toModel, LUNA);
  // Cost projection: before any call, estimate x input rate + 256 output tokens x output rate.
  const cost = createTaskBudgetController({ budget: costBudget(0.0071) });
  // 1,000 x $2/M + 256 x $12/M = $0.005072 < $0.0071.
  assert.equal(cost.beforeModelCall({ provider: "openai", model: TERRA, estimateInputTokens: () => 1_000 }).model, TERRA);
  const tight = createTaskBudgetController({ budget: costBudget(0.005), economyModels: DEFAULT_ECONOMY_MODELS });
  // Same projection >= $0.005 -> degrade: on luna it is $0.000507, so luna is called instead of terra.
  assert.deepEqual(tight.beforeModelCall({ provider: "openai", model: TERRA, estimateInputTokens: () => 1_000 }), { model: LUNA, trimContext: true });
  // An unpriced model projects no cost.
  const unpriced = createTaskBudgetController({ budget: costBudget(0.01) });
  unpriced.observe(record("local-unpriced-model", 50_000, 1_000, null));
  assert.equal(unpriced.beforeModelCall({ provider: "openai", model: "local-unpriced-model" }).model, "local-unpriced-model");
  assert.equal(unpriced.snapshot().spentTokens, 51_000);
});

await run("ATB-1c warning once at 80%; degrade once to the same provider's economy model; then exhausted throw", async () => {
  const { controller, events } = timelineController({ budget: costBudget(1) });
  controller.observe(record(TERRA, 1_000, 10, 0.79));
  assert.equal(controller.getState(), "ok");
  assert.equal(events.length, 0);
  controller.observe(record(TERRA, 1_000, 10, 0.01));
  assert.equal(controller.getState(), "warning");
  controller.observe(record(TERRA, 1_000, 10, 0.001));
  assert.deepEqual(events.map((e) => e.reason), ["warning"], "warning is emitted once");
  const warning = events[0];
  assert.equal(warning.type, "agent-task-budget");
  assert.equal(warning.userContextId, "atb-user");
  assert.equal(warning.taskId, "atb-task");
  assert.equal(warning.costBudgetUsd, 1);
  assert.ok(warning.fraction >= 0.8 && warning.fraction < 0.81, `fraction ${warning.fraction}`);

  // Real-sized calls: 200,000 in / 1,000 out = $0.412 on terra, $0.0412 on luna.
  const big = createTaskBudgetController({ budget: costBudget(1), economyModels: DEFAULT_ECONOMY_MODELS, onEvent: (e) => events.push(e) });
  events.length = 0;
  const bigCall = (model) => record(model, 200_000, 1_000, model === TERRA ? 0.412 : 0.0412);
  assert.deepEqual(big.beforeModelCall({ provider: "openai", model: TERRA }), { model: TERRA, trimContext: false });
  big.observe(bigCall(TERRA)); // 0.412
  assert.deepEqual(big.beforeModelCall({ provider: "openai", model: TERRA }), { model: TERRA, trimContext: false }); // 0.824 < 1
  big.observe(bigCall(TERRA)); // 0.824 -> warning
  assert.deepEqual(big.beforeModelCall({ provider: "openai", model: TERRA }), { model: LUNA, trimContext: true }); // 1.236 -> degrade
  assert.equal(big.getState(), "degraded");
  big.observe(bigCall(LUNA)); // 0.8652
  assert.deepEqual(big.beforeModelCall({ provider: "openai", model: TERRA }), { model: LUNA, trimContext: false }, "degrades once");
  big.observe(bigCall(LUNA)); // 0.9064
  assert.deepEqual(big.beforeModelCall({ provider: "openai", model: LUNA }), { model: LUNA, trimContext: false });
  big.observe(bigCall(LUNA)); // 0.9476
  big.beforeModelCall({ provider: "openai", model: LUNA }); // 0.9888 < 1
  big.observe(bigCall(LUNA)); // 0.9888
  assert.throws(() => big.beforeModelCall({ provider: "openai", model: LUNA }), (error) => error.code === AGENT_TASK_BUDGET_EXHAUSTED);
  assert.throws(() => big.beforeModelCall({ provider: "openai", model: LUNA }), (error) => error.code === AGENT_TASK_BUDGET_EXHAUSTED, "stays exhausted");
  assert.deepEqual(events.map((e) => e.reason), ["warning", "degraded", "exhausted", "exhausted"]);
  assert.deepEqual([events[1].fromModel, events[1].toModel, events[1].economyModel], [TERRA, LUNA, LUNA]);
  assert.equal(big.snapshot().degraded, true);
});

await run("ATB-1d economy model: never another provider's, never one that is not cheaper; already over -> exhausted", async () => {
  const degradeOnce = (provider, model, economyModels) => {
    const events = [];
    const controller = createTaskBudgetController({ budget: costBudget(0.01), economyModels, onEvent: (e) => events.push(e) });
    let decision = null;
    try {
      decision = controller.beforeModelCall({ provider, model, estimateInputTokens: () => 100_000 });
    } catch (error) {
      assert.equal(error.code, AGENT_TASK_BUDGET_EXHAUSTED);
    }
    const degraded = events.find((e) => e.reason === "degraded");
    assert.ok(degraded, "expected a degraded event");
    return { toModel: degraded.toModel, decision };
  };
  // A cross-provider economy model is ignored: the task keeps its model (only the context would be trimmed).
  assert.equal(degradeOnce("openai", TERRA, { openai: HAIKU }).toModel, TERRA);
  assert.equal(degradeOnce("claude", SONNET, { claude: LUNA }).toModel, SONNET);
  // Not cheaper: luna is already the economy model; terra configured as economy for luna is dearer.
  assert.equal(degradeOnce("openai", LUNA, DEFAULT_ECONOMY_MODELS).toModel, LUNA);
  assert.equal(degradeOnce("openai", LUNA, { openai: TERRA }).toModel, LUNA);
  // Same provider and cheaper: used.
  assert.equal(degradeOnce("claude", SONNET, DEFAULT_ECONOMY_MODELS).toModel, HAIKU);

  const events = [];
  const over = createTaskBudgetController({ budget: costBudget(1), prior: { spentUsd: 1.2, spentTokens: 0 }, onEvent: (e) => events.push(e) });
  assert.equal(over.getState(), "warning", "prior spend sets the starting state");
  assert.throws(() => over.beforeModelCall({ provider: "openai", model: TERRA }), (error) => error.code === AGENT_TASK_BUDGET_EXHAUSTED);
  assert.deepEqual(events.map((e) => e.reason), ["exhausted"], "already over and not degraded -> straight to exhausted");
  const listenerThrows = createTaskBudgetController({ budget: costBudget(1), onEvent: () => { throw new Error("listener"); } });
  listenerThrows.observe(record(TERRA, 1, 1, 0.9));
  assert.equal(listenerThrows.getState(), "warning", "a failing listener never breaks the controller");
});

// ── ATB-2: trim helpers ──────────────────────────────────────────────────────────────────────────────────────

await run("ATB-2a OpenAI trim: earlier tool results -> previews, latest step full, ids kept, idempotent, no mutation", async () => {
  const long = "file listing line\n".repeat(400);
  const shared = { role: "tool", tool_call_id: "call_a", content: long };
  const latestB = { role: "tool", tool_call_id: "call_b", content: "latest result b" };
  const latestC = { role: "tool", tool_call_id: "call_c", content: [{ type: "text", text: "latest result c" }] };
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "task" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_a", type: "function", function: { name: "ls", arguments: "{}" } }] },
    shared,
    { role: "tool", tool_call_id: "call_a2", content: [{ type: "text", text: long }] },
    { role: "assistant", content: null, tool_calls: [{ id: "call_b", type: "function" }, { id: "call_c", type: "function" }] },
    latestB,
    latestC,
  ];
  const before = JSON.stringify(shared);
  assert.equal(trimOpenAiLoopToolResults(messages), 2);
  assert.ok(isTrimmed(messages[3].content) && messages[3].content.includes("Preview:"));
  assert.ok(messages[3].content.length < long.length / 4, "preview is short");
  assert.equal(messages[3].tool_call_id, "call_a");
  assert.ok(isTrimmed(messages[4].content), "array content is trimmed too");
  assert.equal(messages[4].tool_call_id, "call_a2");
  assert.equal(messages[6], latestB, "latest step kept (same object)");
  assert.equal(messages[7], latestC);
  assert.equal(JSON.stringify(shared), before, "the original message object is not mutated");
  const once = JSON.stringify(messages);
  assert.equal(trimOpenAiLoopToolResults(messages), 0, "idempotent");
  assert.equal(JSON.stringify(messages), once);
  assert.equal(trimOpenAiLoopToolResults(null), 0);
});

await run("ATB-2b Claude trim: earlier tool_result blocks -> previews, latest kept, tool_use_id / is_error kept, idempotent", async () => {
  const long = "README line\n".repeat(400);
  const earlierBlock = { type: "tool_result", tool_use_id: "toolu_1", content: long, is_error: true };
  const earlier = { role: "user", content: [earlierBlock, { type: "text", text: "note" }] };
  const latest = { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: [{ type: "text", text: long }] }] };
  const messages = [
    { role: "user", content: "task" },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read", input: {} }] },
    earlier,
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "read", input: {} }] },
    latest,
  ];
  assert.equal(trimClaudeLoopToolResults(messages), 1);
  const block = messages[2].content[0];
  assert.ok(isTrimmed(block.content) && block.content.length < long.length / 4);
  assert.equal(block.tool_use_id, "toolu_1");
  assert.equal(block.is_error, true);
  assert.deepEqual(messages[2].content[1], { type: "text", text: "note" });
  assert.equal(messages[4], latest, "latest tool results kept (same object)");
  assert.equal(earlierBlock.content, long, "the original block is not mutated");
  assert.equal(earlier.content[0], earlierBlock);
  const once = JSON.stringify(messages);
  assert.equal(trimClaudeLoopToolResults(messages), 0, "idempotent");
  assert.equal(JSON.stringify(messages), once);
});

// ── ATB-3 / ATB-4: through the real loops ────────────────────────────────────────────────────────────────────

/**
 * Budget $0.20. Each shape: call 1 and 2 on the task's model, warning after call 2, call 3 projected over ->
 * degrade (trim + economy), exactly one economy call fits, call 4 projected over -> exhausted before it is sent.
 *   openai: 31% + 60% -> 91% (warning); +60% would be 151% -> luna (10x cheaper, +6%) -> 97%; +6% -> 103%: pause.
 *   claude: 45% + 36% -> 81% (warning); +36% -> 117% -> haiku (2x cheaper, +18%) -> 99%; +18% -> 117%: pause.
 * (Call 2 is projected from call 1's size, so the first call must stay below half of the budget.)
 */
const LOOP_BUDGET_USD = 0.2;
function loopScenario(shape) {
  const [regular, economy, fractions] = shape === "claude" ? [SONNET, HAIKU, [0.45, 0.36]] : [TERRA, LUNA, [0.31, 0.6]];
  const p1 = inputTokensForCost(regular, fractions[0] * LOOP_BUDGET_USD);
  const p2 = inputTokensForCost(regular, fractions[1] * LOOP_BUDGET_USD);
  return { regular, economy, usage: [callUsage(p1), callUsage(p2), callUsage(p2), callUsage(p2)], plan: [STEP_LS, STEP_README, STEP_NOTES] };
}

async function runBudgetedLoop(shape, { enforce = true } = {}) {
  const spec = loopScenario(shape);
  const current = startScenario({ plan: spec.plan, usage: spec.usage });
  const { controller, events } = timelineController({ budget: costBudget(LOOP_BUDGET_USD) });
  const turn = await runTurn({
    shape,
    id: `${shape}-budget-${enforce ? "on" : "off"}`,
    observer: controller.observe,
    extra: enforce ? { taskBudget: controller } : {},
  });
  return { ...turn, spec, controller, events, timeline: current.timeline };
}

/** The expected degrade sequence of ATB-3 / ATB-4. Throws on any deviation (reused by the ATB-7 self-check). */
function assertDegradeSequence(shape, runResult) {
  const { calls, spec, controller, events, timeline, result } = runResult;
  assert.deepEqual(timelineShape(timeline), [
    `call:${spec.regular}`,
    `call:${spec.regular}`,
    "event:warning",
    "event:degraded",
    `call:${spec.economy}`,
    "event:exhausted",
  ], "order: 2 calls -> warning -> degraded -> 1 economy call -> exhausted (no call after the pause)");
  assert.equal(calls.length, 3, `model calls: ${calls.length}`);
  assert.deepEqual(calls.map((c) => c.request.model), [spec.regular, spec.regular, spec.economy]);
  const degraded = events.find((e) => e.reason === "degraded");
  assert.deepEqual([degraded.fromModel, degraded.toModel], [spec.regular, spec.economy]);
  // Call 3: step 1's result shortened, step 2's (the latest) in full; step 1 was in full on call 2.
  if (shape === "claude") {
    const [c2, c3] = [claudeToolResults(calls[1].request), claudeToolResults(calls[2].request)];
    assert.equal(c2.length, 1);
    assert.equal(c3.length, 2);
    assert.ok(!isTrimmed(c2[0].content), "call 2 still had step 1 in full");
    assert.ok(isTrimmed(c3[0].content), "call 3 did not trim step 1's tool result");
    assert.equal(c3[0].tool_use_id, c2[0].tool_use_id);
    assert.ok(!isTrimmed(c3[1].content), "the latest step's tool result was trimmed");
  } else {
    const [c2, c3] = [toolMessages(calls[1].request), toolMessages(calls[2].request)];
    assert.equal(c2.length, 1);
    assert.equal(c3.length, 2);
    assert.ok(!isTrimmed(c2[0].content), "call 2 still had step 1 in full");
    assert.ok(isTrimmed(c3[0].content), "call 3 did not trim step 1's tool result");
    assert.equal(c3[0].tool_call_id, c2[0].tool_call_id);
    assert.ok(!isTrimmed(c3[1].content), "the latest step's tool result was trimmed");
    assert.ok(String(c3[1].content).length > 500, "the latest step's tool result is the full README");
  }
  assert.equal(controller.getState(), "exhausted");
  assert.equal(result?.ok, false);
  assert.equal(result?.budgetExhausted?.state, "exhausted", "runSummary.budgetExhausted carries the snapshot");
  assert.match(String(result?.reply || ""), /Paused: this agent task reached its budget/);
}

const loopRuns = {};
for (const [label, shape] of [["ATB-3", "openai"], ["ATB-4", "claude"]]) {
  await run(`${label} [${shape}] loop: warning -> trimmed context + economy model -> exhausted, no call after the pause`, async () => {
    loopRuns[shape] = await runBudgetedLoop(shape);
    assertDegradeSequence(shape, loopRuns[shape]);
  });
}

/**
 * The OpenAI recovery call (4 tool steps hit NOVA_TOOL_LOOP_MAX_STEPS=4, then a tool-less "final answer" call) is
 * budgeted like a step. Steps cost 20/20/20/x% of $0.20; the recovery call is projected from step 4's size.
 */
async function runRecovery(step4Fraction) {
  const p = inputTokensForCost(TERRA, 0.2 * LOOP_BUDGET_USD);
  const p4 = inputTokensForCost(TERRA, step4Fraction * LOOP_BUDGET_USD);
  const current = startScenario({
    plan: [STEP_LS, STEP_README, STEP_NOTES, STEP_LS],
    usage: [callUsage(p), callUsage(p), callUsage(p), callUsage(p4), callUsage(p4)],
  });
  const { controller, events } = timelineController({ budget: costBudget(LOOP_BUDGET_USD) });
  const turn = await runTurn({ shape: "openai", id: `recovery-${step4Fraction}`, observer: controller.observe, extra: { taskBudget: controller } });
  return { ...turn, controller, events, timeline: current.timeline };
}

await run("ATB-3r [openai] recovery call degrades: economy model + trimmed tool results, then completes", async () => {
  // 20+20+20+30 = 90% (warning); recovery projected +30% -> degrade to luna (+3%) -> 93%: the answer is produced.
  const { calls, timeline, controller, result } = await runRecovery(0.3);
  assert.deepEqual(timelineShape(timeline), [
    `call:${TERRA}`, `call:${TERRA}`, `call:${TERRA}`, `call:${TERRA}`, "event:warning", "event:degraded", `call:${LUNA}`,
  ]);
  const recovery = calls[4].request;
  assert.equal(Array.isArray(recovery.tools) && recovery.tools.length > 0, false, "call 5 is the tool-less recovery call");
  assert.match(String(recovery.messages.at(-1)?.content || ""), /^Provide the final answer/);
  const tools = toolMessages(recovery);
  assert.equal(tools.length, 4);
  assert.deepEqual(tools.map((m) => isTrimmed(m.content)), [true, true, true, false], "steps 1-3 shortened, step 4 kept");
  assert.equal(controller.getState(), "degraded");
  assert.equal(result?.ok, true);
  assert.match(String(result?.reply || ""), /^Done:/);
});

await run("ATB-3x [openai] recovery call over budget even on the economy model: paused before it is sent", async () => {
  // 20+20+20+39 = 99%; recovery: terra +39% / luna +3.9% both go over -> exhausted, 4 calls only.
  const { calls, timeline, controller, result } = await runRecovery(0.39);
  assert.deepEqual(timelineShape(timeline), [
    `call:${TERRA}`, `call:${TERRA}`, `call:${TERRA}`, `call:${TERRA}`, "event:warning", "event:degraded", "event:exhausted",
  ]);
  assert.equal(calls.length, 4);
  assert.equal(controller.getState(), "exhausted");
  assert.equal(result?.ok, false);
  assert.equal(result?.budgetExhausted?.state, "exhausted", "the recovery path pauses instead of a canned fallback reply");
});

// ── ATB-5: no budget -> the loops are unchanged ──────────────────────────────────────────────────────────────

const requestsOf = (calls) => JSON.stringify(calls.map((c) => ({ model: c.request.model, messages: c.request.messages, tools: c.request.tools ?? null })));

for (const shape of ["openai", "claude"]) {
  await run(`ATB-5 [${shape}] no budget / budget not reached / chat turn with a controller: byte-identical requests`, async () => {
    const plan = [STEP_LS, STEP_README];
    const usage = [callUsage(20_000), callUsage(20_000), callUsage(20_000)];
    // Agent task without any budget plumbing, then with taskBudget: undefined, then with a budget never reached.
    // Each run is its own task / thread, so no run sees another one's history.
    startScenario({ plan, usage });
    const plain = await runTurn({ shape, id: "plain-task" });
    startScenario({ plan, usage });
    const undef = await runTurn({ shape, id: "undefined-budget-task", extra: { taskBudget: undefined } });
    startScenario({ plan, usage });
    const roomy = timelineController({ budget: costBudget(100) });
    const roomyRun = await runTurn({ shape, id: "roomy-budget-task", observer: roomy.controller.observe, extra: { taskBudget: roomy.controller } });
    assert.equal(plain.calls.length, plan.length + 1, `agent-task calls: ${plain.calls.length}`);
    assert.equal(undef.calls.length, plain.calls.length);
    assert.equal(roomyRun.calls.length, plain.calls.length);
    assert.equal(requestsOf(undef.calls), requestsOf(plain.calls), "taskBudget: undefined changed the requests");
    assert.equal(requestsOf(roomyRun.calls), requestsOf(plain.calls), "a budget that is never reached changed the requests");
    assert.deepEqual(roomy.events, []);

    // A chat turn: the controller is ignored even when it would be exhausted at once.
    startScenario({ plan, usage });
    const chat = await runTurn({ shape, source: "hud", id: "plain-chat", prompt: CHAT_TOOL_PROMPT });
    let consulted = 0;
    const spent = createTaskBudgetController({ budget: costBudget(0.01), prior: { spentUsd: 5, spentTokens: 0 } });
    const spy = { ...spent, beforeModelCall: (input) => { consulted += 1; return spent.beforeModelCall(input); } };
    startScenario({ plan, usage });
    const chatWithBudget = await runTurn({ shape, source: "hud", id: "budget-chat", observer: spent.observe, extra: { taskBudget: spy }, prompt: CHAT_TOOL_PROMPT });
    assert.equal(chat.calls.length, plan.length + 1, `chat calls: ${chat.calls.length}`);
    assert.ok(chat.calls.slice(0, plan.length).every((c) => Array.isArray(c.request.tools) && c.request.tools.length > 0),
      "the chat turn did not go through the tool loop");
    assert.equal(chatWithBudget.calls.length, chat.calls.length);
    assert.equal(requestsOf(chatWithBudget.calls), requestsOf(chat.calls), "a chat turn's requests changed with a taskBudget");
    assert.equal(consulted, 0, "the controller was consulted on a chat turn");
    assert.notEqual(chatWithBudget.result?.ok, false);
  });
}

// ── ATB-6: the real agent-task service ───────────────────────────────────────────────────────────────────────

const { store } = loadHudTaskStore(path.join(isolatedDataDir, "hud-task-store"));
const db = getDb();
const SERVICE_USER = "atb-service";
const serviceEvents = [];
const attemptSnapshots = [];
const stopService = startAgentTaskService({
  handleInput: (prompt, opts) => {
    // The fake runtime and a throwaway workspace; everything else is what the service passes.
    attemptSnapshots.push({ taskId: opts.taskId, snapshot: opts.taskBudget?.snapshot?.() ?? null });
    resetFakes();
    return handleInput(prompt, { ...opts, workspaceDir, runtimeSelectionOverride: selection("openai") });
  },
  onBudgetEvent: (event) => {
    serviceEvents.push(event);
    scenario.timeline.push({ kind: "event", reason: event.reason, event });
  },
});

// Cost budgets only: the scenarios are sized in dollars (the default 100,000-token budget would otherwise also
// apply, and an economy model saves no tokens). Saved through the HUD store, read by the runtime service.
assert.equal(store.updateTaskBudgetSettings(SERVICE_USER, { defaultTokenBudget: null }).defaultTokenBudget, null);

const taskRow = (id) => db.prepare(
  `SELECT status, pause_reason, budget_state, error, tokens_in, tokens_out, cost_usd, cost_budget_usd, attempt_no, result_text
   FROM agent_tasks WHERE user_id = ? AND id = ?`,
).get(SERVICE_USER, id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForStatus(id, statuses, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = taskRow(id);
    if (row && statuses.includes(row.status) && row.status !== "running") return row;
    await sleep(20);
  }
  throw new Error(`task ${id} did not reach ${statuses.join("/")} (now ${taskRow(id)?.status})`);
}
const near = (actual, expected, label) => assert.ok(Math.abs(Number(actual) - expected) < 1e-6, `${label}: ${actual} != ${expected}`);

/** Create a task through the HUD store and let the service run it into its budget pause (openai loop scenario). */
async function runTaskIntoBudgetPause(name) {
  const spec = loopScenario("openai");
  const current = startScenario({ plan: spec.plan, usage: spec.usage });
  const before = capture.calls.length;
  const task = await store.createTask(SERVICE_USER, { name, prompt: PROMPT, agent: "openai", model: TERRA, costBudgetUsd: LOOP_BUDGET_USD });
  assert.equal(task.status, "queued");
  const row = await waitForStatus(task.id, ["paused", "failed", "completed", "cancelled"]);
  return { task, row, spec, timeline: current.timeline, calls: capture.calls.slice(before), usage: spec.usage.slice(0, 3) };
}

let pausedTask = null;
await run("ATB-6a service: task pauses at its budget (paused/budget/exhausted, spend recorded, events, no call after)", async () => {
  pausedTask = await runTaskIntoBudgetPause("budget pause");
  const { task, row, spec, timeline, usage } = pausedTask;
  assert.equal(row.status, "paused", `status ${row.status} error=${row.error}`);
  assert.equal(row.pause_reason, "budget");
  assert.equal(row.budget_state, "exhausted");
  assert.match(String(row.error), /^Paused at its budget: \$0\.1940 of \$0\.20\. Resume re-runs the task from the start\.$/);
  assert.equal(row.tokens_in, usage.reduce((n, u) => n + u.inputTokens, 0));
  assert.equal(row.tokens_out, 3 * OUTPUT_TOKENS);
  near(row.cost_usd, 0.97 * LOOP_BUDGET_USD, "cost_usd");
  assert.deepEqual(timelineShape(timeline), [
    `call:${spec.regular}`, `call:${spec.regular}`, "event:warning", "event:degraded", `call:${spec.economy}`, "event:exhausted",
  ]);
  const own = serviceEvents.filter((e) => e.taskId === task.id);
  assert.deepEqual(own.map((e) => e.reason), ["warning", "degraded", "exhausted"]);
  assert.ok(own.every((e) => e.userContextId === SERVICE_USER && e.type === "agent-task-budget"));
  const callsAtPause = capture.calls.length;
  await sleep(300);
  assert.equal(capture.calls.length, callsAtPause, "a model call was made after the pause");
  assert.equal(taskRow(task.id).status, "paused");
  const hudView = await store.getTask(SERVICE_USER, task.id);
  assert.deepEqual([hudView.status, hudView.pauseReason, hudView.budgetState], ["paused", "budget", "exhausted"]);
});

await run("ATB-6b raise budget -> requeued -> re-run from the start with the earlier spend counted -> completes", async () => {
  assert.ok(pausedTask, "needs ATB-6a");
  const { task, row: pausedRow, calls: firstAttemptCalls } = pausedTask;
  // Attempt 2: two tool steps + the answer, $0.0212 per call. The raised budget ($0.30) is only crossed at 80%
  // because the first attempt's $0.194 counts: 0.194 -> 0.2152 -> 0.2364 (78.8%) -> 0.2576 (85.9%, warning).
  const p = inputTokensForCost(TERRA, 0.0212);
  const current = startScenario({ plan: [STEP_LS, STEP_README], usage: [callUsage(p), callUsage(p), callUsage(p)] });
  const before = capture.calls.length;
  const eventsBefore = serviceEvents.length;
  const raised = await store.raiseTaskBudget(SERVICE_USER, task.id, { costBudgetUsd: 0.3 });
  assert.equal(raised.status, "queued");
  assert.equal(raised.costBudgetUsd, 0.3);
  assert.equal(raised.budgetState, "ok", "$0.194 of $0.30 is below 80%");
  const row = await waitForStatus(task.id, ["completed", "paused", "failed", "cancelled"]);
  assert.equal(row.status, "completed", `status ${row.status} error=${row.error}`);
  assert.equal(row.attempt_no, 2);
  assert.match(String(row.result_text), /^Done:/);
  const calls = capture.calls.slice(before);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.request.model === TERRA), "attempt 2 starts on the task's own model again");
  // From the start: the first request of attempt 2 has no tool results and asks the same thing as attempt 1's first.
  assert.equal(toolMessages(calls[0].request).length, 0, "attempt 2 did not start from the start");
  assert.equal(JSON.stringify(calls[0].request.messages.at(-1)), JSON.stringify(firstAttemptCalls[0].request.messages.at(-1)));
  const snapshot = attemptSnapshots.filter((s) => s.taskId === task.id).at(-1)?.snapshot;
  near(snapshot?.spentUsd, pausedRow.cost_usd, "prior spend at attempt start");
  assert.equal(snapshot?.spentTokens, pausedRow.tokens_in + pausedRow.tokens_out);
  assert.equal(snapshot?.costBudgetUsd, 0.3);
  assert.deepEqual(serviceEvents.slice(eventsBefore).map((e) => e.reason), ["warning"], "the earlier spend must count toward the raised budget");
  assert.deepEqual(timelineShape(current.timeline), [`call:${TERRA}`, `call:${TERRA}`, `call:${TERRA}`, "event:warning"]);
  assert.equal(row.tokens_in, pausedRow.tokens_in + 3 * p, "tokens are cumulative across attempts");
  assert.equal(row.tokens_out, pausedRow.tokens_out + 3 * OUTPUT_TOKENS);
  near(row.cost_usd, pausedRow.cost_usd + 3 * 0.0212, "cost is cumulative across attempts");
  assert.equal(row.budget_state, "warning");
});

await run("ATB-6c stop on a budget-paused task -> cancelled, no further calls", async () => {
  const { task, row } = await runTaskIntoBudgetPause("budget abort");
  assert.deepEqual([row.status, row.pause_reason], ["paused", "budget"]);
  const callsAtPause = capture.calls.length;
  const stopped = await store.applyTaskAction(SERVICE_USER, task.id, "stop");
  assert.equal(stopped.status, "cancelled");
  await sleep(300);
  assert.equal(taskRow(task.id).status, "cancelled");
  assert.equal(capture.calls.length, callsAtPause, "a model call was made after stop");
});

await run("ATB-6d play on a budget-paused task with no room left is refused (task stays paused)", async () => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_tasks
       (user_id, id, name, prompt, agent, model, status, priority, permission_mode, progress, tokens_in, tokens_out,
        cost_usd, cost_budget_usd, pause_reason, budget_state, error, paused_at, created_at, updated_at)
     VALUES (?, 'atb-no-room', 'no room', ?, 'openai', ?, 'paused', 'normal', 'default', 40, 50000, 300,
        0.21, 0.2, 'budget', 'exhausted', 'Paused at its budget.', ?, ?, ?)`,
  ).run(SERVICE_USER, PROMPT, TERRA, now, now, now);
  const before = capture.calls.length;
  await assert.rejects(
    store.applyTaskAction(SERVICE_USER, "atb-no-room", "play"),
    (error) => error instanceof store.AgentTaskTransitionError && /already spent its budget/.test(error.message),
  );
  await sleep(150);
  const row = taskRow("atb-no-room");
  assert.deepEqual([row.status, row.pause_reason, row.budget_state], ["paused", "budget", "exhausted"]);
  assert.equal(capture.calls.length, before);
});

stopService();

// ── ATB-7: mutation self-check ───────────────────────────────────────────────────────────────────────────────

await run("ATB-7 self-check: with enforcement removed (no taskBudget in the loop) the ATB-3/4 expectations fail", async () => {
  for (const shape of ["openai", "claude"]) {
    const unenforced = await runBudgetedLoop(shape, { enforce: false });
    assert.throws(() => assertDegradeSequence(shape, unenforced), `the ${shape} expectations passed without enforcement`);
    assert.ok(unenforced.calls.length > 3, `${shape}: an unbudgeted run should make more than 3 calls`);
    assert.ok(unenforced.calls.every((c) => c.request.model !== loopScenario(shape).economy), "no economy model without enforcement");
  }
});

console.log = originalLog;
console.info = originalInfo;
console.warn = originalWarn;
console.error = originalError;

await run("no real network calls were attempted", async () => {
  assert.deepEqual(guard.violations, [], JSON.stringify(guard.violations.slice(0, 5)));
});

for (const r of results) console.log(`[${r.status}] ${r.name}${r.detail ? `\n  ${r.detail}` : ""}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nagent-task-budget: ${results.length - failed} passed, ${failed} failed`);
guard.restore();
process.exit(failed > 0 ? 1 : 0);
