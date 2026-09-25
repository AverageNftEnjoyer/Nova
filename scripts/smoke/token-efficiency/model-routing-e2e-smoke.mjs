/**
 * Tiered model routing, end to end (token-efficiency Stage 6), through the real handleInput.
 *
 * The module-level rules are covered by model-routing-smoke.mjs (MR-1..MR-7), the mission client / nova-suggest
 * routing by llm-usage-coverage-smoke.mjs (M1-M5) and the harness invariants by model-routing-cost.mjs. This smoke
 * checks the runtime wiring: the `model` field each captured request actually carried, and the llm_usage rows
 * (model + tier) the turn ledgered.
 *
 *   MRE-1  output-constraint correction pass ("chat.output-correction", trivial): mode trivial -> OpenAI correction on
 *          the economy model (row tier trivial), the turn's own call on the selected model (tier standard); Claude:
 *          the cache-aware guard decides (model is selected or economy, same provider, row = request model, tier
 *          trivial); mode off -> every request on the selected model and the requests byte-identical to the trivial
 *          run except the correction call's `model` (ISO timestamps masked)
 *   MRE-2  empty-reply recovery ("chat.empty-reply-recovery", OpenAI-compatible only): standard turn in mode trivial
 *          -> recovery on the economy model (tier trivial); a hard turn -> recovery stays on the selected model (hard)
 *   MRE-3  cost-saving mode: an ordinary chat turn routes to the economy model (tier standard; Claude: consistent with
 *          requestHints.modelRouting); a hard turn and an agent task stay on the selected model (tier hard); every
 *          step of a tool loop uses the same model
 *   MRE-4  fallback: the provider refuses the economy model (OpenAI: 404 "does not exist"; Claude: HTTP 404 with the
 *          Anthropic not_found_error body) -> the turn is answered by the selected model, reason
 *          "economy-model-refused", and no ledger row names the refused model
 *   MRE-5  Spotify intent parse ("spotify.intent-parse", trivial) through the real Spotify worker (fake HUD playback
 *          endpoint behind the network guard): mode trivial -> economy model, tier trivial; mode off -> selected model
 *   MRE-6  the provider never changes: OpenAI-shape requests only reach the fake OpenAI client, Claude-shape requests
 *          only the fake Anthropic endpoint, and no request names another provider's model
 *
 * Offline: temp NOVA_DATA_DIR, fake providers behind a network guard (any real network call fails the run), no API
 * keys. Needs `npm run build:agent-core`.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Read by the runtime: set before any runtime import (all runtime imports below are dynamic).
process.env.NOVA_EMBEDDING_PROVIDER = "local";
const FAKE_HUD_BASE_URL = "https://fake-hud.invalid";
process.env.NOVA_HUD_API_BASE_URL = FAKE_HUD_BASE_URL;

const { isolatedDataDir } = await import("../lib/isolated-data-dir.mjs");
const {
  FAKE_CLAUDE_BASE_URL,
  FAKE_OPENAI_BASE_URL,
  createCapture,
  createFakeClaudeHandler,
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

const TERRA = "gpt-5.6-terra";
const LUNA = "gpt-5.6-luna";
const SONNET = "claude-sonnet-5";
const HAIKU = "claude-haiku-4-5-20251001";
const SELECTED = { openai: TERRA, claude: SONNET };
const ECONOMY = { openai: LUNA, claude: HAIKU };
const SHAPES = ["openai", "claude"];

const ORDINARY_PROMPT = "Tell me a fun fact about otters.";
const HARD_PROMPT = "Explain step by step how sea otters stay warm in cold water.";
// "answer in one word" is a strict output requirement (quality/output-constraints); the fake's first reply breaks it.
const STRICT_PROMPT = "Answer in one word: which animal holds hands while sleeping?";
const TOOL_PROMPT = "Run ls in my workspace and tell me what you see.";
const TASK_PROMPT = "Review the project in this workspace: look at the layout, go through the README and produce a short report of what it does.";
const SPOTIFY_PROMPT = "play Bohemian Rhapsody on Spotify";
const LONG_REPLY = "Sea otters hold hands while they sleep so they do not drift apart from each other.";
const CORRECTION_PREFIX = "Rewrite your previous answer to the same user request.";
const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────────────────

const capture = createCapture();
/**
 * The running scenario:
 *   refuse       model id the fake provider refuses (404) -- the economy model in MRE-4
 *   emptyFirst   the first call of the turn returns empty text with finish_reason "length" (MRE-2)
 *   plan         tool steps answered to tool-bearing requests, in order
 */
