/**
 * Token-efficiency close-out: server-side user / conversation context for gmail_* / coinbase_* tool calls
 * (token-efficiency close-out issue 10).
 *
 * Both chat tool loops (OpenAI-compatible `runToolLoop` and `runClaudeToolLoop`) run with fake model clients and the
 * REAL gmail / coinbase tool definitions. The executed tool input must carry the turn's own userContextId /
 * conversationId when the model omits them AND when it supplies a different user's ids (the server value wins).
 * A turn with no server user id must reach the tool with an empty id (the tool refuses) instead of the model's id.
 * The model-facing schemas no longer list the fields, and the model's own tool_use block is not rewritten.
 *
 * No network: the OpenAI client is an object, the Claude endpoint is a stubbed globalThis.fetch on a TEST-NET
 * literal. Needs `npm run build:agent-core` (dist/) for the tool modules.
 */
import "../lib/isolated-data-dir.mjs"; // isolate NOVA_DATA_DIR (must stay the first import)
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dist = (rel) => pathToFileURL(path.join(repoRoot, "dist", rel)).href;
const src = (rel) => pathToFileURL(path.join(repoRoot, "src", rel)).href;

const { createGmailTools } = await import(dist("tools/builtin/gmail-tools/index.js"));
const { createCoinbaseTools } = await import(dist("tools/builtin/coinbase-tools/index.js"));
const { executeToolUse } = await import(dist("tools/core/executor/index.js"));
const { openAiToolCallToAnthropicToolUse, toOpenAiToolDefinitions } = await import(dist("tools/core/protocol/index.js"));
const { runToolLoop } = await import(src("runtime/modules/chat/core/chat-handler/tool-loop-runner/index.js"));
const { runClaudeToolLoop } = await import(src("runtime/modules/chat/core/chat-handler/claude-tool-loop/index.js"));
const { withServerToolContext, isServerContextTool } = await import(
  src("runtime/modules/chat/core/chat-handler/integration-tool-context/index.js")
);

const SERVER_USER = "alice-user";
const SERVER_THREAD = "thread-alice-1";
const OTHER_USER = "mallory-user";
const OTHER_THREAD = "thread-mallory-9";

const workspaceDir = repoRoot;
const integrationTools = [...createGmailTools({ workspaceDir }), ...createCoinbaseTools({ workspaceDir })];
const echoTool = {
  name: "echo_probe",
  description: "Echo.",
  input_schema: { type: "object", properties: { userContextId: { type: "string" } } },
  riskLevel: "safe",
  capabilities: [],
  execute: async (input) => JSON.stringify(input),
};
const availableTools = [...integrationTools, echoTool];

// The model's tool calls for one step: one omits the ids, one names another user, one non-integration tool that
// happens to carry a userContextId field (must be left alone).
const MODEL_CALLS = [
  { name: "gmail_list_messages", input: { maxResults: 3 } },
  { name: "coinbase_portfolio_snapshot", input: { userContextId: OTHER_USER, conversationId: OTHER_THREAD } },
  { name: "gmail_capabilities", input: { userContextId: OTHER_USER } },
  { name: "echo_probe", input: { userContextId: OTHER_USER } },
];

/** runtimeTools whose executeToolUse records the input the tool actually receives, then runs the real executor. */
function recordingRuntimeTools() {
  const executed = [];
  return {
    executed,
    runtimeTools: {
      executeToolUse: async (toolUse, tools, policy) => {
        executed.push({ name: toolUse.name, input: structuredClone(toolUse.input) });
        return executeToolUse(toolUse, tools, { source: "smoke", ...(policy || {}) });
      },
    },
  };
}

