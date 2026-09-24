/**
 * Model tool scoping smoke (token-efficiency Stage 3).
 *
 * The model is only offered coinbase_* / gmail_* / phantom_* tools when that integration is connected for the
 * user (src/runtime/modules/chat/core/chat-handler/model-tool-scope). This smoke checks:
 *   MTS-1  the connected-state test per integration (snapshot matrix, missing snapshot, missing user, read error)
 *   MTS-2  selectModelTools keeps order, keeps every other tool, never mutates the input
 *   MTS-3  (a)+(c) a user with nothing connected: no integration tool reaches the model (OpenAI and Claude tool
 *          loops), and the offered list is byte-identical on every call of a loop and across two turns
 *   MTS-4  (b) connecting Gmail and Coinbase mid-session makes their tools appear on the next turn (registry order,
 *          same list as the full registry); disconnecting removes them again
 *   MTS-5  (d) the domain workers still see the full tool list: for an unconnected user the Gmail status lane
 *          still answers from the gmail_capabilities result ("Gmail status: not connected") (not "tool not enabled"), and the
 *          Coinbase provider adapter still reaches the Coinbase tool (DISCONNECTED, not TOOL_NOT_ENABLED)
 *   MTS-6  scoping that leaves no tool at all falls back to a direct answer instead of an empty tool list
 *
 * Offline: temp NOVA_DATA_DIR, fake providers behind a network guard (any real network call fails the run), no
 * API keys (the seeded snapshots hold placeholder strings, never real secrets). Needs `npm run build:agent-core`.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.NOVA_EMBEDDING_PROVIDER = "local";

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";
import { clearRuntimeIntegrations, seedRuntimeIntegrations } from "../lib/seed-runtime-integrations.mjs";
import {
  FAKE_CLAUDE_BASE_URL,
  FAKE_OPENAI_BASE_URL,
  createCapture,
  createFakeClaudeHandler,
  createFakeOpenAiClient,
  describeRequest,
  installNetworkGuard,
} from "./token-harness-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────────────────────

const capture = createCapture();
let plan = [];
let planIndex = 0;
async function responder(request) {
  const d = describeRequest(request);
  if (d.hasTools && planIndex < plan.length) {
    const step = plan[planIndex];
    planIndex += 1;
    return { toolCalls: step };
  }
  return { text: "Done: the workspace has a README and a server entry point." };
}
const fakeOpenAiClient = createFakeOpenAiClient({ capture, responder });
const guard = installNetworkGuard({ [`${FAKE_CLAUDE_BASE_URL}/v1/messages`]: createFakeClaudeHandler({ capture, responder }) });

const { handleInput } = await import(pathToFileURL(path.join(repoRoot, "src/runtime/modules/chat/core/chat-handler/index.js")).href);
const { toolRuntime } = await import(pathToFileURL(path.join(repoRoot, "src/runtime/modules/infrastructure/config/index.js")).href);
const scope = await import(pathToFileURL(path.join(repoRoot, "src/runtime/modules/chat/core/chat-handler/model-tool-scope/index.js")).href);
const { executeCoinbaseProviderTool } = await import(pathToFileURL(path.join(repoRoot, "src/runtime/modules/services/coinbase/provider-adapter/index.js")).href);

function selection(shape) {
  if (shape === "claude") {
    return {
      activeChatRuntime: { provider: "claude", connected: true, apiKey: "fake-claude-key", baseURL: FAKE_CLAUDE_BASE_URL, model: "claude-sonnet-5" },
      activeOpenAiCompatibleClient: null,
      selectedChatModel: "claude-sonnet-5",
    };
  }
  return {
    activeChatRuntime: { provider: "openai", connected: true, apiKey: "fake-openai-key", baseURL: FAKE_OPENAI_BASE_URL, model: "gpt-5.6-terra" },
    activeOpenAiCompatibleClient: fakeOpenAiClient,
    selectedChatModel: "gpt-5.6-terra",
  };
}

function createWorkspace(name) {
  const dir = path.join(isolatedDataDir, "model-tool-scope", name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo\n\nA tiny service.\n", "utf8");
  fs.writeFileSync(path.join(dir, "src", "server.js"), "console.log('hi');\n", "utf8");
  return dir;
}

async function runTask({ shape, userContextId, workspaceDir, taskId, steps }) {
  plan = steps;
  planIndex = 0;
  const before = capture.calls.length;
  // Same kind of prompt as the token-baseline agent-task scenario (a plain "list the files" would go to the files lane).
  const result = await handleInput("Review the project in this workspace: look at the layout, go through the README and produce a short report of what it does.", {
    voice: false,
    source: "agent-task",
    sender: "agent-task",
    userContextId,
    conversationId: `agent-task-${taskId}`,
    sessionKeyHint: `agent-task:${userContextId}:${taskId}`,
    preferredProvider: shape,
    autonomousTask: true,
    permissionMode: "default",
    approvedTools: [],
    taskId,
    workspaceDir,
    worktreePath: "",
    executionFenceCheck: () => {},
    consumeTaskApproval: () => {},
    reserveTaskEffect: () => {},
    runtimeSelectionOverride: selection(shape),
  });
  const calls = capture.calls.slice(before);
  const toolCalls = calls.filter((c) => Array.isArray(c.request.tools) && c.request.tools.length > 0);
  return { result, calls, toolCalls };
}

const toolName = (t) => String(t?.function?.name || t?.name || "");
const namesOf = (call) => call.request.tools.map(toolName);
const isIntegrationTool = (name) => /^(coinbase_|gmail_|phantom_)/.test(name);

const GMAIL_CONNECTED = {
  connected: true,
  email: "smoke@example.test",
  activeAccountId: "acct-1",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  accounts: [{ id: "acct-1", email: "smoke@example.test", enabled: true, scopes: ["https://www.googleapis.com/auth/gmail.readonly"] }],
};
// Placeholder strings: the scoping test only checks that a key pair is stored, it never decrypts it.
const COINBASE_CONNECTED = { connected: true, apiKey: "placeholder-key-ciphertext", apiSecret: "placeholder-secret-ciphertext" };

// Silence runtime chatter.
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
console.log = () => {};
console.info = () => {};
console.warn = () => {};

// ── MTS-1 / MTS-2: pure scoping ──────────────────────────────────────────────────────────────────────────────

await run("MTS-1 connected-state test per integration", async () => {
  const connectedFor = (snapshot) => [...scope.resolveConnectedToolIntegrations("u", { readSnapshot: () => snapshot })].sort();
  assert.deepEqual(connectedFor(null), []);
  assert.deepEqual(connectedFor({}), []);
  assert.deepEqual(connectedFor({ gmail: { connected: false }, coinbase: { connected: false, apiKey: "k", apiSecret: "s" } }), []);
  assert.deepEqual(connectedFor({ coinbase: { connected: true, apiKey: "k", apiSecret: "" } }), [], "coinbase without a stored secret");
  assert.deepEqual(connectedFor({ coinbase: { connected: true, apiKey: "k", apiSecret: "s" } }), ["coinbase"]);
  assert.deepEqual(connectedFor({ gmail: { connected: true }, phantom: { connected: true } }), ["gmail", "phantom"]);
  assert.deepEqual([...scope.resolveConnectedToolIntegrations("u", { readSnapshot: () => { throw new Error("db down"); } })], []);
  // The real reader: no user, no row, then a seeded row.
  assert.deepEqual([...scope.resolveConnectedToolIntegrations("")], []);
  assert.deepEqual([...scope.resolveConnectedToolIntegrations("mts-reader")], []);
  seedRuntimeIntegrations("mts-reader", { gmail: GMAIL_CONNECTED, coinbase: { connected: true, apiKey: "", apiSecret: "" } });
  assert.deepEqual([...scope.resolveConnectedToolIntegrations("MTS-Reader")], ["gmail"], "user id is normalised like the rest of the runtime");
});

await run("MTS-2 selectModelTools keeps order and non-integration tools, never mutates", async () => {
  const tools = ["read", "coinbase_spot_price", "web_search", "gmail_list_messages", "phantom_capabilities", "exec"].map((name) => ({ name }));
  const snapshot = JSON.stringify(tools);
  assert.deepEqual(scope.selectModelTools(tools, new Set()).map((t) => t.name), ["read", "web_search", "exec"]);
  assert.deepEqual(scope.selectModelTools(tools, new Set(["gmail"])).map((t) => t.name), ["read", "web_search", "gmail_list_messages", "exec"]);
  assert.deepEqual(scope.selectModelTools(tools, new Set(["coinbase", "gmail", "phantom"])).map((t) => t.name), tools.map((t) => t.name));
  assert.equal(JSON.stringify(tools), snapshot, "input array was mutated");
  assert.equal(scope.selectModelTools(tools, new Set())[0], tools[0], "tool objects are passed through, not copied");
});

// ── MTS-3 / MTS-4: through the real runtime ──────────────────────────────────────────────────────────────────

const STEPS = [[{ name: "ls", input: { path: "." } }], [{ name: "read", input: { path: "README.md" } }]];

for (const shape of ["openai", "claude"]) {
  const userContextId = `mts-${shape}`;
  const workspaceDir = createWorkspace(shape);
  const state = await toolRuntime.initToolRuntimeIfNeeded({ userContextId, workspaceDir });
  const registryNames = (state?.tools || []).map((t) => t.name);

  await run(`MTS-3 [${shape}] nothing connected: no integration tool offered, list identical on every call and turn`, async () => {
    assert.ok(registryNames.some((n) => n.startsWith("coinbase_")) && registryNames.some((n) => n.startsWith("gmail_")),
      "the registry itself must still hold the coinbase/gmail tools (run npm run build:agent-core)");
    const turn1 = await runTask({ shape, userContextId, workspaceDir, taskId: `${shape}-t1`, steps: STEPS });
    const turn2 = await runTask({ shape, userContextId, workspaceDir, taskId: `${shape}-t2`, steps: STEPS });
    for (const turn of [turn1, turn2]) {
      assert.equal(turn.toolCalls.length, STEPS.length + 1, `expected ${STEPS.length + 1} tool-loop calls, got ${turn.toolCalls.length}`);
    }
    const lists = [...turn1.toolCalls, ...turn2.toolCalls].map((c) => JSON.stringify(c.request.tools));
    assert.equal(new Set(lists).size, 1, "the offered tool list changed between calls or turns");
    const offered = namesOf(turn1.toolCalls[0]);
    assert.deepEqual(offered.filter(isIntegrationTool), [], `integration tools offered: ${offered.filter(isIntegrationTool)}`);
    assert.deepEqual(offered, registryNames.filter((n) => !isIntegrationTool(n)), "every other tool is offered, in registry order");
  });

  await run(`MTS-4 [${shape}] connecting Gmail + Coinbase shows their tools on the next turn; disconnecting hides them`, async () => {
    seedRuntimeIntegrations(userContextId, { gmail: GMAIL_CONNECTED });
    const gmailOnly = await runTask({ shape, userContextId, workspaceDir, taskId: `${shape}-t3`, steps: STEPS });
    const gmailNames = namesOf(gmailOnly.toolCalls[0]);
    assert.deepEqual(gmailNames, registryNames.filter((n) => !n.startsWith("coinbase_") && !n.startsWith("phantom_")));
    assert.ok(gmailNames.some((n) => n.startsWith("gmail_")));

    seedRuntimeIntegrations(userContextId, { gmail: GMAIL_CONNECTED, coinbase: COINBASE_CONNECTED });
    const both = await runTask({ shape, userContextId, workspaceDir, taskId: `${shape}-t4`, steps: STEPS });
    const bothLists = both.toolCalls.map((c) => JSON.stringify(c.request.tools));
    assert.equal(new Set(bothLists).size, 1, "list changed within the loop");
    assert.deepEqual(namesOf(both.toolCalls[0]), registryNames.filter((n) => !n.startsWith("phantom_")), "full registry list once connected");

    clearRuntimeIntegrations(userContextId);
    const after = await runTask({ shape, userContextId, workspaceDir, taskId: `${shape}-t5`, steps: STEPS });
    assert.deepEqual(namesOf(after.toolCalls[0]).filter(isIntegrationTool), [], "tools still offered after disconnecting");
  });
}

// ── MTS-5: workers keep the full list ────────────────────────────────────────────────────────────────────────

await run("MTS-5 unconnected user: Gmail lane and Coinbase adapter still reach their tools (same 'disconnected' replies)", async () => {
  const userContextId = "mts-worker";
  const conversationId = "mts-worker-thread";
  const before = capture.calls.length;
  const result = await handleInput("Is my Gmail connected? Check my gmail connection status.", {
    source: "hud",
    sender: "hud-user",
    voice: false,
    userContextId,
    conversationId,
    sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:${conversationId}`,
    runtimeSelectionOverride: selection("openai"),
  });
  const reply = String(result?.reply || result?.text || "");
  assert.equal(String(result?.route || ""), "gmail", `routed to ${result?.route} (${result?.responseRoute})`);
  assert.match(reply, /Gmail status: not connected/i, `reply: ${reply}`);
  assert.doesNotMatch(reply, /not enabled/i, "the Gmail lane lost its tool (availableTools was scoped)");
  assert.equal(capture.calls.slice(before).length, 0, "the Gmail status lane should not call the model");

  const state = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
  const payload = await executeCoinbaseProviderTool(state, state.tools, "coinbase_portfolio_snapshot", { userContextId, conversationId });
  assert.equal(payload?.ok, false);
  assert.notEqual(payload?.errorCode, "TOOL_NOT_ENABLED");
  assert.equal(payload?.errorCode, "DISCONNECTED", JSON.stringify(payload).slice(0, 300));
});

// ── MTS-6: nothing left to offer ─────────────────────────────────────────────────────────────────────────────

await run("MTS-6 scoping that leaves no tool falls back to a direct answer (no empty tools array)", async () => {
  // A scope whose registry holds only integration tools (as with NOVA_ENABLED_TOOLS=gmail_*), none connected.
  const userContextId = "mts-only-integrations";
  const workspaceDir = createWorkspace("only-integrations");
  const state = await toolRuntime.initToolRuntimeIfNeeded({ userContextId, workspaceDir });
  state.tools = state.tools.filter((t) => isIntegrationTool(t.name));
  assert.ok(state.tools.length > 0);
  const turn = await runTask({ shape: "openai", userContextId, workspaceDir, taskId: "only-integrations", steps: [] });
  assert.ok(turn.calls.length >= 1, "no model call");
  assert.equal(turn.calls.filter((c) => Array.isArray(c.request.tools)).length, 0, "a request carried a tools array");
  assert.notEqual(String(turn.result?.responseRoute || ""), "tool_loop");
  assert.ok(String(turn.result?.reply || "").length > 0, "no reply");
});

console.log = originalLog;
console.info = originalInfo;
console.warn = originalWarn;

await run("no real network calls were attempted", async () => {
  assert.deepEqual(guard.violations, [], JSON.stringify(guard.violations.slice(0, 5)));
});

for (const r of results) console.log(`[${r.status}] ${r.name}${r.detail ? `\n  ${r.detail}` : ""}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nmodel-tool-scope: ${results.length - failed} passed, ${failed} failed`);
guard.restore();
process.exit(failed > 0 ? 1 : 0);