let scenario = { refuse: "", emptyFirst: false, plan: [], planIndex: 0, callIndex: 0 };
function startScenario(label, shape, options = {}) {
  capture.current = { scenario: label, shape };
  scenario = { refuse: "", emptyFirst: false, plan: [], ...options, planIndex: 0, callIndex: 0 };
}

function systemTextOf(request, shape) {
  if (shape === "claude") return JSON.stringify(request?.system ?? "");
  const first = (request?.messages || []).find((m) => m?.role === "system");
  return String(first?.content || "");
}

async function responder(request, shape) {
  const index = scenario.callIndex;
  scenario.callIndex += 1;
  const d = describeRequest(request);
  if (systemTextOf(request, shape).includes("Spotify command parser")) {
    return { text: JSON.stringify({ action: "play", query: "Bohemian Rhapsody", type: "track", response: "On it." }) };
  }
  if (d.lastUserText.startsWith(CORRECTION_PREFIX)) return { text: "Otters" };
  if (d.hasTools && scenario.planIndex < scenario.plan.length) {
    const step = scenario.plan[scenario.planIndex];
    scenario.planIndex += 1;
    return { toolCalls: step };
  }
  if (scenario.emptyFirst && index === 0) return { text: "", finishReason: "length" };
  return { text: LONG_REPLY };
}

function approxTokens(value) {
  return Math.ceil(JSON.stringify(value ?? "").length / 3.5);
}