async function runOpenAiLoop({ userContextId, conversationId }) {
  const { executed, runtimeTools } = recordingRuntimeTools();
  const requests = [];
  let step = 0;
  const client = {
    chat: {
      completions: {
        create: async (body) => {
          requests.push(structuredClone(body));
          step += 1;
          if (step === 1) {
            return {
              choices: [{
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: MODEL_CALLS.map((call, idx) => ({
                    id: `call_${idx}`,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.input) },
                  })),
                },
              }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }
          return { choices: [{ message: { role: "assistant", content: "done" } }], usage: { prompt_tokens: 12, completion_tokens: 2 } };
        },
      },
    },
  };
  await runToolLoop({
    activeOpenAiCompatibleClient: client,
    modelUsed: "gpt-smoke",
    messages: [{ role: "system", content: "s" }, { role: "user", content: "check my inbox and portfolio" }],
    openAiToolDefs: toOpenAiToolDefinitions(availableTools),
    openAiMaxCompletionTokens: 256,
    openAiRequestTuningForModel: () => ({}),
    runtimeTools,
    toolRuntime: { toOpenAiToolUseBlock: (toolCall) => openAiToolCallToAnthropicToolUse(toolCall, "fallback-id") },
    availableTools,
    assistantStreamId: "stream-smoke",
    source: "smoke",
    conversationId,
    userContextId,
    hudOpToken: "",
    sessionKey: "smoke",
    text: "check my inbox and portfolio",
    latencyTelemetry: { incrementCounter() {} },
    observedToolCalls: [],
    toolExecutions: [],
    retries: [],
    markRecovery() {},
    provider: "openai",
    usageRecorder: { record: () => ({}) },
  });
  return { executed, requests };
}

