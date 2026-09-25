/**
 * Unconnected Gmail / Coinbase smoke (token-efficiency close-out issues 8, 11, 12).
 *
 * Since Stage 3 a user without Gmail / Coinbase connected gets no gmail_* / coinbase_* tool schemas. Instead of a tool
 * result saying "not connected", the model now gets ONE per-user line in the STATIC system prompt (## Tooling) naming
 * the unconnected integrations and telling it to send the user to Integrations. It only changes on connect/disconnect.
 *   UI-1  unconnected user: the static prompt names Gmail and Coinbase and Integrations; the static prefix is
 *         byte-identical across turns (no change recorded by the static-prefix telemetry)
 *   UI-2  connecting Gmail changes the static prefix once (telemetry counts it), drops Gmail from the line, and the
 *         prefix is stable again on the next turn; with everything connected the line disappears
 *   UI-3  (issue 12) a stored Coinbase key pair that no longer decrypts counts as NOT connected (tools hidden, listed
 *         as not connected); a pair that decrypts counts as connected; a failed check is retried after its TTL
 *   UI-4  model-answered turns carry the line: a plain chat question ("Do I have any new emails?") and a tool-loop
 *         agent task about the inbox (no gmail_* tool offered)
 *   UI-5  lane-answered turns stay deterministic: a Coinbase portfolio question gets the Coinbase lane's
 *         "Connect Coinbase in Integrations" reply without a model call; the Gmail lane answers "check my inbox" with
 *         "Connect Gmail in Integrations" when it has the tool runtime
 *   UI-6  the Coinbase skill tells the model what to do when its tools are not offered
 *
 * Offline: temp NOVA_DATA_DIR, fake model behind a network guard, test-only master key (NOVA_ALLOW_TEST_KEY) for the
 * ciphertext checks, no real secrets. Needs `npm run build:agent-core`.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.NOVA_EMBEDDING_PROVIDER = "local";
// Test-only key material (honoured only with NOVA_ALLOW_TEST_KEY=1); never a real key.
process.env.NOVA_ALLOW_TEST_KEY = "1";
const TEST_KEY_A = "11".repeat(32);
const TEST_KEY_B = "22".repeat(32);
process.env.NOVA_TEST_MASTER_KEY_HEX = TEST_KEY_A;

import { isolatedDataDir } from "../lib/isolated-data-dir.mjs";
import { clearRuntimeIntegrations, seedRuntimeIntegrations } from "../lib/seed-runtime-integrations.mjs";
import {
  FAKE_OPENAI_BASE_URL,
  createCapture,
  createFakeOpenAiClient,
  describeRequest,
  installNetworkGuard,
} from "./token-harness-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const importSrc = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

const capture = createCapture();
let plan = [];
async function responder(request) {
  const d = describeRequest(request);
  if (d.hasTools && plan.length > 0) return { toolCalls: plan.shift() };
  return { text: "Gmail isn't connected yet; you can connect it on the Integrations page." };
}
const fakeClient = createFakeOpenAiClient({ capture, responder });
const guard = installNetworkGuard({});

const { buildPromptContextForTurn } = await importSrc("src/runtime/modules/chat/core/chat-handler/prompt-context-builder/index.js");
const { handleInput } = await importSrc("src/runtime/modules/chat/core/chat-handler/index.js");
const { toolRuntime } = await importSrc("src/runtime/modules/infrastructure/config/index.js");
const scope = await importSrc("src/runtime/modules/chat/core/chat-handler/model-tool-scope/index.js");
const { runGmailDomainService } = await importSrc("src/runtime/modules/services/gmail/index.js");
const secrets = await importSrc("src/security/secrets/index.js");

const selection = {
  activeChatRuntime: { provider: "openai", connected: true, apiKey: "fake-openai-key", baseURL: FAKE_OPENAI_BASE_URL, model: "gpt-5.6-terra" },
  activeOpenAiCompatibleClient: fakeClient,
  selectedChatModel: "gpt-5.6-terra",
};

function createWorkspace(name) {
  const dir = path.join(isolatedDataDir, "unconnected-integrations", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of ["SOUL.md", "USER.md", "MEMORY.md", "IDENTITY.md"]) {
    fs.copyFileSync(path.join(repoRoot, "templates", file), path.join(dir, file));
  }
  return dir;
}

async function buildTurn(userContextId, workspace, text) {
  const runSummary = { requestHints: {} };
  const counters = {};
  const result = await buildPromptContextForTurn({
    text, uiText: text, ctx: {}, source: "hud", sender: "hud-user",
    sessionKey: `agent:nova:hud:user:${userContextId}:dm:thread`,
    sessionContext: { transcript: [] }, userContextId, conversationId: `${userContextId}-thread`,
    personaWorkspaceDir: workspace, runtimeAssistantName: "Nova", runtimeCommunicationStyle: "direct", runtimeTone: "neutral",
    runtimeCustomInstructions: "", runtimeProactivity: "medium", runtimeHumorLevel: "low", runtimeRiskTolerance: "medium",
    runtimeStructurePreference: "balanced", runtimeChallengeLevel: "medium", requestHints: {}, fastLaneSimpleChat: false,
    hasStrictOutputRequirements: false, outputConstraints: { instructions: "" }, selectedChatModel: "gpt-5.6-terra",
    runtimeTools: null, availableTools: [], shouldPreloadWebSearchForTurn: false, shouldPreloadWebFetchForTurn: false,
    shouldAttemptMemoryRecallForTurn: false, observedToolCalls: [], runSummary,
    latencyTelemetry: { addStage() {}, incrementCounter(name) { counters[name] = (counters[name] || 0) + 1; } },
    broadcastThinkingStatus() {},
  });
  return { result, hints: runSummary.requestHints, counters };
}

const notConnectedLine = (prompt) => (prompt.split("\n").find((l) => l.startsWith("- Not connected for this user:")) || "");
const GMAIL_CONNECTED = { connected: true, email: "smoke@example.test", activeAccountId: "a1", scopes: [], accounts: [{ id: "a1", email: "smoke@example.test", enabled: true, scopes: [] }] };

const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const logLines = [];
console.log = (...parts) => { logLines.push(parts.map(String).join(" ")); };
console.info = () => {};
console.warn = () => {};

await run("UI-1 unconnected user: static prompt names Gmail + Coinbase + Integrations, prefix byte-identical across turns", async () => {
  const ws = createWorkspace("u1");
  const t1 = await buildTurn("ui-user-1", ws, "Plan my week, please.");
  const t2 = await buildTurn("ui-user-1", ws, "Now write a short haiku about autumn leaves.");
  const line = notConnectedLine(t1.result.staticSystemPrompt);
  assert.match(line, /Coinbase, Gmail/, `line: ${line}`);
  assert.match(line, /Integrations page/);
  assert.ok(!/Phantom/.test(line), "phantom tools are not enabled by default, so Phantom must not be listed");
  assert.ok(!t1.result.staticSystemPrompt.includes("No external tool contracts registered"), "the false 'no tools' claim is back");
  assert.equal(t2.result.staticSystemPrompt, t1.result.staticSystemPrompt, "static prefix changed between turns");
  assert.equal(t1.hints.staticPromptChanged, false);
  assert.equal(t2.hints.staticPromptChanged, false);
  assert.equal(t2.hints.staticPromptHash, t1.hints.staticPromptHash);
  assert.equal(t2.counters.static_prompt_prefix_changes, undefined);
});

await run("UI-2 connecting Gmail changes the static prefix once (counted); stable after; line gone when all connected", async () => {
  const ws = createWorkspace("u2");
  const before = await buildTurn("ui-user-2", ws, "Plan my week, please.");
  seedRuntimeIntegrations("ui-user-2", { gmail: GMAIL_CONNECTED });
  const after = await buildTurn("ui-user-2", ws, "Plan my week, please.");
  const again = await buildTurn("ui-user-2", ws, "Thanks, and one more idea for Friday?");
  assert.notEqual(after.result.staticSystemPrompt, before.result.staticSystemPrompt);
  assert.match(notConnectedLine(after.result.staticSystemPrompt), /Not connected for this user: Coinbase \(/);
  assert.equal(after.hints.staticPromptChanged, true);
  assert.equal(after.hints.staticPromptChanges, 1);
  assert.equal(after.counters.static_prompt_prefix_changes, 1);
  assert.ok(logLines.some((l) => l.startsWith("[PromptCache] static prefix changed session=agent:nova:hud:user:ui-user-2")));
  assert.equal(again.result.staticSystemPrompt, after.result.staticSystemPrompt);
  assert.equal(again.hints.staticPromptChanged, false);
  assert.equal(again.hints.staticPromptChanges, 1);
  seedRuntimeIntegrations("ui-user-2", { gmail: GMAIL_CONNECTED, coinbase: { connected: true, apiKey: secrets.encryptSecret("key-id"), apiSecret: secrets.encryptSecret("key-secret") } });
  const all = await buildTurn("ui-user-2", ws, "Plan my week, please.");
  assert.equal(notConnectedLine(all.result.staticSystemPrompt), "", "line still present with everything connected");
});

await run("UI-3 (issue 12) Coinbase counts as connected only when its stored key pair decrypts", async () => {
  scope.resetStoredSecretPairCache();
  const good = { connected: true, apiKey: secrets.encryptSecret("key-id"), apiSecret: secrets.encryptSecret("key-secret") };
  assert.ok(secrets.isSecretCiphertext(good.apiKey));
  const coinbaseFor = (state) => [...scope.resolveConnectedToolIntegrations("u", { readSnapshot: () => ({ coinbase: state }) })];
  assert.deepEqual(coinbaseFor(good), ["coinbase"], "a decryptable pair must count as connected");
  // Encrypted under another master key: no longer decryptable here.
  process.env.NOVA_TEST_MASTER_KEY_HEX = TEST_KEY_B;
  secrets.resetSecretsCache();
  const foreign = { connected: true, apiKey: secrets.encryptSecret("key-id-2"), apiSecret: secrets.encryptSecret("key-secret-2") };
  process.env.NOVA_TEST_MASTER_KEY_HEX = TEST_KEY_A;
  secrets.resetSecretsCache();
  assert.deepEqual(coinbaseFor(foreign), [], "an undecryptable pair must count as NOT connected");
  assert.deepEqual(coinbaseFor({ connected: true, apiKey: good.apiKey, apiSecret: foreign.apiSecret }), [], "half a pair");
  // The failure is cached briefly, then re-checked (key material came back): simulated with the `now` parameter.
  const t0 = Date.now();
  assert.equal(scope.isStoredSecretPairUsable(foreign.apiKey, foreign.apiSecret, { now: t0 }), false);
  process.env.NOVA_TEST_MASTER_KEY_HEX = TEST_KEY_B;
  secrets.resetSecretsCache();
  assert.equal(scope.isStoredSecretPairUsable(foreign.apiKey, foreign.apiSecret, { now: t0 + 1_000 }), false, "failure cached within its TTL");
  assert.equal(scope.isStoredSecretPairUsable(foreign.apiKey, foreign.apiSecret, { now: t0 + 61_000 }), true, "failure re-checked after its TTL");
  process.env.NOVA_TEST_MASTER_KEY_HEX = TEST_KEY_A;
  secrets.resetSecretsCache();
  // Through the prompt and the model tool list (fresh cache: the TTL check above cached this pair as usable under key B).
  scope.resetStoredSecretPairCache();
  seedRuntimeIntegrations("ui-user-3", { coinbase: { connected: true, apiKey: foreign.apiKey, apiSecret: foreign.apiSecret } });
  const turn = await buildTurn("ui-user-3", createWorkspace("u3"), "Plan my week, please.");
  assert.match(notConnectedLine(turn.result.staticSystemPrompt), /Coinbase, Gmail/);
  const tools = ["read", "coinbase_portfolio_snapshot", "gmail_list_messages"].map((name) => ({ name }));
  assert.deepEqual(scope.resolveModelToolsForUser(tools, "ui-user-3").map((t) => t.name), ["read"]);
});

await run("UI-4 model-answered turns (plain chat and a tool-loop agent task) carry the not-connected line", async () => {
  const userContextId = "ui-user-4";
  clearRuntimeIntegrations(userContextId);
  const before = capture.calls.length;
  const chat = await handleInput("Do I have any new emails?", {
    source: "hud", sender: "hud-user", voice: false, userContextId, conversationId: "ui4-thread",
    sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:ui4-thread`, runtimeSelectionOverride: selection,
  });
  const chatCalls = capture.calls.slice(before);
  assert.ok(chatCalls.length >= 1, `no model call (route ${chat?.route})`);
  const chatSystem = String(chatCalls[0].request.messages.find((m) => m.role === "system")?.content || "");
  assert.match(notConnectedLine(chatSystem), /Coinbase, Gmail.*Integrations page/);

  const workspaceDir = createWorkspace("u4-task");
  plan = [[{ name: "ls", input: { path: "." } }]];
  const beforeTask = capture.calls.length;
  const task = await handleInput("Triage my unread mail from the last 24 hours and give me a prioritized list with one next step each.", {
    voice: false, source: "agent-task", sender: "agent-task", userContextId, conversationId: "agent-task-ui4",
    sessionKeyHint: `agent-task:${userContextId}:ui4`, autonomousTask: true, permissionMode: "default", approvedTools: [],
    taskId: "ui4", workspaceDir, worktreePath: "", executionFenceCheck: () => {}, consumeTaskApproval: () => {},
    reserveTaskEffect: () => {}, runtimeSelectionOverride: selection,
  });
  const toolCalls = capture.calls.slice(beforeTask).filter((c) => Array.isArray(c.request.tools) && c.request.tools.length > 0);
  assert.ok(toolCalls.length >= 1, `the agent task did not reach the tool loop (route ${task?.route}/${task?.responseRoute})`);
  const names = toolCalls[0].request.tools.map((t) => String(t?.function?.name || ""));
  assert.ok(!names.some((n) => n.startsWith("gmail_") || n.startsWith("coinbase_")), `integration tools offered: ${names}`);
  const taskSystem = String(toolCalls[0].request.messages.find((m) => m.role === "system")?.content || "");
  assert.match(notConnectedLine(taskSystem), /Gmail: email, the inbox/);
});

await run("UI-5 lane-answered turns stay deterministic (Coinbase lane; Gmail lane with the tool runtime)", async () => {
  const userContextId = "ui-user-5";
  const before = capture.calls.length;
  const coinbase = await handleInput("What's my Coinbase portfolio worth?", {
    source: "hud", sender: "hud-user", voice: false, userContextId, conversationId: "ui5-thread",
    sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:ui5-thread`, runtimeSelectionOverride: selection,
  });
  assert.equal(String(coinbase?.route), "coinbase");
  assert.match(String(coinbase?.reply || ""), /Connect Coinbase in Integrations/);
  assert.equal(capture.calls.length, before, "the Coinbase lane should not call the model");

  const inbox = await handleInput("check my inbox", {
    source: "hud", sender: "hud-user", voice: false, userContextId, conversationId: "ui5-thread-b",
    sessionKeyHint: `agent:nova:hud:user:${userContextId}:dm:ui5-thread-b`, runtimeSelectionOverride: selection,
  });
  assert.equal(String(inbox?.route), "gmail", "'check my inbox' must go to the Gmail lane");
  assert.equal(capture.calls.length, before, "the Gmail lane should not call the model");
  // Through handleInput: a Gmail-routed turn now starts the tool runtime, so the lane answers deterministically.
  assert.match(String(inbox?.reply || ""), /Connect Gmail in Integrations/, `handleInput reply: ${inbox?.reply}`);

  const runtime = await toolRuntime.initToolRuntimeIfNeeded({ userContextId });
  const lane = await runGmailDomainService({
    text: "check my inbox",
    ctx: { userContextId, conversationId: "ui5-thread-b", sessionKey: `agent:nova:hud:user:${userContextId}:dm:ui5-thread-b` },
    llmCtx: { runtimeTools: runtime, availableTools: runtime.tools },
    requestHints: {},
  });
  assert.match(String(lane?.reply || ""), /Connect Gmail in Integrations/, `reply: ${lane?.reply}`);
});

await run("UI-6 the Coinbase skill says what to do when its tools are not offered", async () => {
  const skill = fs.readFileSync(path.join(repoRoot, "skills/coinbase/SKILL.md"), "utf8");
  assert.match(skill, /only offered when the user's Coinbase integration is connected/);
  assert.match(skill, /Integrations page/);
});

console.log = originalLog;
console.info = originalInfo;
console.warn = originalWarn;

await run("no real network calls were attempted", async () => {
  assert.deepEqual(guard.violations, [], JSON.stringify(guard.violations.slice(0, 5)));
});

for (const r of results) console.log(`[${r.status}] ${r.name}${r.detail ? `\n  ${r.detail}` : ""}`);
const failed = results.filter((r) => r.status === "FAIL").length;
console.log(`\nunconnected-integrations: ${results.length - failed} passed, ${failed} failed`);
guard.restore();
process.exit(failed > 0 ? 1 : 0);