/** A fake OpenAI-compatible client (streaming and not) that can also end empty with "length" or refuse a model. */
function createOpenAiFake() {
  let callNo = 0;
  return {
    chat: {
      completions: {
        create: async (request) => {
          const copy = capture.push("openai", request, { stream: request?.stream === true });
          callNo += 1;
          if (scenario.refuse && copy.model === scenario.refuse) {
            const error = new Error(`The model \`${copy.model}\` does not exist or you do not have access to it.`);
            error.status = 404;
            error.code = "model_not_found";
            error.type = "invalid_request_error";
            throw error;
          }
          const answer = await responder(copy, "openai");
          const text = String(answer.text || "");
          const toolCalls = (answer.toolCalls || []).map((call, i) => ({
            id: `call_${callNo}_${i + 1}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
          }));
          const finishReason = answer.finishReason || (toolCalls.length > 0 ? "tool_calls" : "stop");
          const usage = {
            prompt_tokens: approxTokens(copy.messages) + approxTokens(copy.tools || []),
            completion_tokens: Math.max(1, approxTokens(text || toolCalls)),
            prompt_tokens_details: { cached_tokens: 0 },
          };
          usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          if (request?.stream === true) {
            return (async function* stream() {
              if (text) {
                const mid = Math.ceil(text.length / 2);
                yield { choices: [{ index: 0, delta: { role: "assistant", content: text.slice(0, mid) } }] };
                yield { choices: [{ index: 0, delta: { content: text.slice(mid) } }] };
              }
              yield { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] };
              yield { choices: [], usage };
            })();
          }
          return {
            id: `chatcmpl-fake-${callNo}`,
            object: "chat.completion",
            model: String(copy.model || ""),
            choices: [{
              index: 0,
              finish_reason: finishReason,
              message: { role: "assistant", content: toolCalls.length > 0 ? null : text, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) },
            }],
            usage,
          };
        },
      },
    },
  };
}

let openAiFake = createOpenAiFake();
let claudeFake = createFakeClaudeHandler({ capture, responder });
/** Fresh fakes per turn keep the tool-call ids (call_<n>_1, toolu_<n>_1) comparable between runs. */
function resetFakes() {
  openAiFake = createOpenAiFake();
  claudeFake = createFakeClaudeHandler({ capture, responder });
}

// Anthropic's error body for a model the key can't use (HTTP 404, type not_found_error).
async function claudeEndpoint(url, init = {}) {
  const body = JSON.parse(String(init.body || "{}"));
  if (scenario.refuse && body.model === scenario.refuse) {
    capture.push("claude", body, { stream: body.stream === true, refused: true });
    return new Response(
      JSON.stringify({ type: "error", error: { type: "not_found_error", message: `model: ${body.model}` } }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  }
  return claudeFake(url, init);
}

const hudCalls = [];
async function hudEndpoint(url, init = {}) {
  hudCalls.push({ url, body: String(init.body || "") });
  return new Response(JSON.stringify({ ok: true, message: "Playing Bohemian Rhapsody." }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const guard = installNetworkGuard({
  [`${FAKE_CLAUDE_BASE_URL}/v1/messages`]: claudeEndpoint,
  [`${FAKE_HUD_BASE_URL}/`]: hudEndpoint,
});

const { handleInput } = await srcModule("src/runtime/modules/chat/core/chat-handler/index.js");
const { listLlmUsage } = await srcModule("src/db/llm-usage.js");
const { writeModelRoutingSettings } = await srcModule("src/runtime/modules/model-routing/index.js");
const pricing = await srcModule("src/providers/pricing/index.js");

function selection(shape, model = SELECTED[shape]) {
  if (shape === "claude") {
    return {
      activeChatRuntime: { provider: "claude", connected: true, apiKey: "fake-claude-key", baseURL: FAKE_CLAUDE_BASE_URL, model },
      activeOpenAiCompatibleClient: null,
      selectedChatModel: model,
    };
  }
  return {
    activeChatRuntime: { provider: "openai", connected: true, apiKey: "fake-openai-key", baseURL: FAKE_OPENAI_BASE_URL, model },
    activeOpenAiCompatibleClient: openAiFake,
    selectedChatModel: model,
  };
}

const workspaceDir = path.join(isolatedDataDir, "model-routing-e2e", "workspace");
fs.mkdirSync(path.join(workspaceDir, "src"), { recursive: true });
fs.writeFileSync(path.join(workspaceDir, "README.md"), "# Demo\n\nA tiny service that answers health checks.\n", "utf8");
fs.writeFileSync(path.join(workspaceDir, "src", "server.js"), "console.log('hi');\n", "utf8");
const STEPS = [[{ name: "ls", input: { path: "." } }], [{ name: "read", input: { path: "README.md" } }]];

const rowIdsSeen = new Map();
/** Ledger rows of `userId` written since the last call for that user, oldest first. */
function takeNewRows(userId) {
  const seen = rowIdsSeen.get(userId) || new Set();
  const rows = listLlmUsage(userId, { limit: 500 }).filter((row) => !seen.has(row.id)).reverse();
  for (const row of rows) seen.add(row.id);
  rowIdsSeen.set(userId, seen);
  return rows;
}

/**
 * One turn through the real handleInput for `userId` in routing mode `mode`. Returns the captured requests of the
 * turn, the new ledger rows and the run summary.
 */
async function runTurn({ shape, userId, mode, prompt, conversationId, label, agentTask = false, scenarioOptions = {}, selectedModel }) {
  writeModelRoutingSettings(userId, { mode });
  startScenario(`${shape}:${label}`, shape, scenarioOptions);
  resetFakes();
  takeNewRows(userId);
  const before = capture.calls.length;
  const opts = agentTask
    ? {
        voice: false,
        source: "agent-task",
        sender: "agent-task",
        userContextId: userId,
        conversationId: `agent-task-${conversationId}`,
        sessionKeyHint: `agent-task:${userId}:${conversationId}`,
        preferredProvider: shape,
        autonomousTask: true,
        permissionMode: "default",
        approvedTools: [],
        taskId: conversationId,
        workspaceDir,
        worktreePath: "",
        executionFenceCheck: () => {},
        consumeTaskApproval: () => {},
        reserveTaskEffect: () => {},
      }
    : {
        voice: false,
        source: "hud",
        sender: "hud-user",
        userContextId: userId,
        conversationId,
        sessionKeyHint: `agent:nova:hud:user:${userId}:dm:${conversationId}`,
      };
  const result = await handleInput(prompt, { ...opts, runtimeSelectionOverride: selection(shape, selectedModel) });
  const calls = capture.calls.slice(before);
  return { result, calls, rows: takeNewRows(userId), hint: result?.requestHints?.modelRouting || null };
}

const modelsOf = (calls) => calls.map((c) => c.request.model);
// Rows are compared as sorted "model/tier" lists: listLlmUsage orders by ts, and calls of one turn can share a ts.
const rowPairs = (rows) => rows.map((r) => `${r.model}/${r.tier}`).sort();
const sortedPairs = (...pairs) => pairs.sort();
const isCorrectionCall = (call) => describeRequest(call.request).lastUserText.startsWith(CORRECTION_PREFIX);
const maskTimestamps = (request) => JSON.stringify(request).replace(ISO_TS, "<ts>");

// Silence runtime chatter (restored before the report).
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;
const warnings = [];
/** Decisions of the Claude cache-aware guard, printed with the report (they depend on the prompt sizes). */
const notes = [];
console.log = () => {};
console.info = () => {};
console.warn = (...args) => warnings.push(args.map(String).join(" "));
console.error = () => {};

// ── MRE-1: output-constraint correction pass ─────────────────────────────────────────────────────────────────

for (const shape of SHAPES) {
  await run(`MRE-1 [${shape}] correction pass: trivial routes it (cache-aware for Claude), off keeps every request identical but its model`, async () => {
    const userId = `mre1-${shape}`;
    // Same user, same-length conversation ids, so the two runs build the same prompt (history is per conversation).
    const trivial = await runTurn({ shape, userId, mode: "trivial", prompt: STRICT_PROMPT, conversationId: "mre1-conv-a", label: "mre1-trivial" });
    const off = await runTurn({ shape, userId, mode: "off", prompt: STRICT_PROMPT, conversationId: "mre1-conv-b", label: "mre1-off" });

    for (const [name, turn] of [["trivial", trivial], ["off", off]]) {
      assert.equal(turn.calls.length, 2, `${name}: expected turn call + correction call, got ${modelsOf(turn.calls)}`);
      assert.ok(!isCorrectionCall(turn.calls[0]) && isCorrectionCall(turn.calls[1]), `${name}: call order`);
      assert.equal(turn.calls[0].request.model, SELECTED[shape], `${name}: the turn's own call left the selected model`);
      assert.equal(turn.rows.length, 2, `${name}: rows ${rowPairs(turn.rows)}`);
      // The turn call on the selected model (standard), the correction call on the model it was sent to (trivial).
      assert.deepEqual(rowPairs(turn.rows), sortedPairs(`${SELECTED[shape]}/standard`, `${turn.calls[1].request.model}/trivial`), `${name}: rows`);
      assert.equal(String(turn.result?.reply || "").trim(), "Otters", `${name}: corrected reply ${turn.result?.reply}`);
    }

    const correctionModel = trivial.calls[1].request.model;
    if (shape === "openai") {
      assert.equal(correctionModel, LUNA, "mode trivial: the OpenAI correction pass should use the economy model");
    } else {
      assert.ok([SONNET, HAIKU].includes(correctionModel), `Claude correction model ${correctionModel}`);
      notes.push(`MRE-1 claude: correction pass in mode trivial sent ${correctionModel}`);
    }
    assert.equal(trivial.hint?.mode, "trivial");
    assert.equal(off.hint?.mode, "off");
    assert.equal(off.calls[1].request.model, SELECTED[shape], "mode off: the correction pass must stay on the selected model");

    // Byte-identical apart from the correction call's model (and the per-run identity timestamps).
    const comparable = (turn, i) => {
      const request = { ...turn.calls[i].request };
      if (i === 1) request.model = "<correction-model>";
      return maskTimestamps(request).replaceAll("mre1-conv-a", "<conv>").replaceAll("mre1-conv-b", "<conv>");
    };
    for (const i of [0, 1]) {
      assert.equal(comparable(trivial, i), comparable(off, i), `call ${i + 1} differs between mode trivial and mode off`);
    }
  });
}

// ── MRE-2: empty-reply recovery (OpenAI-compatible only) ──────────────────────────────────────────────────────

await run("MRE-2 [openai] empty-reply recovery: economy model in a standard turn, selected model in a hard turn", async () => {
  const userId = "mre2-openai";
  const standard = await runTurn({ shape: "openai", userId, mode: "trivial", prompt: ORDINARY_PROMPT, conversationId: "mre2-std", label: "mre2-standard", scenarioOptions: { emptyFirst: true } });
  assert.equal(standard.hint?.turnTier, "standard");
  assert.deepEqual(modelsOf(standard.calls), [TERRA, LUNA], "standard turn: turn call on terra, recovery on luna");
  assert.equal(standard.calls[0].stream, true, "the turn's call is the streamed reply");
  assert.deepEqual(rowPairs(standard.rows), sortedPairs(`${TERRA}/standard`, `${LUNA}/trivial`));
  assert.equal(String(standard.result?.reply || ""), LONG_REPLY, "the recovery answered the turn");

  const hard = await runTurn({ shape: "openai", userId, mode: "trivial", prompt: HARD_PROMPT, conversationId: "mre2-hard", label: "mre2-hard", scenarioOptions: { emptyFirst: true } });
  assert.equal(hard.hint?.turnTier, "hard", `turn tier ${hard.hint?.turnTier} (${hard.hint?.turnReason})`);
  assert.deepEqual(modelsOf(hard.calls), [TERRA, TERRA], "hard turn: the recovery stays on the selected model");
  assert.deepEqual(rowPairs(hard.rows), [`${TERRA}/hard`, `${TERRA}/hard`]);
  assert.equal(String(hard.result?.reply || ""), LONG_REPLY);
});

// ── MRE-3: cost-saving mode ──────────────────────────────────────────────────────────────────────────────────

for (const shape of SHAPES) {
  await run(`MRE-3a [${shape}] cost-saving: an ordinary chat turn uses the economy model (standard tier)`, async () => {
    const userId = `mre3-${shape}`;
    const turn = await runTurn({ shape, userId, mode: "cost-saving", prompt: ORDINARY_PROMPT, conversationId: "mre3-chat", label: "mre3-chat" });
    assert.equal(turn.calls.length, 1, `calls ${modelsOf(turn.calls)}`);
    assert.equal(turn.hint?.mode, "cost-saving");
    assert.equal(turn.hint?.turnTier, "standard", `${turn.hint?.turnTier} (${turn.hint?.turnReason})`);
    const sent = turn.calls[0].request.model;
    if (shape === "openai") {
      assert.equal(sent, LUNA, "OpenAI standard turn in cost-saving should use the economy model");
    } else {
      assert.ok([SONNET, HAIKU].includes(sent), `Claude model ${sent}`);
      notes.push(`MRE-3a claude: cost-saving chat turn sent ${sent} (${turn.hint?.reason})`);
    }
    assert.equal(turn.hint?.model, sent, "requestHints.modelRouting.model != the model sent");
    assert.equal(turn.hint?.routed, sent === ECONOMY[shape], `routed=${turn.hint?.routed} but sent ${sent} (${turn.hint?.reason})`);
    assert.equal(turn.hint?.reason, turn.hint?.routed ? "routed" : "cache-makes-selected-cheaper", `reason ${turn.hint?.reason}`);
    assert.deepEqual(rowPairs(turn.rows), [`${sent}/standard`]);
  });

  await run(`MRE-3b [${shape}] cost-saving: a hard turn and an agent task stay on the selected model (tier hard)`, async () => {
    const userId = `mre3-${shape}`;
    const hard = await runTurn({ shape, userId, mode: "cost-saving", prompt: HARD_PROMPT, conversationId: "mre3-hard", label: "mre3-hard" });
    assert.equal(hard.hint?.turnTier, "hard");
    assert.equal(hard.hint?.reason, "hard-never-routed");
    assert.ok(hard.calls.length >= 1);
    assert.deepEqual([...new Set(modelsOf(hard.calls))], [SELECTED[shape]], `hard turn models ${modelsOf(hard.calls)}`);
    assert.ok(hard.rows.length === hard.calls.length && hard.rows.every((r) => r.model === SELECTED[shape] && r.tier === "hard"), `rows ${rowPairs(hard.rows)}`);

    const task = await runTurn({ shape, userId, mode: "cost-saving", prompt: TASK_PROMPT, conversationId: `mre3-task-${shape}`, label: "mre3-task", agentTask: true, scenarioOptions: { plan: STEPS } });
    assert.equal(task.hint?.turnTier, "hard");
    assert.equal(task.hint?.turnReason, "agent-task");
    const toolSteps = task.calls.filter((c) => Array.isArray(c.request.tools) && c.request.tools.length > 0);
    assert.equal(toolSteps.length, STEPS.length + 1, `agent task tool steps ${toolSteps.length}`);
    assert.deepEqual([...new Set(modelsOf(task.calls))], [SELECTED[shape]], `agent task models ${modelsOf(task.calls)}`);
    assert.ok(task.rows.length === task.calls.length && task.rows.every((r) => r.model === SELECTED[shape] && r.tier === "hard"), `rows ${rowPairs(task.rows)}`);
  });

  await run(`MRE-3c [${shape}] cost-saving: every step of a chat tool loop uses the same model`, async () => {
    const userId = `mre3-${shape}`;
    const loop = await runTurn({ shape, userId, mode: "cost-saving", prompt: TOOL_PROMPT, conversationId: "mre3-loop", label: "mre3-loop", scenarioOptions: { plan: STEPS } });
    const toolSteps = loop.calls.filter((c) => Array.isArray(c.request.tools) && c.request.tools.length > 0);
    assert.equal(toolSteps.length, STEPS.length + 1, `tool steps ${toolSteps.length} (route ${loop.result?.responseRoute})`);
    const models = new Set(modelsOf(loop.calls));
    assert.equal(models.size, 1, `the loop switched model: ${modelsOf(loop.calls)}`);
    assert.deepEqual([...models], [loop.hint?.model], "the loop's model is the turn's routed model");
    // A chat tool loop without an operator lane is "ambiguous-tool-routing": hard, so never routed.
    assert.deepEqual([loop.hint?.turnTier, loop.hint?.turnReason], ["hard", "ambiguous-tool-routing"]);
    assert.ok(loop.rows.length === loop.calls.length && loop.rows.every((r) => r.model === loop.hint.model && r.tier === "hard"), `rows ${rowPairs(loop.rows)}`);
  });
}

// ── MRE-4: fallback when the economy model is refused ────────────────────────────────────────────────────────

await run("MRE-4 [openai] cost-saving: refused economy model (404) -> turn answered by the selected model", async () => {
  const userId = "mre4-openai";
  const turn = await runTurn({ shape: "openai", userId, mode: "cost-saving", prompt: ORDINARY_PROMPT, conversationId: "mre4-chat", label: "mre4-openai", scenarioOptions: { refuse: LUNA } });
  // streamOpenAiChatCompletion retries a failed stream request once without stream_options (pre-existing), so the
  // refused model may be tried twice before the turn falls back; after that, exactly one call on the selected model.
  const models = modelsOf(turn.calls);
  const refusedAttempts = models.filter((m) => m === LUNA).length;
  assert.ok(refusedAttempts >= 1 && refusedAttempts <= 2, `refused attempts ${models}`);
  assert.deepEqual(models.slice(refusedAttempts), [TERRA], `after the refusal: ${models}`);
  assert.equal(turn.result?.ok, true, `turn failed: ${turn.result?.error}`);
  assert.equal(String(turn.result?.reply || ""), LONG_REPLY);
  assert.equal(turn.hint?.reason, "economy-model-refused");
  assert.equal(turn.hint?.model, TERRA);
  assert.equal(turn.hint?.routed, true, "the turn was routed before the refusal");
  assert.deepEqual(rowPairs(turn.rows), [`${TERRA}/standard`]);
  assert.ok(!turn.rows.some((r) => r.model === LUNA), "a ledger row names the refused model");
});

// Claude: the cost-saving chat turn is routed only when the cache-aware estimate says so. On claude-sonnet-5 that
// depends on the prompt size, so the turn uses claude-fable-5-1 (10x Haiku's input rate), which the estimate routes.
const CLAUDE_FALLBACK_SELECTED = "claude-fable-5-1";

await run("MRE-4 [claude] cost-saving turn: refused economy model (HTTP 404 not_found_error) -> answered by the selected model", async () => {
  const userId = "mre4-claude";
  const turn = await runTurn({ shape: "claude", userId, mode: "cost-saving", prompt: ORDINARY_PROMPT, conversationId: "mre4-chat", label: "mre4-claude", selectedModel: CLAUDE_FALLBACK_SELECTED, scenarioOptions: { refuse: HAIKU } });
  notes.push(`MRE-4 claude: turn calls ${modelsOf(turn.calls).join(" -> ")}, reason ${turn.hint?.reason}, ok ${turn.result?.ok}`);
  assert.equal(turn.calls[0]?.request.model, HAIKU, `the turn was not routed (${turn.hint?.reason}); the check needs a routed turn`);
  assert.deepEqual(modelsOf(turn.calls), [HAIKU, CLAUDE_FALLBACK_SELECTED], `turn calls ${modelsOf(turn.calls)}`);
  assert.equal(turn.result?.ok, true, `turn failed: ${turn.result?.error}`);
  assert.equal(String(turn.result?.reply || ""), LONG_REPLY);
  assert.equal(turn.hint?.reason, "economy-model-refused");
  assert.equal(turn.hint?.model, CLAUDE_FALLBACK_SELECTED);
  assert.deepEqual(rowPairs(turn.rows), [`${CLAUDE_FALLBACK_SELECTED}/standard`]);
  assert.ok(!turn.rows.some((r) => r.model === HAIKU), "a ledger row names the refused model");
});

await run("MRE-4 [claude] Spotify intent parse (always routed in mode trivial): refused economy model -> retried on the selected model", async () => {
  const userId = "mre4-claude-spotify";
  hudCalls.length = 0;
  const parse = await runTurn({ shape: "claude", userId, mode: "trivial", prompt: SPOTIFY_PROMPT, conversationId: "mre4-spotify", label: "mre4-claude-spotify", scenarioOptions: { refuse: HAIKU } });
  assert.equal(String(parse.result?.route || ""), "spotify");
  assert.deepEqual(modelsOf(parse.calls), [HAIKU, SONNET], `spotify parse calls ${modelsOf(parse.calls)}`);
  assert.deepEqual(rowPairs(parse.rows), [`${SONNET}/trivial`]);
  assert.ok(!parse.rows.some((r) => r.model === HAIKU), "a ledger row names the refused model");
});

// ── MRE-5: Spotify intent parse ──────────────────────────────────────────────────────────────────────────────

for (const shape of SHAPES) {
  await run(`MRE-5 [${shape}] Spotify intent parse: economy model in mode trivial, selected model in mode off`, async () => {
    const userId = `mre5-${shape}`;
    for (const [mode, expected] of [["trivial", ECONOMY[shape]], ["off", SELECTED[shape]]]) {
      hudCalls.length = 0;
      const turn = await runTurn({ shape, userId, mode, prompt: SPOTIFY_PROMPT, conversationId: `mre5-${mode}`, label: `mre5-${mode}` });
      assert.equal(String(turn.result?.route || ""), "spotify", `${mode}: route ${turn.result?.route}`);
      assert.equal(turn.calls.length, 1, `${mode}: calls ${modelsOf(turn.calls)}`);
      assert.ok(systemTextOf(turn.calls[0].request, shape).includes("Spotify command parser"), `${mode}: not the parse call`);
      assert.equal(turn.calls[0].request.model, expected, `${mode}: parse model`);
      assert.deepEqual(rowPairs(turn.rows), [`${expected}/trivial`], `${mode}: rows`);
      // The parsed intent reached the (fake) HUD playback endpoint.
      assert.equal(hudCalls.length, 1, `${mode}: HUD playback calls ${hudCalls.length}`);
      assert.match(hudCalls[0].body, /"query":"Bohemian Rhapsody"/);
    }
  });
}

// ── MRE-6: provider never changes ────────────────────────────────────────────────────────────────────────────

console.log = originalLog;
console.info = originalInfo;
console.warn = originalWarn;
console.error = originalError;

await run("MRE-6 provider never changes: each shape's requests reach only its own fake, with its own models", async () => {
  const openAiModels = new Set(Object.keys(pricing.OPENAI_MODEL_PRICING_USD_PER_1M));
  const claudeModels = new Set(Object.keys(pricing.CLAUDE_MODEL_PRICING_USD_PER_1M));
  assert.ok(capture.calls.length > 20, `only ${capture.calls.length} captured calls`);
  const byShape = { openai: 0, claude: 0 };
  for (const call of capture.calls) {
    const label = `${call.scenario} (${call.shape} request, ${call.request.model})`;
    assert.ok(call.scenario.startsWith(`${call.shape}:`), `${label}: request reached the other provider's fake`);
    byShape[call.shape] += 1;
    if (call.shape === "openai") {
      assert.ok(openAiModels.has(call.request.model), `${label}: not an OpenAI model`);
    } else {
      assert.ok(claudeModels.has(call.request.model), `${label}: not a Claude model`);
    }
  }
  assert.ok(byShape.openai > 0 && byShape.claude > 0, JSON.stringify(byShape));
});

await run("no real network calls were attempted", async () => {
  assert.deepEqual(guard.violations, [], JSON.stringify(guard.violations.slice(0, 5)));
});

for (const r of results) console.log(`[${r.status}] ${r.name}${r.detail ? `\n  ${r.detail}` : ""}`);
for (const note of notes) console.log(`  note: ${note}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nmodel-routing-e2e: ${results.length - failed} passed, ${failed} failed`);
guard.restore();
process.exit(failed > 0 ? 1 : 0);