const CLAUDE_BASE = "http://203.0.113.20"; // TEST-NET-3 literal, answered by the fetch stub below
async function runClaudeLoop({ userContextId, conversationId }) {
  const { executed, runtimeTools } = recordingRuntimeTools();
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith(CLAUDE_BASE)) throw new Error(`smoke blocked network call to ${url}`);
    const body = JSON.parse(String(init?.body || "{}"));
    requests.push(body);
    const payload = requests.length === 1
      ? {
        content: MODEL_CALLS.map((call, idx) => ({ type: "tool_use", id: `toolu_${idx}`, name: call.name, input: call.input })),
        usage: { input_tokens: 10, output_tokens: 5 },
      }
      : { content: [{ type: "text", text: "done" }], usage: { input_tokens: 12, output_tokens: 2 } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await runClaudeToolLoop({
      activeChatRuntime: { provider: "claude", apiKey: "test-key", baseURL: CLAUDE_BASE },
      selectedChatModel: "claude-smoke",
      systemPrompt: "s",
      historyMessages: [],
      text: "check my inbox and portfolio",
      availableTools,
      runtimeTools,
      userContextId,
      conversationId,
      observedToolCalls: [],
      toolExecutions: [],
      usageRecorder: { record: () => ({}) },
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  return { executed, requests };
}

const results = [];
async function run(name, fn) {
  try {
    await fn();
    results.push({ status: "PASS", name });
  } catch (error) {
    results.push({ status: "FAIL", name, detail: error instanceof Error ? error.stack || error.message : String(error) });
  }
}

function inputOf(executed, name) {
  const hit = executed.find((entry) => entry.name === name);
  assert.ok(hit, `${name} was not executed`);
  return hit.input;
}

function assertServerContextWins(executed, expectedUser, expectedThread) {
  for (const name of ["gmail_list_messages", "coinbase_portfolio_snapshot", "gmail_capabilities"]) {
    const input = inputOf(executed, name);
    assert.equal(input.userContextId, expectedUser, `${name} userContextId`);
    assert.equal(input.conversationId, expectedThread, `${name} conversationId`);
  }
  assert.equal(inputOf(executed, "gmail_list_messages").maxResults, 3, "other model arguments are kept");
  assert.deepEqual(inputOf(executed, "echo_probe"), { userContextId: OTHER_USER }, "non-integration tools are untouched");
}

for (const [label, runLoop] of [["openai", runOpenAiLoop], ["claude", runClaudeLoop]]) {
  await run(`ITC-${label}-1 ${label} loop: server ids replace omitted and foreign ids on gmail_* / coinbase_*`, async () => {
    const { executed } = await runLoop({ userContextId: SERVER_USER, conversationId: SERVER_THREAD });
    assertServerContextWins(executed, SERVER_USER, SERVER_THREAD);
  });

  await run(`ITC-${label}-2 ${label} loop: no server user -> the tool gets no id and refuses (never the model's id)`, async () => {
    const { executed } = await runLoop({ userContextId: "", conversationId: "" });
    const input = inputOf(executed, "gmail_capabilities");
    assert.equal(input.userContextId, "", "an empty server id must still override the model's id");
    const gmailCapabilities = integrationTools.find((tool) => tool.name === "gmail_capabilities");
    const payload = JSON.parse(await gmailCapabilities.execute(input));
    assert.equal(payload.ok, false);
    assert.equal(payload.errorCode, "BAD_INPUT");
  });

  await run(`ITC-${label}-3 ${label} loop: the model is offered schemas without userContextId / conversationId`, async () => {
    const { requests } = await runLoop({ userContextId: SERVER_USER, conversationId: SERVER_THREAD });
    const offered = label === "openai"
      ? requests[0].tools.map((tool) => ({ name: tool.function.name, schema: tool.function.parameters }))
      : requests[0].tools.map((tool) => ({ name: tool.name, schema: tool.input_schema }));
    const integration = offered.filter((tool) => isServerContextTool(tool.name));
    assert.equal(integration.length, integrationTools.length);
    for (const { name, schema } of integration) {
      assert.ok(!("userContextId" in (schema.properties || {})), `${name} still lists userContextId`);
      assert.ok(!("conversationId" in (schema.properties || {})), `${name} still lists conversationId`);
      assert.ok(!(schema.required || []).includes("userContextId"), `${name} still requires userContextId`);
      assert.doesNotMatch(JSON.stringify(schema), /userContextId|conversationId/, name);
    }
  });
}

await run("ITC-4 claude loop: the model's tool_use blocks are resent unchanged (ids are not written into history)", async () => {
  const { requests } = await runClaudeLoop({ userContextId: SERVER_USER, conversationId: SERVER_THREAD });
  const assistant = requests[1].messages.find((message) => message.role === "assistant");
  const blocks = assistant.content.filter((block) => block.type === "tool_use");
  assert.deepEqual(blocks.map((block) => block.input), MODEL_CALLS.map((call) => call.input));
});

await run("ITC-7 claude loop: gmail_forward_message without a HUD confirmation token is blocked (same as the OpenAI loop)", async () => {
  const { executed, runtimeTools } = recordingRuntimeTools();
  const toolExecutions = [];
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).startsWith(CLAUDE_BASE)) throw new Error(`smoke blocked network call to ${url}`);
    calls += 1;
    // The model tries to confirm on its own; the server must still demand the HUD token.
    const payload = {
      content: [{
        type: "tool_use",
        id: "toolu_fwd",
        name: "gmail_forward_message",
        input: { messageId: "m1", to: "x@example.com", requireExplicitUserConfirm: true },
      }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  let result;
  try {
    result = await runClaudeToolLoop({
      activeChatRuntime: { provider: "claude", apiKey: "test-key", baseURL: CLAUDE_BASE },
      selectedChatModel: "claude-smoke",
      systemPrompt: "s",
      historyMessages: [],
      text: "forward that email to x@example.com",
      availableTools,
      runtimeTools,
      userContextId: SERVER_USER,
      conversationId: SERVER_THREAD,
      hudOpToken: "",
      observedToolCalls: [],
      toolExecutions,
      usageRecorder: { record: () => ({}) },
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(executed.length, 0, "the forward tool must not run");
  assert.equal(calls, 1, "the loop stops after the blocked call");
  assert.match(result.reply, /explicit confirmation/i);
  assert.equal(toolExecutions[0]?.status, "blocked");
  assert.match(String(toolExecutions[0]?.error), /^sensitive_action_blocked:/);
});

await run("ITC-5 tools still refuse a call without a user id (execution-side validation kept)", async () => {
  for (const tool of integrationTools) {
    const out = await tool.execute({ messageId: "m1", to: "x@example.com", replyText: "hi", requireExplicitUserConfirm: true });
    const payload = JSON.parse(out);
    assert.equal(payload.ok, false, `${tool.name} must fail without userContextId`);
    assert.match(`${payload.errorCode} ${payload.message}`, /BAD_INPUT|Missing userContextId/i, tool.name);
  }
});

await run("ITC-6 withServerToolContext: server values win, input is never mutated, other tools untouched", async () => {
  const modelInput = { userContextId: OTHER_USER, query: "q" };
  const out = withServerToolContext("GMAIL_list_messages", modelInput, { userContextId: SERVER_USER, conversationId: SERVER_THREAD });
  assert.deepEqual(out, { userContextId: SERVER_USER, query: "q", conversationId: SERVER_THREAD });
  assert.deepEqual(modelInput, { userContextId: OTHER_USER, query: "q" });
  assert.equal(withServerToolContext("read", modelInput, { userContextId: SERVER_USER }), modelInput);
  assert.deepEqual(withServerToolContext("coinbase_capabilities", "not-an-object", { userContextId: SERVER_USER, conversationId: "" }), { userContextId: SERVER_USER, conversationId: "" });
  assert.equal(isServerContextTool("phantom_capabilities"), false, "only gmail_* / coinbase_* (as the OpenAI loop always did)");
});

for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`\nintegration-tool-context: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
